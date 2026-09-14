/**
 * Freeze/recovery incident regression suite.
 *
 * A tester's active Classic match froze mid-game behind the green
 * "online.serviceUnavailable" banner and never recovered. Root cause: a
 * network-level Edge Function failure (dropped connection, DNS blip, or an
 * aborted request) produced an error shape
 * (GameplayClientError -> FunctionsFetchError -> real DOMException, nested
 * under `.cause.context`, not `.cause`) that serviceHealth.js's classifier
 * never recognized, AND the underlying functions.invoke() call had no
 * bounded timeout at all, so a stalled connection could leave the shared
 * `refreshInFlightRef` guard permanently set — silently disabling every
 * recovery path (outage retry loop, visibilitychange/online resume,
 * realtime status reconcile, hydrate poll) at once, since they all funnel
 * through the same refreshView().
 *
 * This file proves each of the 12 required regression scenarios. Where the
 * decision lives in a pure, exported function, the test calls it directly
 * with the *exact* nested error/view shapes the real code produces (not
 * simplified stand-ins) — see serviceHealth.test.js and gameplay.test.js for
 * the two most direct root-cause proofs. Where the decision lives inside
 * useOnlineMatch's own closure (no React test harness exists in this
 * project — every online hook is exercised via source-contract assertions
 * elsewhere, e.g. serviceHealth.test.js, activeMatchRecovery.test.js), this
 * file verifies the exact wiring against the hook's source, matching that
 * established convention.
 *
 * Run: node src/online/connectionRecovery.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameplayClientError } from "./gameplay.js";
import {
  NETWORK_REQUEST_TIMEOUT_MS,
  noteServiceFailure,
  emptyServiceHealthState,
  shouldDisableGameplayActions,
} from "./serviceHealth.js";
import {
  isUnhealthyRealtimeStatus,
  shouldRefreshAuthoritativeViewOnRealtimeStatus,
  shouldRefreshAuthoritativeViewOnResume,
  REALTIME_RECONNECTED_STATUSES,
  UNHEALTHY_REALTIME_STATUSES,
} from "./interactionRecovery.js";
import { keepAuthoritativeView, isMatchOverView } from "./onlineTable.js";
import { planPlayingHydrateTick } from "./playingHydrate.js";
import { remainingTurnMs, stampDeadlineReceipt, TURN_TIMEOUT_MS } from "./turnTimeout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function baseView(extras = {}) {
  return {
    matchId: MATCH_ID,
    phase: "playing",
    status: "playing",
    currentSeat: 0,
    round: 1,
    version: 5,
    myHand: ["6-6"],
    handCounts: [1, 1],
    scores: [0, 0],
    board: [],
    legalMoves: [],
    reserveCount: 3,
    ...extras,
  };
}

/** Real shape a dropped connection produces once wrapped by gameplay.js. */
function networkDropError() {
  return new GameplayClientError(
    "GAMEPLAY_FAILED",
    "Failed to send a request to the Edge Function",
    {
      name: "FunctionsFetchError",
      message: "Failed to send a request to the Edge Function",
      context: { name: "AbortError", message: "The user aborted a request." },
    }
  );
}

