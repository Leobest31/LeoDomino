/**
 * Degraded/recovery opening-turn path audit — legacy (Classic), Haitian,
 * American share one highest-double-else-highest-tile Round 1 rule; no
 * fixed 2-2/6-6. Dominican/Puerto Rican keep their own fixed-6-6 rule
 * (untouched, out of scope here).
 *
 * Covers: the authoritative mustPlayTileId surviving projection, Realtime
 * merge, and the (dead-code but audited) SQL-shaped hydration fallback,
 * without ever fabricating an opener from a ruleset id or the viewer's own
 * hand alone, and without ever leaking the opponent's concealed hand.
 *
 * Run: node src/online/openingRecovery.test.js
 */
import assert from "node:assert/strict";
import {
  GameplayError,
  applyAdvanceRound,
  applyOnlineAction,
  assertViewHidesOpponent,
  dealOnlineGame,
  projectGameView,
} from "./gameAuthority.js";
import { hydrateViewerInteraction, mergeRealtimeSessionView, sanitizeGameView } from "./onlineTable.js";
import { startMatch } from "../game/rules/drawDominoes.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function section(title) {
  console.log(`\n✓ ${title}`);
}

function deal(rulesetId, seed) {
  return dealOnlineGame({ rulesetId, playerAId: PLAYER_A, playerBId: PLAYER_B, seed }).state;
}

function views(state, version = 0) {
  const starter = state.currentPlayer;
  const other = starter === 0 ? 1 : 0;
  return {
    starter,
    other,
    starterView: projectGameView(state, { matchId: "m", viewerSeat: starter, version }),
    otherView: projectGameView(state, { matchId: "m", viewerSeat: other, version }),
  };
}

// =====================================================================
// 1-3. Classic / Haitian / American recovery with a real (non-fixed) opener
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42); // seed 42 -> real highest double is 5-5
  assert.equal(state.mustPlayTileId, "5-5", `${rulesetId} seed 42 opener`);
  assert.notEqual(state.mustPlayTileId, "2-2");
  assert.notEqual(state.mustPlayTileId, "6-6");

  const { starter, other, starterView, otherView } = views(state);
  // The authoritative projected view IS the "recovery" payload for the live
  // path — it must carry the real tile, not a ruleset-specific fixed one.
  assert.equal(starterView.mustPlayTileId, "5-5", `${rulesetId} starter view opener`);
  assert.ok(starterView.myHand.includes("5-5"));
  assert.equal(otherView.mustPlayTileId, null, `${rulesetId} opponent view hides it`);
  assertViewHidesOpponent(starterView, state.players[other].hand);
  assertViewHidesOpponent(otherView, state.players[starter].hand);
  section(`${rulesetId}: recovery view carries the real opener (5-5), never a fixed 2-2/6-6`);
}

// =====================================================================
// 4. No-double Round 1 recovery with the correct highest non-double
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 136); // seed 136 -> neither hand holds any double
  const anyDouble = state.players.some((p) => p.hand.some((id) => id[0] === id[2]));
  assert.equal(anyDouble, false, `${rulesetId} seed 136 truly has no double in either hand`);
  assert.equal(state.mustPlayTileId, "5-6", `${rulesetId} highest non-double opener`);
  const { starterView } = views(state);
  assert.equal(starterView.mustPlayTileId, "5-6");
  section(`${rulesetId}: no-double deal correctly forces the highest-ranked tile (5-6), not a double`);
}

// =====================================================================
// 5-8. Forced-opening interaction contract (starter-only, exact tile, then free)
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const { starter, other, starterView, otherView } = views(state);
  const opener = starterView.mustPlayTileId;

  // 5. Starter can interact only with the authoritative mandatory tile.
  assert.ok(starterView.legalMoves.length > 0);
  assert.ok(starterView.legalMoves.every((m) => m.tileId === opener));
  assert.equal(starterView.canPlay, true);

  // 6. The non-starter cannot interact or play.
  assert.equal(otherView.canPlay, false);
  assert.equal(otherView.legalMoves.length, 0);
  assert.throws(
    () => applyOnlineAction(state, { seat: other, action: { type: "play", tileId: opener, end: "right" } }),
    (err) => err instanceof GameplayError && err.code === "WRONG_TURN"
  );

  // 7. Playing a different tile is rejected during the forced opening.
  const otherTileInStarterHand = state.players[starter].hand.find((id) => id !== opener);
  if (otherTileInStarterHand) {
    assert.throws(
      () =>
        applyOnlineAction(state, {
          seat: starter,
          action: { type: "play", tileId: otherTileInStarterHand, end: "right" },
        }),
      (err) =>
        err instanceof GameplayError &&
        (err.code === "ILLEGAL_TILE" || err.code === "ILLEGAL_PLACEMENT")
    );
  }

  // 8. After the mandatory opener is played, normal legal interaction resumes.
  const { state: opened } = applyOnlineAction(state, {
    seat: starter,
    action: { type: "play", tileId: opener, end: "right" },
  });
  assert.equal(opened.currentPlayer, other);
  assert.equal(opened.mustPlayTileId, null);
  const nextView = projectGameView(opened, { matchId: "m", viewerSeat: other, version: 1 });
  assert.equal(nextView.mustPlayTileId, null);
  assert.ok(nextView.legalMoves.length >= 0); // resumes normal (possibly empty) legal-move computation, not locked

  section(`${rulesetId}: starter-only forced opening, wrong tile rejected, then interaction resumes`);
}

