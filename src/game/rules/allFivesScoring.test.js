/**
 * All Fives special opening-tile scoring + count scoring.
 * Run: node src/game/rules/allFivesScoring.test.js
 */

import assert from "node:assert/strict";
import { createTile, indexTiles, generateSet } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  calculateAllFivesRoundPoints,
  exposedEndTotal,
  roundToNearestFive,
  scoreAllFivesPlay,
} from "./allFivesScoring.js";
import { calculateRoundPoints } from "./scoring.js";
import { playTile, startMatch } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function openWith(tile) {
  let board = createBoard();
  board = placeTile(board, tile, END.RIGHT);
  return board;
}

{
  assert.equal(ALL_FIVES_MATCH_TARGET, 150);
  section("All Fives match target is 150");
}

{
  const board = openWith(createTile(5, 5));
  assert.equal(exposedEndTotal(board), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 10);
  section("opening 5–5 → 10 points");
}

{
  const board = openWith(createTile(4, 6));
  assert.equal(exposedEndTotal(board), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 10);
  section("opening 6–4 → 10 points");
}

{
  const board = openWith(createTile(2, 3));
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  section("opening 3–2 → 0 points");
}

{
  const board = openWith(createTile(1, 4));
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  section("opening 4–1 → 0 points");
}

{
  const board = openWith(createTile(3, 6));
  assert.equal(exposedEndTotal(board), 9);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  section("opening 6–3 → 0 points");
}

{
  // Open 0-0 (sum 0 → opening awards 0), then play 0-5 → ends 5|0 = 5.
  let board = openWith(createTile(0, 0));
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  board = placeTile(board, createTile(0, 5), END.RIGHT);
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false }), 5);
  section("second and later plays totaling 5 → award 5 points");
}

{
  // Later play totaling 10 still awards 10 (normal All Fives).
  let board = openWith(createTile(1, 1));
  board = placeTile(board, createTile(1, 4), END.RIGHT);
  // ends: left=1, right=4 → 5
  assert.equal(scoreAllFivesPlay({ board, isOpening: false }), 5);
  board = placeTile(board, createTile(4, 5), END.RIGHT);
  // ends: left=1, right=5 → 6 → 0
  assert.equal(scoreAllFivesPlay({ board, isOpening: false }), 0);
  section("later plays: only positive multiples of 5 score");
}

{
  // Opening points accumulate toward the 150 target.
  let cumulative = 0;
  const opening = scoreAllFivesPlay({
    board: openWith(createTile(5, 5)),
    isOpening: true,
  });
  assert.equal(opening, 10);
  cumulative += opening;
  assert.equal(cumulative, 10);
  assert.ok(cumulative < ALL_FIVES_MATCH_TARGET);

  // Simulate further count scoring (not opening).
  cumulative += 20; // e.g. ends totaling 20
  cumulative += 15;
  assert.equal(cumulative, 45);
  assert.ok(cumulative < ALL_FIVES_MATCH_TARGET);

  cumulative += 105;
  assert.equal(cumulative, 150);
  assert.ok(cumulative >= ALL_FIVES_MATCH_TARGET);
  section("opening points count toward the cumulative 150-point target");
}

/** Crafted All Fives playing state — empty board, seat 0 to open. */
function openingState(tileId, handExtras = []) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: [tileId, ...handExtras] },
      { id: "b", hand: ["0-1", "0-2"] },
    ],
    reserve: [],
    board: createBoard(),
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: ALL_FIVES_MATCH_TARGET,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
}

{
  const after = playTile(openingState("5-5", ["2-3", "1-2"]), "5-5");
  assert.equal(after.scores[0], 10);
  assert.equal(after.scores[1], 0);
  assert.equal(after.targetScore, 150);
  assert.equal(after.board.length, 1);
  section("engine: opening 5–5 awards 10 via scorePlay");
}

{
  const after = playTile(openingState("4-6", ["2-3", "1-2"]), "4-6");
  assert.equal(after.scores[0], 10);
  section("engine: opening 6–4 awards 10 via scorePlay");
}

{
  const after = playTile(openingState("2-3", ["5-5", "1-2"]), "2-3");
  assert.equal(after.scores[0], 0);
  section("engine: opening 3–2 awards 0 via scorePlay");
}

{
  const after = playTile(openingState("1-4", ["5-5", "1-2"]), "1-4");
  assert.equal(after.scores[0], 0);
  section("engine: opening 4–1 awards 0 via scorePlay");
}

{
  const after = playTile(openingState("3-6", ["5-5", "1-2"]), "3-6");
  assert.equal(after.scores[0], 0);
  section("engine: opening 6–3 awards 0 via scorePlay");
}

{
  // Second play totaling 5 awards 5 through the live ruleset.
  let state = openingState("0-0", ["0-5", "1-2", "2-3"]);
  state = playTile(state, "0-0");
  assert.equal(state.scores[0], 0);
  // Seat 1 would be next — put seat 0 back with the 0-5 still in hand.
  state = {
    ...state,
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["0-5", "1-2", "2-3"] },
      state.players[1],
    ],
  };
  state = playTile(state, "0-5", END.RIGHT);
  assert.equal(exposedEndTotal(state.board), 5);
  assert.equal(state.scores[0], 5);
  section("engine: second play totaling 5 awards 5");
}

{
  // Opening 10 contributes to the live match score vs target 150.
  const match = startMatch({
    seed: 42,
    playerIds: ["you", "rival"],
    rulesetId: ALL_FIVES_RULESET_ID,
  });
  assert.equal(match.targetScore, ALL_FIVES_MATCH_TARGET);
  assert.equal(match.targetScore, 150);

  const near = {
    ...openingState("5-5", ["1-2", "2-3"]),
    scores: [140, 0],
  };
  const after = playTile(near, "5-5");
  assert.equal(after.scores[0], 150);
  assert.ok(after.scores[0] >= after.targetScore);
  section("engine: opening 10 counts toward the 150-point target");
}

{
  assert.equal(roundToNearestFive(0), 0);
  assert.equal(roundToNearestFive(1), 0);
  assert.equal(roundToNearestFive(2), 0);
  assert.equal(roundToNearestFive(3), 5);
  assert.equal(roundToNearestFive(7), 5);
  assert.equal(roundToNearestFive(8), 10);
  assert.equal(roundToNearestFive(12), 10);
  assert.equal(roundToNearestFive(13), 15);
  section("roundToNearestFive brackets");
}

{
  // Opponent holds 2-2 (4) + 3-4 (7) = 11 → Classic would award 11; All Fives → 10.
  const byId = indexTiles([
    createTile(1, 2),
    createTile(2, 2),
    createTile(3, 4),
  ]);
  const players = [{ hand: [] }, { hand: ["2-2", "3-4"] }];
  const classic = calculateRoundPoints({ winnerIndex: 0, players, byId });
  const allFives = calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId });
  assert.equal(classic, 11);
  assert.equal(allFives, 10);
  section("round-end: opponents' pips rounded to nearest 5 (not Classic raw)");
}

{
  const byId = indexTiles([createTile(0, 1), createTile(1, 1)]);
  const players = [{ hand: [] }, { hand: ["0-1"] }]; // 1 pip → rounds to 0
  assert.equal(
    calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId }),
    0
  );
  section("round-end: 1–2 remaining pips award 0 after rounding");
}

console.log("\nAll Fives opening-tile scoring tests passed.");
