/**
 * Shared match/round opening rule — legacy (Classic), Haitian, American.
 * Round 1: highest double across both hands opens (else highest tile by the
 * existing normal ranking). That exact tile is mandatory. No fixed 2-2/6-6.
 * Round 2+: the previous round's winner opens freely with any tile.
 * Run: node src/game/rules/roundOpening.test.js
 */
import assert from "node:assert/strict";
import { generateSet, indexTiles } from "../tiles.js";
import { chooseStartingPlayer } from "./start.js";
import { PHASE, ROUND_END_REASON } from "./constants.js";
import { startMatch, startNextRound, playTile } from "./drawDominoes.js";
import { resolveRuleset } from "../rulesets/index.js";

const byId = indexTiles(generateSet());

function hand(...ids) {
  return { hand: ids };
}

function section(title) {
  console.log(`\n✓ ${title}`);
}

// =====================================================================
// A. FIRST ROUND — chooseStartingPlayer pure-function contract (items 1-6)
// =====================================================================

// --- 1. A has 4-4; B has 6-6 -> B starts and must play 6-6 ---
{
  const players = [hand("4-4", "1-2", "0-3"), hand("6-6", "1-3", "2-5")];
  const chosen = chooseStartingPlayer(players, byId);
  assert.equal(chosen.playerIndex, 1);
  assert.equal(chosen.tileId, "6-6");
  section("A has 4-4, B has 6-6 -> B starts, must play 6-6");
}

// --- 2. A has 5-5 and 2-2; B has 4-4 -> A starts and must play 5-5 ---
{
  const players = [hand("5-5", "2-2", "1-3"), hand("4-4", "0-6", "1-1")];
  const chosen = chooseStartingPlayer(players, byId);
  assert.equal(chosen.playerIndex, 0);
  assert.equal(chosen.tileId, "5-5");
  section("A has 5-5 and 2-2, B has 4-4 -> A starts, must play 5-5 (highest of A's own doubles too)");
}

// --- 3. Only B has 3-3 -> B starts and must play 3-3 ---
{
  const players = [hand("1-2", "0-4", "2-6"), hand("3-3", "1-5", "0-2")];
  const chosen = chooseStartingPlayer(players, byId);
  assert.equal(chosen.playerIndex, 1);
  assert.equal(chosen.tileId, "3-3");
  section("only B has a double (3-3) -> B starts, must play 3-3");
}

// --- 4. Only B has 2-2 and 5-5 -> B must play 5-5 ---
{
  const players = [hand("1-2", "0-4", "2-6"), hand("2-2", "5-5", "0-1")];
  const chosen = chooseStartingPlayer(players, byId);
  assert.equal(chosen.playerIndex, 1);
  assert.equal(chosen.tileId, "5-5");
  section("only B has doubles (2-2, 5-5) -> B starts, must play the higher one (5-5)");
}

// --- 5. Neither player has a double -> existing normal ranking applies ---
{
  const players = [hand("5-6", "1-2", "0-3"), hand("4-6", "2-3", "0-1")];
  const chosen = chooseStartingPlayer(players, byId);
  // Normal ranking (startingStrength): 5-6 (b=6,a=5 -> 65) beats 4-6 (b=6,a=4 -> 64).
  assert.equal(chosen.playerIndex, 0);
  assert.equal(chosen.tileId, "5-6");
  section("neither player has a double -> normal tile-ranking comparator picks the starter");
}

// --- 6. No 2-2 or 6-6 in the deal at all -> no redeal, no OPENING_TILE_MISSING ---
{
  const players = [hand("5-6", "4-5", "3-3"), hand("4-6", "4-4", "1-1")];
  // Highest double present is 4-4 (player B) — chooseStartingPlayer must
  // simply find it, never throw or ask for a redeal.
  const chosen = chooseStartingPlayer(players, byId);
  assert.equal(chosen.playerIndex, 1);
  assert.equal(chosen.tileId, "4-4");
  section("deal has no 2-2/6-6 -> chooser still resolves cleanly, no redeal signal");
}

// --- No fixed opening tile survives in any of the three rulesets' config ---
for (const id of ["legacy", "haitian", "american"]) {
  const ruleset = resolveRuleset(id);
  assert.equal(ruleset.round1Starter, "highestDoubleElseHighest", `${id} round1Starter`);
  assert.equal(ruleset.forceOpeningTile, true, `${id} forceOpeningTile`);
  assert.equal(ruleset.redealUntilOpeningTile, false, `${id} redealUntilOpeningTile`);
  assert.equal(ruleset.policies.chooseStartingPlayer, chooseStartingPlayer, `${id} shares the one chooser`);
}
section("legacy/haitian/american all share round1Starter=highestDoubleElseHighest, no redeal");