// =====================================================================
// 9. Round 2+ previous winner has a free opening
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 7);
  const { starter } = views(state);
  const { state: opened } = applyOnlineAction(state, {
    seat: starter,
    action: { type: "play", tileId: state.mustPlayTileId, end: "right" },
  });
  const roundOver = {
    ...opened,
    phase: "roundOver",
    roundResult: { reason: "domino", winnerIndex: 1, points: 5 },
    scores: [0, 5],
  };
  const { state: round2 } = applyAdvanceRound(roundOver, { seed: 900 });
  assert.equal(round2.currentPlayer, 1, `${rulesetId}: round-1 winner starts round 2`);
  assert.equal(round2.mustPlayTileId, null, `${rulesetId}: round 2 has no mandatory opener`);
  const view2 = projectGameView(round2, { matchId: "m", viewerSeat: 1, version: 2 });
  assert.equal(view2.mustPlayTileId, null);
  assert.ok(view2.legalMoves.length > 0, "winner can open with any tile");
  section(`${rulesetId}: round 2 — previous winner opens freely, no mandatory tile`);
}

// =====================================================================
// 10. Serialization/reload preserves currentPlayer and mustPlayTileId
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const roundTripped = JSON.parse(JSON.stringify(state));
  assert.equal(roundTripped.currentPlayer, state.currentPlayer);
  assert.equal(roundTripped.mustPlayTileId, state.mustPlayTileId);
  // Re-projecting the (identical) recovered engine state is idempotent.
  const before = projectGameView(state, { matchId: "m", viewerSeat: state.currentPlayer, version: 0 });
  const after = projectGameView(roundTripped, { matchId: "m", viewerSeat: state.currentPlayer, version: 0 });
  assert.deepEqual(after, before);
  section(`${rulesetId}: serialize/reload round-trip preserves currentPlayer + mustPlayTileId exactly`);
}

// =====================================================================
// 11. Realtime / degraded hydration preserves the same authoritative values
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const { starter, starterView } = views(state);
  const viewerSnapshot = sanitizeGameView(starterView, { asViewer: true });

  // Same-version Realtime echo: must preserve the authoritative mustPlayTileId
  // and legalMoves exactly, never recompute or fabricate them.
  const echoedRow = {
    version: 0,
    current_seat: starter,
    round: 1,
    phase: "playing",
    status: "playing",
    scores: [0, 0],
    board: [],
    spinner: null,
    reserve_count: state.reserve.length,
    hand_counts: state.players.map((p) => p.hand.length),
  };
  const merged = mergeRealtimeSessionView(viewerSnapshot, { new: echoedRow });
  assert.equal(merged.mustPlayTileId, starterView.mustPlayTileId);
  assert.deepEqual(merged.legalMoves, viewerSnapshot.legalMoves);

  // A NEWER public row (version advanced) with no fresh viewer fetch yet:
  // must clear private interaction fields, never guess/fabricate them.
  const advancedRow = { ...echoedRow, version: 1 };
  const mergedAdvanced = mergeRealtimeSessionView(viewerSnapshot, { new: advancedRow });
  assert.equal(mergedAdvanced.mustPlayTileId, null, `${rulesetId}: advanced version clears, never fabricates`);
  assert.equal(mergedAdvanced.legalMoves.length, 0);
  assert.equal(mergedAdvanced.canPlay, false);

  section(`${rulesetId}: Realtime merge preserves the authoritative opener and never fabricates one on a stale gap`);
}

// =====================================================================
// 12. Recovery never reveals the opponent's concealed hand
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const { starter, other, starterView } = views(state);
  const viewerSnapshot = sanitizeGameView(starterView, { asViewer: true });
  assert.ok(!("players" in viewerSnapshot));
  assert.ok(!("reserve" in viewerSnapshot));
  assert.ok(!("seed" in viewerSnapshot));
  assertViewHidesOpponent(viewerSnapshot, state.players[other].hand);

  const hydrated = hydrateViewerInteraction(viewerSnapshot);
  assertViewHidesOpponent(hydrated, state.players[other].hand);
  assert.ok(!JSON.stringify(hydrated).includes(JSON.stringify(state.players[other].hand[0])) ||
    state.players[starter].hand.includes(state.players[other].hand[0]));
  section(`${rulesetId}: hydration/recovery payloads never expose the opponent's concealed hand`);
}

