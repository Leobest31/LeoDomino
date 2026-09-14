/**
 * In-match hydrate poll — missed Realtime / public-only snapshot recovery.
 * Run: node src/online/playingHydrate.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asViewerSnapshot,
  INTERACTION_SOURCE_PUBLIC,
  keepAuthoritativeView,
  mergeRealtimeSessionView,
} from "./onlineTable.js";
import {
  needsPlayingHydrate,
  planPlayingHydrateTick,
  planPrivateHydration,
  emptyPrivateHydrationState,
  PLAYING_HYDRATE_POLL_MS,
  PRIVATE_HYDRATION_TICK_MS,
} from "./playingHydrate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(join(root, "hooks/useOnlineMatch.js"), "utf8");

function playingViewer(extras = {}) {
  return asViewerSnapshot({
    matchId: "49c608c6-394f-45d3-969b-380290d15eb7",
    viewerSeat: 0,
    currentSeat: 0,
    phase: "playing",
    status: "playing",
    version: 71,
    myHand: ["1-3", "2-4"],
    handCounts: [2, 8],
    legalMoves: [{ tileId: "1-3", end: "left" }],
    canPlay: true,
    canDraw: false,
    canPass: false,
    ...extras,
  });
}

function publicOnly(view, extras = {}) {
  return {
    ...view,
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
    interactionSource: INTERACTION_SOURCE_PUBLIC,
    interactionVersion: Number(view.interactionVersion) || 70,
    ...extras,
  };
}

{
  assert.equal(PLAYING_HYDRATE_POLL_MS, 2500);
  assert.equal(needsPlayingHydrate(playingViewer()), true);
  assert.equal(needsPlayingHydrate({ phase: "matchOver", status: "match_over" }), false);
  console.log("  ✓ live playing views need hydrate catch-up");
}

{
  const coherent = playingViewer();
  assert.deepEqual(planPlayingHydrateTick(coherent, { hidden: true }), { action: "skip" });
  assert.deepEqual(planPlayingHydrateTick(coherent, { busy: true }), { action: "skip" });
  assert.deepEqual(planPlayingHydrateTick(coherent, { dragLocked: true }), { action: "skip" });
  assert.deepEqual(planPlayingHydrateTick(coherent, {}), {
    action: "refresh",
    force: false,
    reason: "catch_up",
  });
  console.log("  ✓ coherent catch-up skips hidden/busy/drag");
}

{
  const stripped = publicOnly(playingViewer());
  const planned = planPlayingHydrateTick(stripped, { dragLocked: true });
  assert.equal(planned.action, "refresh");
  assert.equal(planned.force, true);
  assert.equal(planned.reason, "incoherent_turn");
  console.log("  ✓ incoherent own turn hydrates even during stuck drag");
}

{
  const waiting = publicOnly(playingViewer({ viewerSeat: 1, currentSeat: 0, version: 72 }));
  const planned = planPlayingHydrateTick(waiting, {});
  assert.equal(planned.action, "refresh");
  assert.equal(planned.force, true);
  assert.equal(planned.reason, "incoherent_wait");
  console.log("  ✓ waiting public-only snapshot hydrates");
}

{
  const previous = playingViewer({ version: 67, currentSeat: 1, viewerSeat: 1 });
  const merged = mergeRealtimeSessionView(previous, {
    table: "game_sessions",
    new: {
      version: 72,
      current_seat: 1,
      phase: "playing",
      status: "playing",
      round: 3,
      board: [{ id: "1-2", left: 1, right: 2 }],
      spinner: { id: "6-6", north: [], south: [] },
      hand_counts: [8, 8],
      reserve_count: 6,
      scores: [3, 0],
    },
  });
  assert.equal(merged.version, 72);
  assert.equal(merged.canPlay, false);
  const planned = planPlayingHydrateTick(merged, { busy: false });
  assert.equal(planned.action, "refresh");
  assert.equal(planned.force, true);
  const recovered = keepAuthoritativeView(
    merged,
    playingViewer({
      version: 72,
      viewerSeat: 1,
      currentSeat: 1,
      myHand: ["1-1", "2-3"],
      handCounts: [2, 8],
      legalMoves: [{ tileId: "1-1", end: "right" }],
    })
  );
  assert.equal(recovered.version, 72);
  assert.equal(recovered.canPlay, true);
  assert.equal(recovered.legalMoves[0].tileId, "1-1");
  const stale = keepAuthoritativeView(
    recovered,
    playingViewer({ version: 71, viewerSeat: 1, currentSeat: 0 })
  );
  assert.equal(stale, recovered, "stale hydrate cannot overwrite newer server state");
  console.log("  ✓ missed Realtime timeout then hydrate recovers; stale cannot clobber");
}

{
  const overdue = playingViewer({
    turnDeadlineAt: "2000-01-01T00:00:00.000Z",
    serverNow: "2000-01-01T00:00:10.000Z",
  });
  const planned = planPlayingHydrateTick(overdue, { busy: true, dragLocked: true });
  assert.equal(planned.action, "refresh");
  assert.equal(planned.force, true);
  assert.equal(planned.reason, "timeout_pending_resync");
  assert.deepEqual(planPlayingHydrateTick(overdue, { hidden: true }), { action: "skip" });
  console.log("  ✓ overdue deadline force-hydrates even when busy/drag");
}

{
  assert.match(hook, /planPlayingHydrateTick/);
  assert.match(hook, /PLAYING_HYDRATE_POLL_MS/);
  assert.match(hook, /playingHydrate/);
  assert.match(hook, /planPrivateHydration/);
  assert.match(hook, /PRIVATE_HYDRATION_TICK_MS/);
  assert.equal(PRIVATE_HYDRATION_TICK_MS, 250);
  const missing = {
    ...playingViewer(),
    myHand: [],
    handCounts: [7, 7],
    legalMoves: [],
    canPlay: false,
    interactionSource: INTERACTION_SOURCE_PUBLIC,
  };
  assert.equal(planPlayingHydrateTick(missing, { busy: true }).reason, "private_hand_missing");
  assert.equal(
    planPrivateHydration(missing, emptyPrivateHydrationState(), { nowMs: 0 }).action,
    "refresh"
  );
  console.log("  ✓ useOnlineMatch arms the playing hydrate poll and private-hand recovery");
}
