/**
 * Private-hand hydration — Realtime public-only merge must never leave a
 * live player with handCounts>0 and myHand=[] indefinitely.
 * Run: node src/online/privateHydration.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asViewerSnapshot,
  hasCoherentInteraction,
  INTERACTION_SOURCE_PUBLIC,
  isInteractableTurn,
  isMatchOverView,
  keepAuthoritativeView,
  mergeRealtimeSessionView,
  needsPrivateHydration,
  PRIVATE_VIEWER_STATE,
  privateViewerCoherence,
  shouldRefreshViewerAfterRealtime,
} from "./onlineTable.js";
import {
  applyAdvanceRound,
  applyOnlineAction,
  dealOnlineGame,
  getAvailableActions,
  ONLINE_ACTION_DRAW,
  ONLINE_ACTION_PASS,
  ONLINE_ACTION_PLAY,
  projectGameView,
  projectPublicSession,
} from "./gameAuthority.js";
import { shouldRefreshAuthoritativeViewOnResume } from "./interactionRecovery.js";
import {
  emptyPrivateHydrationState,
  notePrivateHydrationFailure,
  notePrivateHydrationSuccess,
  planPlayingHydrateTick,
  planPrivateHydration,
  PRIVATE_HYDRATION_I18N_KEY,
  PRIVATE_HYDRATION_RETRY_MS,
  PRIVATE_HYDRATION_TICK_MS,
} from "./playingHydrate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const hook = read("hooks/useOnlineMatch.js");
const onlinePage = read("pages/OnlineGamePage.jsx");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function realtimeRow(state, version) {
  const pub = projectPublicSession(state, { version });
  return {
    table: "game_sessions",
    new: {
      version: pub.version,
      current_seat: pub.currentSeat,
      phase: pub.phase,
      status: pub.status,
      round: pub.round,
      board: pub.board,
      spinner: pub.spinner,
      hand_counts: pub.handCounts,
      reserve_count: pub.reserveCount,
      scores: pub.scores,
      round_result: pub.roundResult,
      match_winner_seat: pub.matchWinnerSeat,
    },
  };
}

function viewerOf(state, seat, version, matchId = "match-hydrate") {
  return asViewerSnapshot(
    projectGameView(state, { matchId, viewerSeat: seat, version })
  );
}

function driveUntil(state, predicate, limit = 800) {
  let current = state;
  for (let i = 0; i < limit; i += 1) {
    if (predicate(current)) return current;
    if (current.phase !== "playing") return current;
    const available = getAvailableActions(current);
    if (available.canPlay) {
      const move = available.legalMoves[0];
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }).state;
    } else if (available.canDraw) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_DRAW },
      }).state;
    } else if (available.canPass) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_PASS },
      }).state;
    } else {
      return current;
    }
  }
  return current;
}

function haitianNextRound() {
  let { state } = dealOnlineGame({
    rulesetId: "haitian",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 44,
  });
  state = driveUntil(state, (current) => current.phase === "roundOver");
  if (state.phase !== "roundOver") {
    let { state: retry } = dealOnlineGame({
      rulesetId: "haitian",
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
      seed: 3,
    });
    retry = driveUntil(retry, (current) => current.phase === "roundOver", 1200);
    state = retry;
  }
  assert.equal(state.phase, "roundOver");
  const round1View = viewerOf(state, 0, 8);
  const next = applyAdvanceRound(state, { seed: 91 });
  return { round1View, next, scores: state.scores.slice() };
}

function liveMissingHand(extras = {}) {
  return {
    matchId: "match-hydrate",
    viewerSeat: 0,
    currentSeat: 0,
    phase: "playing",
    status: "playing",
    round: 2,
    version: 9,
    myHand: [],
    handCounts: [7, 7],
    board: [],
    scores: [2, 0],
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
    interactionSource: INTERACTION_SOURCE_PUBLIC,
    interactionVersion: 8,
    rulesetId: "haitian",
    ...extras,
  };
}

{
  const missing = liveMissingHand();
  assert.equal(privateViewerCoherence(missing), PRIVATE_VIEWER_STATE.MISSING);
  assert.equal(needsPrivateHydration(missing), true);
  assert.equal(hasCoherentInteraction(missing), false);
  assert.equal(isInteractableTurn(missing), false);

  const emptyOk = liveMissingHand({ myHand: [], handCounts: [0, 7], currentSeat: 1 });
  assert.equal(privateViewerCoherence(emptyOk), PRIVATE_VIEWER_STATE.EMPTY_OK);
  assert.equal(needsPrivateHydration(emptyOk), false);

  const coherent = asViewerSnapshot({
    ...liveMissingHand({
      myHand: ["0-1", "1-2", "2-3", "3-4", "4-5", "5-6", "6-6"],
      legalMoves: [{ tileId: "6-6", end: "left" }],
      canPlay: true,
    }),
  });
  assert.equal(privateViewerCoherence(coherent), PRIVATE_VIEWER_STATE.COHERENT);
  assert.equal(needsPrivateHydration(coherent), false);

  const terminal = liveMissingHand({
    phase: "matchOver",
    status: "match_over",
    myHand: [],
    handCounts: [0, 4],
  });
  assert.equal(privateViewerCoherence(terminal), PRIVATE_VIEWER_STATE.TERMINAL);
  assert.equal(needsPrivateHydration(terminal), false);
  assert.equal(isMatchOverView(terminal), true);
  console.log("  ✓ coherence helper distinguishes missing / empty-ok / coherent / terminal");
}

{
  const { round1View, next, scores } = haitianNextRound();
  assert.equal(next.state.round, 2);
  assert.deepEqual(next.state.board, []);
  assert.equal(next.state.players[0].hand.length, 7);
  assert.equal(next.state.players[1].hand.length, 7);

  const merged = mergeRealtimeSessionView(round1View, realtimeRow(next.state, 9));
  assert.deepEqual(merged.myHand, []);
  assert.deepEqual(merged.board, []);
  assert.equal(merged.round, 2);
  assert.deepEqual(merged.scores, scores);
  assert.ok(Number(merged.handCounts[0]) > 0);
  assert.equal(needsPrivateHydration(merged), true);
  assert.equal(privateViewerCoherence(merged), PRIVATE_VIEWER_STATE.MISSING);
  assert.equal(hasCoherentInteraction(merged), false);
  assert.equal(isInteractableTurn(merged), false);
  assert.equal(shouldRefreshViewerAfterRealtime(round1View, merged, { busy: false }), true);

  const planned = planPrivateHydration(merged, emptyPrivateHydrationState(), { nowMs: 0 });
  assert.equal(planned.action, "refresh");
  assert.equal(planned.force, true);
  assert.equal(planned.reason, "private_hand_missing");

  const recovered = keepAuthoritativeView(merged, viewerOf(next.state, 0, 9));
  assert.equal(recovered.myHand.length, 7);
  assert.equal(needsPrivateHydration(recovered), false);
  assert.equal(hasCoherentInteraction(recovered), true);
  console.log("  ✓ Haitian 7/7 round-advance public merge is incoherent until getGameView");
}

{
  const { round1View, next } = haitianNextRound();
  const merged = mergeRealtimeSessionView(round1View, realtimeRow(next.state, 9));
  let recovery = emptyPrivateHydrationState();
  assert.equal(planPrivateHydration(merged, recovery, { nowMs: 10 }).action, "refresh");

  recovery = notePrivateHydrationFailure(recovery, 10);
  assert.equal(recovery.lastFailed, true);
  assert.equal(recovery.retryAt, 10 + PRIVATE_HYDRATION_RETRY_MS[0]);
  assert.equal(planPrivateHydration(merged, recovery, { nowMs: 10 }).action, "wait");
  assert.equal(
    planPrivateHydration(merged, recovery, { nowMs: recovery.retryAt }).action,
    "refresh"
  );

  const recovered = keepAuthoritativeView(merged, viewerOf(next.state, 0, 9));
  recovery = notePrivateHydrationSuccess();
  assert.equal(planPrivateHydration(recovered, recovery, { nowMs: 50 }).action, "idle");
  assert.equal(recovered.myHand.length, 7);
  console.log("  ✓ first getGameView failure retries; success restores 7 tiles without a page refresh");
}

{
  const missing = liveMissingHand();
  const failed = notePrivateHydrationFailure(emptyPrivateHydrationState(), 1000);
  assert.equal(
    planPrivateHydration(missing, failed, { nowMs: 1000, hidden: true }).action,
    "wait_visible"
  );
  assert.equal(
    planPrivateHydration(missing, failed, { nowMs: 1000, hidden: true, immediate: true }).action,
    "wait_visible"
  );
  assert.equal(
    planPrivateHydration(missing, failed, { nowMs: 1000, hidden: false, immediate: true }).action,
    "refresh"
  );
  assert.equal(shouldRefreshAuthoritativeViewOnResume(missing), true);
  console.log("  ✓ background waits; foreground immediately hydrates");
}

{
  const { round1View, next } = haitianNextRound();
  const merged = mergeRealtimeSessionView(round1View, realtimeRow(next.state, 9));
  const recovered = keepAuthoritativeView(merged, viewerOf(next.state, 0, 9));
  assert.equal(recovered.myHand.length, 7);

  const echoed = mergeRealtimeSessionView(recovered, realtimeRow(next.state, 9));
  assert.equal(echoed.myHand.length, 7, "duplicate Realtime cannot wipe restored hand");
  assert.equal(needsPrivateHydration(echoed), false);
  assert.equal(shouldRefreshViewerAfterRealtime(recovered, echoed, { busy: false }), false);
  console.log("  ✓ Realtime during/after hydration cannot clear the restored hand");
}

{
  const missing = liveMissingHand();
  assert.equal(
    planPrivateHydration(missing, emptyPrivateHydrationState(), {
      nowMs: 0,
      refreshInFlight: true,
    }).action,
    "dedupe"
  );
  console.log("  ✓ duplicate Realtime/hydrate requests dedupe");
}

{
  const emptyOk = liveMissingHand({ myHand: [], handCounts: [0, 4], currentSeat: 1 });
  assert.equal(needsPrivateHydration(emptyOk), false);
  assert.equal(planPrivateHydration(emptyOk, emptyPrivateHydrationState(), { nowMs: 0 }).action, "idle");
  const looping = notePrivateHydrationFailure(emptyPrivateHydrationState(), 0);
  assert.equal(planPrivateHydration(emptyOk, looping, { nowMs: 0 }).action, "idle");
  console.log("  ✓ legitimate myHand=[] + handCount=0 does not hydrate");
}

{
  const over = liveMissingHand({
    phase: "matchOver",
    status: "match_over",
    myHand: [],
    handCounts: [0, 4],
  });
  assert.equal(needsPrivateHydration(over), false);
  assert.equal(planPrivateHydration(over, emptyPrivateHydrationState(), { nowMs: 0 }).action, "idle");
  assert.equal(shouldRefreshAuthoritativeViewOnResume(over), false);
  console.log("  ✓ terminal match stops hydration retries");
}

{
  const missing = liveMissingHand();
  const poll = planPlayingHydrateTick(missing, { busy: true, dragLocked: true });
  assert.equal(poll.action, "refresh");
  assert.equal(poll.reason, "private_hand_missing");
  assert.equal(planPlayingHydrateTick(missing, { hidden: true }).action, "skip");
  console.log("  ✓ playing poll treats missing private hand as forced hydrate");
}

{
  assert.equal(PRIVATE_HYDRATION_TICK_MS, 250);
  assert.ok(PRIVATE_HYDRATION_RETRY_MS.length >= 3);
  assert.equal(PRIVATE_HYDRATION_I18N_KEY, "online.reconnectingGame");
  assert.match(en, /reconnectingGame:/);
  assert.match(ht, /reconnectingGame:/);
  assert.match(onlinePage, /needsPrivateHydration\(view\)/);
  assert.match(onlinePage, /online\.reconnectingGame/);
  assert.match(onlinePage, /data-private-hydration/);
  assert.match(onlinePage, /hydrating=\{hydratingHand\}/);
  assert.match(hook, /planPrivateHydration/);
  assert.match(hook, /hydratePrivateHand/);
  assert.match(hook, /PRIVATE_HYDRATION_TICK_MS/);
  assert.match(hook, /notePrivateHydrationFailure/);
  assert.doesNotMatch(
    hook.slice(hook.indexOf("const hydratePrivateHand"), hook.indexOf("const boot")),
    /forfeitOnlineMatch/
  );
  assert.doesNotMatch(
    hook.slice(hook.indexOf("const hydratePrivateHand"), hook.indexOf("const boot")),
    /setStatus\("error"\)/
  );
  console.log("  ✓ UI recovery copy and hook recovery wiring");
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 7,
  });
  const view = viewerOf(state, 0, 0);
  assert.equal(view.myHand.length, 7);
  assert.equal(needsPrivateHydration(view), false);
  const { state: american } = dealOnlineGame({
    rulesetId: "american",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 11,
  });
  assert.equal(viewerOf(american, 1, 0).myHand.length, 7);
  console.log("  ✓ Classic/American private hands stay coherent after deal");
}

console.log("  ✓ private hydration recovery");