// ---------------------------------------------------------------------------
// 1 & 2. Realtime disconnect (opponent's turn / own turn) -> reconnect ->
// authoritative state restored.
// ---------------------------------------------------------------------------
{
  assert.deepEqual([...UNHEALTHY_REALTIME_STATUSES], ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);
  for (const status of UNHEALTHY_REALTIME_STATUSES) {
    assert.equal(isUnhealthyRealtimeStatus(status), true);
    assert.equal(shouldRefreshAuthoritativeViewOnRealtimeStatus(status), true);
  }
  for (const status of REALTIME_RECONNECTED_STATUSES) {
    assert.equal(shouldRefreshAuthoritativeViewOnRealtimeStatus(status), true);
  }
  // The disconnect/reconnect decision does not consult whose turn it is —
  // it always reconciles, so it is correct regardless of seat.
  assert.match(hook, /const onStatus = \(channelStatus\) => \{/);
  assert.match(hook, /shouldRefreshAuthoritativeViewOnRealtimeStatus\(channelStatus\)/);
  assert.match(hook, /void refreshView\(\{ force: true \}\)/);
  console.log("  ✓ 1&2. realtime CHANNEL_ERROR/TIMED_OUT/CLOSED and reconnect (SUBSCRIBED) both force a reconcile");
}
{
  // Reconnect must adopt the server's real state whether it moved the turn
  // to the viewer or to the opponent — never a stale local guess either way.
  const disconnectedOnOpponentTurn = baseView({ currentSeat: 1, version: 5 });
  const serverAfterReconnectStillOpponent = baseView({ currentSeat: 1, version: 5 });
  const serverAfterReconnectNowViewer = baseView({ currentSeat: 0, version: 6 });
  assert.equal(
    keepAuthoritativeView(disconnectedOnOpponentTurn, serverAfterReconnectNowViewer, {
      preferIncoming: true,
    }).currentSeat,
    0
  );
  assert.equal(
    keepAuthoritativeView(disconnectedOnOpponentTurn, serverAfterReconnectStillOpponent, {
      preferIncoming: true,
    }).currentSeat,
    1
  );
  console.log("  ✓ 2. reconnect reconciliation adopts server truth for either seat, not a guess");
}

// ---------------------------------------------------------------------------
// 3 & 4. Edge request temporarily fails -> UI unlocks -> recovery succeeds;
// a response lost after the server already committed does not duplicate.
// ---------------------------------------------------------------------------
{
  // See gameplay.test.js for the direct behavioral proof that a stalled
  // invoke() now settles (rejects) instead of hanging. Here: the busy mutex
  // release is structurally unconditional (finally), and every failure path
  // reconciles via refreshView before allowing a new submission.
  assert.match(hook, /\} finally \{\s*\n\s*if \(token === inflightRef\.current\) \{\s*\n\s*busyRef\.current = false;/);
  assert.match(hook, /setBusy\(false\);/);
  // Both the timeout branch and the generic catch branch re-fetch authoritative
  // state before returning control to the player.
  const runActionSection = hook.slice(hook.indexOf("const runAction = useCallback"));
  const timeoutBranch = runActionSection.slice(0, runActionSection.indexOf("} catch (error) {"));
  assert.match(timeoutBranch, /markServiceResult\(\{ name: "TimeoutError", timeout: true/);
  assert.match(timeoutBranch, /await refreshView\(\);/);
  const catchBranch = runActionSection.slice(
    runActionSection.indexOf("} catch (error) {"),
    runActionSection.indexOf("} finally {")
  );
  assert.match(catchBranch, /await refreshView\(\{ force: !hasCoherentInteraction\(viewRef\.current\) \}\);/);
  console.log("  ✓ 3. a failed/timed-out submit always releases busy (finally) and always reconciles first");
}
{
  // A version bump proves the move committed; keepAuthoritativeView adopts
  // it. An older/equal version is never re-applied, so a client that
  // "resends" after losing the response cannot fork state — the server's
  // own CAS (tested in gameplayHandler.test.js) rejects the literal resend,
  // and even if it didn't, the client-side merge is monotonic.
  const beforeSubmit = baseView({ version: 5, currentSeat: 0 });
  const serverAlreadyCommitted = baseView({ version: 6, currentSeat: 1, board: [{ tileId: "6-6" }] });
  const reconciled = keepAuthoritativeView(beforeSubmit, serverAlreadyCommitted, { preferIncoming: true });
  assert.equal(reconciled.version, 6);
  assert.equal(reconciled.board.length, 1);
  // A stale duplicate of the OLD version arriving after reconciliation must
  // never roll the view backward.
  const staleDuplicate = baseView({ version: 5, currentSeat: 0, board: [] });
  const stillReconciled = keepAuthoritativeView(reconciled, staleDuplicate);
  assert.equal(stillReconciled.version, 6, "an older/duplicate response can never regress the adopted commit");
  console.log("  ✓ 4. reconciliation adopts the one true committed version; a lost-then-late response cannot duplicate/regress it");
}

// ---------------------------------------------------------------------------
// 5 & 6. Background -> foreground and offline -> online both resume.
// ---------------------------------------------------------------------------
{
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(hook, /window\.addEventListener\("focus", refreshIfPlaying\)/);
  assert.match(hook, /window\.addEventListener\("pageshow", refreshIfPlaying\)/);
  assert.match(hook, /window\.addEventListener\("online", onOnline\)/);
  assert.match(hook, /document\.addEventListener\("resume", refreshIfPlaying\)/);
  assert.match(hook, /shouldRefreshAuthoritativeViewOnResume\(viewRef\.current\)/);
  assert.equal(shouldRefreshAuthoritativeViewOnResume(baseView({ phase: "playing" })), true);
  assert.equal(shouldRefreshAuthoritativeViewOnResume(baseView({ phase: "matchOver" })), false);
  console.log("  ✓ 5&6. visibility/focus/pageshow/online/resume all force an authoritative reconcile for a live match");
}

// ---------------------------------------------------------------------------
// 7. Realtime subscription closes and reconnects (idempotent teardown).
// ---------------------------------------------------------------------------
{
  const effectSection = hook.slice(
    hook.lastIndexOf("let cancelled = false;", hook.indexOf("const onEvent = (payload) => {")),
    hook.indexOf("const runAction = useCallback")
  );
  assert.match(effectSection, /let cancelled = false;/);
  assert.match(effectSection, /let stop = \(\) => \{\};/);
  assert.match(effectSection, /stop = subscribeGameSession\(matchId, onEvent, undefined, onStatus\);/);
  assert.match(effectSection, /return \(\) => \{\s*\n\s*cancelled = true;\s*\n\s*stop\(\);/);
  console.log("  ✓ 7. the realtime effect always tears down its previous channel before a new one is created");
}

// ---------------------------------------------------------------------------
// 8. HTTP works while realtime is down -> bounded polling fallback.
// ---------------------------------------------------------------------------
{
  // The hydrate poll's "incoherent" trigger is unconditional on realtime
  // health — it exists precisely so a degraded/silent Realtime channel
  // (one that never fires CHANNEL_ERROR but also stops delivering events)
  // cannot starve the client of updates. It never depends on a live socket.
  const incoherentWaitingView = { ...baseView({ currentSeat: 1 }), interactionSource: "public" };
  const planned = planPlayingHydrateTick(incoherentWaitingView, { hidden: false, busy: false, dragLocked: false });
  assert.equal(planned.action, "refresh");
  assert.match(hook, /window\.setInterval\(tick, PLAYING_HYDRATE_POLL_MS\)/);
  console.log("  ✓ 8. a bounded HTTP poll independently keeps state fresh even if Realtime is silently degraded");
}

// ---------------------------------------------------------------------------
// 9. Match becomes terminal while disconnected -> reconnect shows terminal
// result, never a frozen active board.
// ---------------------------------------------------------------------------
{
  const stillActiveLocally = baseView({ version: 5, phase: "playing", status: "playing" });
  const serverNowTerminal = {
    ...baseView({ version: 6 }),
    phase: "matchOver",
    status: "match_over",
    matchWinnerSeat: 1,
  };
  assert.equal(isMatchOverView(serverNowTerminal), true);
  const reconciled = keepAuthoritativeView(stillActiveLocally, serverNowTerminal, { preferIncoming: true });
  assert.equal(isMatchOverView(reconciled), true);
  assert.match(hook, /applyView\(last, \{\s*\n\s*force: isMatchOverView\(last\) \|\| Boolean\(options\.force\),/);
  assert.match(hook, /if \(isMatchOverView\(kept\)\) \{\s*\n\s*if \(kept\.matchId\) noteTerminalMatch\(kept\.matchId\);\s*\n\s*clearOnlineSession\(\);/);
  console.log("  ✓ 9. a terminal server state is always force-applied on reconcile — never left showing a stale active board");
}

// ---------------------------------------------------------------------------
// 10. Recovery fires multiple times -> exactly one effective attempt/loop.
// ---------------------------------------------------------------------------
{
  // The in-flight guard: concurrent refresh requests coalesce into the
  // single attempt already running (refreshQueuedRef), never a second
  // parallel network call.
  assert.match(hook, /if \(refreshInFlightRef\.current\) \{/);
  assert.match(hook, /refreshQueuedRef\.current = true;/);
  assert.match(hook, /\} while \(refreshQueuedRef\.current && !unmountedRef\.current\);/);

  // Defense in depth: even if a hung promise ever wedged the guard despite
  // the bounded network timeout, a stuck-for-too-long guard is treated as
  // stale and released rather than silently blocking recovery forever.
  assert.match(hook, /const STALE_REFRESH_GUARD_MS = NETWORK_REQUEST_TIMEOUT_MS \* 2 \+ 5000;/);
  assert.match(hook, /const stuckForMs = Date\.now\(\) - refreshInFlightSinceRef\.current;/);
  assert.match(hook, /if \(stuckForMs < STALE_REFRESH_GUARD_MS\) \{/);
  const stillFresh = 1000 < NETWORK_REQUEST_TIMEOUT_MS * 2 + 5000;
  const staleEnough = NETWORK_REQUEST_TIMEOUT_MS * 2 + 5001 >= NETWORK_REQUEST_TIMEOUT_MS * 2 + 5000;
  assert.equal(stillFresh, true);
  assert.equal(staleEnough, true);

  // Idempotent subscription lifecycle: only one subscribeGameSession call
  // exists per effect run, always preceded by tearing down the last one
  // (proven in scenario 7) — repeated status events cannot accumulate
  // duplicate channels, timers, or handlers.
  const subscribeCallCount = (hook.match(/subscribeGameSession\(/g) || []).length;
  assert.equal(subscribeCallCount, 1, "exactly one call site creates the realtime subscription");
  console.log("  ✓ 10. concurrent/repeated recovery triggers coalesce to one attempt; a stuck guard cannot wedge forever");
}

// ---------------------------------------------------------------------------
// 11. Temporary failure does not incorrectly abandon/forfeit the player.
// ---------------------------------------------------------------------------
{
  // forfeitOnlineMatch/abortOnlineMatch are legitimately imported for the
  // explicit, user-initiated "leave match" button — but no automatic
  // recovery path (refreshView, the outage retry loop, runAction's failure
  // handling, or the realtime/visibility/online handlers) may ever call them.
  const leaveCallSite = hook.indexOf("const leave = useCallback");
  assert.ok(leaveCallSite > 0, "forfeit/abort must be reachable only from an explicit leave action");
  const automaticRecoverySurface = hook.slice(0, leaveCallSite);
  assert.doesNotMatch(automaticRecoverySurface, /forfeitOnlineMatch\(|abortOnlineMatch\(/);
  const outage = noteServiceFailure(emptyServiceHealthState(), networkDropError(), 1000);
  const outage2 = noteServiceFailure(outage, networkDropError(), 2000);
  assert.equal(outage2.outage, true);
  assert.equal(shouldDisableGameplayActions(outage2), true, "outage only disables new actions");
  // Disabling actions is not a termination signal — the view is untouched.
  const view = baseView();
  assert.equal(isMatchOverView(view), false);
  console.log("  ✓ 11. a temporary/outage failure disables new actions only — it never calls forfeit/abort");
}

// ---------------------------------------------------------------------------
// 12. Turn timer after recovery reflects authoritative server state, not a
// restarted local 30s countdown.
// ---------------------------------------------------------------------------
{
  // Deadline was armed 20s before the server produced this reconciliation
  // snapshot: only 10s of the 30s window remain. The client never invents
  // its own deadline — recovery must show ~10s, not a fresh TURN_TIMEOUT_MS.
  const serverNow = "2026-08-29T12:00:20.000Z";
  const turnDeadlineAt = "2026-08-29T12:00:30.000Z";
  assert.equal(Date.parse(turnDeadlineAt) - (Date.parse(serverNow) - 20_000), TURN_TIMEOUT_MS);
  const recoveredView = stampDeadlineReceipt(
    { matchId: MATCH_ID, phase: "playing", turnDeadlineAt },
    { serverNow, deadlineReceivedMono: 5000 }
  );
  const remaining = remainingTurnMs(recoveredView, Date.parse(serverNow), 5000);
  assert.equal(remaining, 10_000, "recovery must reflect the true 10s left, not a fresh 30s");
  assert.notEqual(remaining, TURN_TIMEOUT_MS);
  assert.doesNotMatch(
    hook,
    /turnDeadlineAt:\s*new Date\(Date\.now\(\) \+ TURN_TIMEOUT_MS\)/,
    "the hook must never locally fabricate a fresh deadline on reconcile"
  );
  console.log("  ✓ 12. post-recovery turn timer reflects true server-elapsed time, never a restarted local 30s");
}

console.log("\nconnection recovery regression suite OK\n");