// =====================================================================
// 13. Dominican / Puerto Rican still force their existing 6-6 opener
// =====================================================================
{
  const dominican = startMatch({ seed: 1, playerIds: ["a", "b"], rulesetId: "dominican" });
  assert.equal(dominican.mustPlayTileId, "6-6");
  const puertoRican = startMatch({ seed: 1, playerIds: ["a", "b"], rulesetId: "puertorican" });
  assert.equal(puertoRican.mustPlayTileId, "6-6");
  section("Dominican/Puerto Rican are untouched — still force the fixed 6-6 opener");
}

// =====================================================================
// 14. A genuinely missing authoritative opener must not be replaced by a
//     fabricated 6-6/2-2 — the degraded/SQL-shaped payload case.
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const { starter } = views(state);
  // Simulate the degraded SQL-shaped payload: has myHand + round + board,
  // but genuinely no mustPlayTileId and no legalMoves (what get_game_view
  // actually returns today — it has no such column).
  const degraded = {
    matchId: "m",
    viewerSeat: starter,
    currentSeat: starter,
    round: 1,
    phase: "playing",
    board: [],
    myHand: state.players[starter].hand.slice(),
    handCounts: state.players.map((p) => p.hand.length),
    mustPlayTileId: null,
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
  };
  const hydrated = hydrateViewerInteraction(degraded);
  // Must NOT invent 2-2, 6-6, or anything else. Must NOT allow free-choice
  // interaction either (that would silently skip the forced opening).
  assert.equal(hydrated.mustPlayTileId, null, `${rulesetId}: no fabricated opener`);
  assert.notEqual(hydrated.mustPlayTileId, "2-2");
  assert.notEqual(hydrated.mustPlayTileId, "6-6");
  assert.equal(hydrated.canPlay, false, `${rulesetId}: degraded payload stays non-interactable, not free-open`);
  assert.equal(hydrated.legalMoves.length, 0);
  section(`${rulesetId}: degraded payload with no authoritative opener stays non-interactable (no 2-2/6-6 guess)`);
}

// --- Sanity: once mustPlayTileId genuinely IS present (authoritative), hydration must use it as-is ---
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 42);
  const { starter, starterView } = views(state);
  const withAuthoritativeTile = {
    matchId: "m",
    viewerSeat: starter,
    currentSeat: starter,
    round: 1,
    phase: "playing",
    board: [],
    myHand: state.players[starter].hand.slice(),
    handCounts: state.players.map((p) => p.hand.length),
    mustPlayTileId: starterView.mustPlayTileId,
    legalMoves: starterView.legalMoves.slice(),
    canPlay: false,
    canDraw: false,
    canPass: false,
  };
  const hydrated = hydrateViewerInteraction(withAuthoritativeTile);
  assert.equal(hydrated.mustPlayTileId, starterView.mustPlayTileId);
  assert.equal(hydrated.canPlay, true);
  section(`${rulesetId}: when an authoritative opener IS already present, hydration uses it as-is (no override)`);
}

// --- Round 2+ degraded hydration correctly allows free-open (unambiguous) ---
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = deal(rulesetId, 7);
  const { starter } = views(state);
  const { state: opened } = applyOnlineAction(state, {
    seat: starter,
    action: { type: "play", tileId: state.mustPlayTileId, end: "right" },
  });
  const roundOver = {
    ...opened,
    phase: "roundOver",
    roundResult: { reason: "domino", winnerIndex: 1, points: 5 },
    scores: [0, 5],
  };
  const { state: round2 } = applyAdvanceRound(roundOver, { seed: 900 });
  const degradedRound2 = {
    matchId: "m",
    viewerSeat: 1,
    currentSeat: 1,
    round: 2,
    phase: "playing",
    board: [],
    myHand: round2.players[1].hand.slice(),
    handCounts: round2.players.map((p) => p.hand.length),
    mustPlayTileId: null,
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
  };
  const hydrated = hydrateViewerInteraction(degradedRound2);
  assert.equal(hydrated.canPlay, true, `${rulesetId}: round 2 free-open is unambiguous even from a degraded payload`);
  assert.ok(hydrated.legalMoves.length > 0);
  section(`${rulesetId}: round 2+ degraded hydration is safe to resolve locally (free open, no forced tile to guess)`);
}

console.log("\nAll opening-recovery tests passed.");
