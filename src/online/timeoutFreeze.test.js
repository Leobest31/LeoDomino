/**
 * Timeout same-version network guard, backoff, and browser clock restamp.
 * Run: node src/online/timeoutFreeze.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keepAuthoritativeView } from "./onlineTable.js";
import {
  overlayNewerTimeoutClock,
  remainingTurnMs,
  stampClientDeadlineReceipt,
  stampDeadlineReceipt,
  TURN_TIMEOUT_MS,
  turnTimerTone,
} from "./turnTimeout.js";
import {
  nextTimeoutRetryAt,
  planTimeoutTick,
  shouldClearTimeoutPending,
  timeoutResolveKey,
  TIMEOUT_PENDING_RECONCILE_MS,
  TIMEOUT_RESOLVE_RETRY_MS,
} from "./timeoutFreeze.js";

const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
const handler = readFileSync(join(root, "src/online/gameplayHandler.js"), "utf8");

function playingClockView(extras = {}) {
  return stampDeadlineReceipt(
    {
      matchId: MATCH_ID,
      phase: "playing",
      status: "playing",
      version: 2,
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
      timeoutStrikes: [0, 0],
      myHand: ["6-6"],
      handCounts: [1, 1],
      legalMoves: [{ tileId: "6-6", end: "left" }],
      canPlay: true,
      canDraw: false,
      canPass: false,
      interactionSource: "viewer",
      ...extras,
    },
    {
      serverNow: extras.serverNow ?? "2026-08-29T12:00:00.000Z",
      deadlineReceivedMono: extras.deadlineReceivedMono ?? 1000,
    }
  );
}

{
  const isolateMono = 12;
  const clientMono = 180_000;
  const wired = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: isolateMono }
  );
  assert.equal(remainingTurnMs(wired, Date.parse(wired.serverNow), clientMono), 0);
  assert.equal(turnTimerTone(0), "pending");
  const client = stampClientDeadlineReceipt(wired, clientMono);
  assert.equal(remainingTurnMs(client, Date.parse(client.serverNow), clientMono), TURN_TIMEOUT_MS);
  console.log("  ✓ Edge isolate monotonic clock cannot freeze the client at 00:00");
}

{
  const previous = playingClockView();
  const incoming = stampClientDeadlineReceipt(
    {
      ...previous,
      serverNow: "2026-08-29T12:00:50.000Z",
    },
    9999
  );
  const kept = keepAuthoritativeView(previous, incoming);
  assert.deepEqual(kept.myHand, ["6-6"]);
  assert.equal(kept.serverNow, incoming.serverNow);
  assert.ok(remainingTurnMs(kept, Date.parse(kept.serverNow), kept.deadlineReceivedMono) > 0);
  console.log("  ✓ same-version refresh restamps the clock instead of staying on Waiting for timeout");
}

{
  const expired = playingClockView({ matchId: MATCH_ID, version: 2, turnDeadlineAt: "2026-08-29T12:01:00.000Z" });
  const key = timeoutResolveKey(expired);
  assert.equal(key, `${MATCH_ID}|2|2026-08-29T12:01:00.000Z`);
  const visualTick = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    nowMs: Date.parse(expired.serverNow) + 60_000,
    monoMs: 1000 + 60_000,
  });
  assert.equal(visualTick.action, "wait", "same version/deadline cannot network-resolve every tick");
  const afterBackoff = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    retryNotBefore: Date.parse(expired.serverNow) + 50_000,
    nowMs: Date.parse(expired.serverNow) + 70_000,
    monoMs: 1000 + 70_000,
  });
  assert.equal(afterBackoff.action, "resolve");
  // Barely overdue (well under TIMEOUT_PENDING_RECONCILE_MS) so this proves
  // only "a fresh key resets the attempted-gate and can resolve" — not
  // conflated with the separate, deliberately-tested "past grace without
  // any prior attempt still reconciles" behavior (see afterGraceNoAttempt
  // below and deadlineInvariant.test.js / clientPendingResync.test.js A).
  const freshOverdueMs = 500;
  const newVersion = planTimeoutTick(
    { ...expired, version: 3, turnDeadlineAt: "2026-08-29T12:02:00.000Z" },
    {
      inFlight: false,
      attemptedKey: key,
      nowMs: Date.parse("2026-08-29T12:02:00.000Z") + freshOverdueMs,
      monoMs: 1000 + 120_000 + freshOverdueMs,
    }
  );
  assert.equal(newVersion.action, "resolve", "a fresh key can resolve when barely overdue");
  const focusCannotBypass = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    nowMs: Date.parse(expired.serverNow) + 180_000,
    monoMs: 1000 + 180_000,
  });
  assert.equal(focusCannotBypass.action, "reconcile", "long overdue soft-lock must refresh authority");
  assert.ok(nextTimeoutRetryAt(0, 0) === TIMEOUT_RESOLVE_RETRY_MS[0]);

  // A tick that has NEVER attempted resolve at all (no attemptedKey passed)
  // but is already past the reconcile grace window must still force a
  // refetch rather than blindly firing its first resolve — a missed
  // Realtime event can mean the client never got a chance to attempt
  // anything before the grace window elapsed.
  const afterGraceNoAttempt = planTimeoutTick(expired, {
    inFlight: false,
    nowMs: Date.parse(expired.serverNow) + 60_000 + TIMEOUT_PENDING_RECONCILE_MS,
    monoMs: 1000 + 60_000 + TIMEOUT_PENDING_RECONCILE_MS,
  });
  assert.equal(
    afterGraceNoAttempt.action,
    "reconcile",
    "past grace without any prior attempt still force-refetches"
  );
  console.log("  ✓ same match/version/deadline is gated; new version can resolve; focus cannot bypass");
}

{
  const overlay = overlayNewerTimeoutClock(
    playingClockView(),
    { serverNow: "2026-08-29T12:00:40.000Z", turnDeadlineAt: "2026-08-29T12:01:00.000Z" },
    5000
  );
  assert.equal(overlay.deadlineReceivedMono, 5000);
  assert.equal(remainingTurnMs(overlay, Date.parse(overlay.serverNow), 5000), 20_000);
  console.log("  ✓ opponent remaining time follows the server deadline after reconcile");
}

{
  assert.match(hook, /planTimeoutTick/);
  assert.match(hook, /timeoutResolveKey/);
  assert.match(hook, /shouldClearTimeoutPending/);
  assert.match(hook, /timeoutAttemptedKeyRef/);
  assert.match(hook, /attemptedKey: timeoutAttemptedKeyRef/);
  assert.match(hook, /setInterval\(tick, 250\)/);
  assert.match(hook, /planned\.clearPending/);
  assert.match(hook, /roundAdvanceAtVersionRef\.current = version/);
  assert.match(hook, /advanceRound\(\)/);
  assert.match(hook, /error\?\.code === "STALE_VERSION"/);
  assert.match(hook, /error\?\.code === "TIMEOUT_NOT_DUE"/);
  assert.match(hook, /asViewerSnapshot/);
  assert.match(hook, /nextTimeoutRetryAt/);
  assert.match(hook, /await refreshView\(\{ force: true \}\)/);
  assert.ok(TIMEOUT_RESOLVE_RETRY_MS.length >= 5);
  console.log("  ✓ hook gates timeout RPC and treats stale advance/timeout as refresh+backoff");
}

{
  const previous = playingClockView({ version: 2 });
  const advanced = playingClockView({
    version: 3,
    turnDeadlineAt: "2026-08-29T12:02:00.000Z",
    serverNow: "2026-08-29T12:01:30.000Z",
  });
  assert.equal(shouldClearTimeoutPending(previous, advanced), true);
  assert.equal(
    shouldClearTimeoutPending(previous, { ...previous, phase: "matchOver", status: "match_over" }),
    true
  );
  assert.equal(
    shouldClearTimeoutPending(
      previous,
      previous,
      Date.parse(previous.serverNow) + 90_000,
      (previous.deadlineReceivedMono || 0) + 90_000
    ),
    false,
    "still overdue same version keeps pending soft-lock until authority advances"
  );
  const idleClear = planTimeoutTick(advanced, {
    nowMs: Date.parse(advanced.serverNow),
    monoMs: advanced.deadlineReceivedMono,
  });
  assert.equal(idleClear.clearPending, true);
  console.log("  ✓ timeoutPending clears after authoritative advance; failed path stays bounded");
}

{
  assert.match(handler, /async function expireDueTimeoutIfNeeded/);
  assert.match(handler, /handleGetGameView[\s\S]*expireDueTimeoutIfNeeded/);
  assert.match(handler, /handleEnterOnlineMatch[\s\S]*expireDueTimeoutIfNeeded/);
  assert.match(handler, /_leopips_commit_online_game_transition/);
  console.log("  ✓ get_game_view and enter expire a due timeout on the shared commit path");
}

// Outage reconcile must not hammer the network on its own flat cadence —
// it piggybacks on the SAME backoff clock as the rest of the outage-retry
// system (serviceHealth's SERVICE_OUTAGE_RETRY_MS, passed as
// outageRetryNotBefore) so a stuck "Waiting for timeout…" cannot itself
// become a source of repeated requests during a confirmed outage.
{
  const expired = playingClockView({ turnDeadlineAt: "2026-08-29T12:01:00.000Z" });
  // Deadline is serverNow+60_000; +120_000 puts nowMs 60s past the deadline.
  const nowMs = Date.parse(expired.serverNow) + 120_000;
  const monoMs = 1000 + 120_000;

  const stillBackingOff = planTimeoutTick(expired, {
    serviceOutage: true,
    lastReconcileAt: 0,
    nowMs,
    monoMs,
    outageRetryNotBefore: nowMs + 15_000, // outage backoff not due yet
  });
  assert.equal(
    stillBackingOff.action,
    "wait",
    "outage reconcile must wait for the outage system's own backoff clock, not fire early"
  );

  const backoffElapsed = planTimeoutTick(expired, {
    serviceOutage: true,
    lastReconcileAt: 0,
    nowMs,
    monoMs,
    outageRetryNotBefore: nowMs - 1, // outage backoff already due
  });
  assert.equal(
    backoffElapsed.action,
    "reconcile",
    "once the outage backoff clock is due, the stuck timeout still gets unstuck"
  );

  // Backward-compatible fallback: no outage clock supplied at all (older/
  // test callers) still eventually reconciles via the normal-cadence check,
  // it just cannot fire faster than TIMEOUT_PENDING_RECONCILE_MS apart.
  const noOutageClockSupplied = planTimeoutTick(expired, {
    serviceOutage: true,
    lastReconcileAt: 0,
    nowMs,
    monoMs,
  });
  assert.equal(noOutageClockSupplied.action, "reconcile");
  const tooSoonWithoutOutageClock = planTimeoutTick(expired, {
    serviceOutage: true,
    lastReconcileAt: nowMs - Math.floor(TIMEOUT_PENDING_RECONCILE_MS / 2),
    nowMs,
    monoMs,
  });
  assert.equal(tooSoonWithoutOutageClock.action, "wait");
  console.log("  ✓ outage reconcile follows the outage backoff clock, not its own flat timer");
}

console.log("  ✓ timeout freeze-safety");