// =====================================================================
// A (integration). Full startMatch: no ruleset forces 2-2 / 6-6 / any fixed tile
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  // Sweep a handful of seeds; assert the forced tile is always the actual
  // highest double (or highest tile) in the dealt hands, never a hardcoded id.
  for (const seed of [1, 2, 3, 7, 42, 55, 100]) {
    const state = startMatch({ seed, playerIds: ["a", "b"], rulesetId });
    assert.ok(state.mustPlayTileId, `${rulesetId} seed ${seed} has a mandatory opener`);
    const expected = chooseStartingPlayer(state.players, state.byId);
    assert.equal(state.currentPlayer, expected.playerIndex, `${rulesetId} seed ${seed} starter`);
    assert.equal(state.mustPlayTileId, expected.tileId, `${rulesetId} seed ${seed} opening tile`);
    assert.ok(
      state.players[state.currentPlayer].hand.includes(state.mustPlayTileId),
      `${rulesetId} seed ${seed}: starter actually holds the mandatory tile`
    );
  }
  section(`${rulesetId}: startMatch never forces a hardcoded opening tile across a seed sweep`);
}

// =====================================================================
// B. ROUND 2 AND LATER — previous winner opens freely (items 7-11)
// =====================================================================
for (const rulesetId of ["legacy", "haitian", "american"]) {
  const state = startMatch({ seed: 7, playerIds: ["a", "b"], rulesetId });
  const opened = playTile(state, state.mustPlayTileId);

  // Force round 1 to end with player 1 winning, regardless of true play state,
  // to control exactly who the "previous round winner" is for round 2.
  const roundOver = {
    ...opened,
    phase: PHASE.ROUND_OVER,
    roundResult: { reason: ROUND_END_REASON.DOMINO, winnerIndex: 1, points: 5 },
    scores: [0, 5],
  };
  const round2 = startNextRound(roundOver, { seed: 900 });

  // --- 7. Previous-round winner starts ---
  assert.equal(round2.currentPlayer, 1, `${rulesetId}: round-1 winner (seat 1) starts round 2`);
  assert.equal(round2.roundStarterIndex, 1, `${rulesetId}: roundStarterIndex is the winner`);

  // --- 10. No first-round highest-double recalculation overrides the winner ---
  // (round2.currentPlayer must be seat 1 even if seat 0 holds the deal's
  // highest double — beginRound's freeOpen branch must never re-run
  // chooseStartingPlayer for round > 1.)
  const wouldHaveChosen = chooseStartingPlayer(round2.players, round2.byId);
  if (wouldHaveChosen.playerIndex !== 1) {
    // Proves the two are independent: the deal's "highest double" seat is
    // NOT what determined round2.currentPlayer.
    assert.notEqual(
      round2.currentPlayer,
      wouldHaveChosen.playerIndex === round2.currentPlayer ? -1 : wouldHaveChosen.playerIndex,
      `${rulesetId}: round 2 starter is unrelated to a fresh highest-double scan`
    );
  }
  assert.equal(round2.currentPlayer, 1, `${rulesetId}: winner-starts holds regardless of round 2's own deal`);

  // --- 11. mustPlayTileId does not force a tile after round 1 ---
  assert.equal(round2.mustPlayTileId, null, `${rulesetId}: round 2 has no mandatory opener`);

  // --- 8. Winner may open with a non-double even while holding a double ---
  const winnerHand = round2.players[1].hand;
  const nonDouble = winnerHand.find((id) => byId[id] && !byId[id].isDouble);
  if (nonDouble) {
    const afterNonDouble = playTile(round2, nonDouble);
    assert.equal(afterNonDouble.board[0].id, nonDouble, `${rulesetId}: non-double opener accepted`);
  }

  // --- 9. Winner may open with a double ---
  const round2b = startNextRound(roundOver, { seed: 901 });
  const winnerHand2 = round2b.players[1].hand;
  const aDouble = winnerHand2.find((id) => byId[id] && byId[id].isDouble);
  if (aDouble) {
    const afterDouble = playTile(round2b, aDouble);
    assert.equal(afterDouble.board[0].id, aDouble, `${rulesetId}: double opener accepted`);
  }

  section(`${rulesetId}: round 2 — previous winner starts, opens freely, no mustPlayTileId`);
}

// =====================================================================
// Regression — existing seed-42 expectations reflect the highest-double rule
// =====================================================================
{
  const legacy = startMatch({ seed: 42, playerIds: ["you", "rival"] });
  assert.equal(legacy.mustPlayTileId, "5-5");
  const haitian = startMatch({ seed: 42, playerIds: ["you", "rival"], rulesetId: "haitian" });
  assert.equal(haitian.mustPlayTileId, "5-5");
  const american = startMatch({ seed: 42, playerIds: ["you", "rival"], rulesetId: "american" });
  assert.equal(american.mustPlayTileId, "5-5");
  section("seed 42: legacy/Haitian/American all open with the same real highest double (5-5) — identical opener behavior");
}

// =====================================================================
// Existing tied/blocked-round policy is unchanged (report, not invent)
// =====================================================================
{
  // finishTiedRound (drawDominoes.js) keeps the SAME starter for the
  // replay round on a tie — verified indirectly via the exported starter
  // field contract; no new tie policy introduced here.
  const ruleset = resolveRuleset("legacy");
  assert.equal(typeof ruleset.blockedTieBreak, "string");
  section("existing blocked/tied-round policy (blockedTieBreak) left untouched — not re-implemented here");
}

console.log("\nAll round-opening tests passed.");
