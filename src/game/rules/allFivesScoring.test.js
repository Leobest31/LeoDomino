/**
 * All Fives live terminal scoring + round-end nearest-5.
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
  assert.equal(ALL_FIVES_MATCH_TARGET, 200);
  section("All Fives match target is 200");
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
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 5);
  section("opening 3–2 → exact 5 awards +5");
}

{
  const board = openWith(createTile(1, 4));
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 5);
  section("opening 4–1 → exact 5 awards +5");
}

{
  const board = openWith(createTile(3, 6));
  assert.equal(exposedEndTotal(board), 9);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  section("opening 6–3 → 0 points");
}

{
  // 0-0 spinner both halves still 0; 0-5 on one main side → 0+0+5 = 5, live 5 = +5.
  let board = openWith(createTile(0, 0));
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  board = placeTile(board, createTile(0, 5), END.RIGHT);
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false }), 5);
  section("live exact 5 from 0-0 + 0-5 awards +5");
}

{
  // One main side occupied: spinner remains a terminal double (Y+X+X).
  let board = openWith(createTile(3, 3));
  board = placeTile(board, createTile(2, 3), END.RIGHT);
  assert.equal(exposedEndTotal(board), 8);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "3-3" }), 0);
  board = openWith(createTile(3, 3));
  board = placeTile(board, createTile(3, 4), END.RIGHT);
  assert.equal(exposedEndTotal(board), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "3-3" }), 10);
  board = openWith(createTile(6, 6));
  board = placeTile(board, createTile(6, 3), END.LEFT);
  assert.equal(exposedEndTotal(board, { spinnerId: "6-6" }), 15);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "6-6" }), 15);
  section("one-sided spinner is a main-line terminal double: 3-3+4=+10, 6-6+3=+15");
}

{
  // Opening points accumulate toward the 200 target.
  let cumulative = 0;
  const opening = scoreAllFivesPlay({
    board: openWith(createTile(5, 5)),
    isOpening: true,
  });
  assert.equal(opening, 10);
  cumulative += opening;
  assert.equal(cumulative, 10);
  assert.ok(cumulative < ALL_FIVES_MATCH_TARGET);

  cumulative += 20;
  cumulative += 15;
  assert.equal(cumulative, 45);
  assert.ok(cumulative < ALL_FIVES_MATCH_TARGET);

  cumulative += 145;
  assert.equal(cumulative, 190);
  assert.ok(cumulative < ALL_FIVES_MATCH_TARGET);
  cumulative += 10;
  assert.equal(cumulative, 200);
  assert.ok(cumulative >= ALL_FIVES_MATCH_TARGET);
  section("opening points count toward the cumulative 200-point target");
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
  assert.equal(after.targetScore, 200);
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
  assert.equal(after.scores[0], 5);
  section("engine: opening 3–2 awards +5 live");
}

{
  const after = playTile(openingState("1-4", ["5-5", "1-2"]), "1-4");
  assert.equal(after.scores[0], 5);
  section("engine: opening 4–1 awards +5 live");
}

{
  const after = playTile(openingState("3-6", ["5-5", "1-2"]), "3-6");
  assert.equal(after.scores[0], 0);
  section("engine: opening 6–3 awards 0 via scorePlay");
}

{
  // Live 5 from 0-0 + 0-5 awards +5.
  let state = openingState("0-0", ["0-5", "1-2", "2-3"]);
  state = playTile(state, "0-0");
  assert.equal(state.scores[0], 0);
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
  section("engine: live exact 5 awards +5");
}

{
  const match = startMatch({
    seed: 42,
    playerIds: ["you", "rival"],
    rulesetId: ALL_FIVES_RULESET_ID,
  });
  assert.equal(match.targetScore, ALL_FIVES_MATCH_TARGET);
  assert.equal(match.targetScore, 200);

  const below = {
    ...openingState("5-5", ["1-2", "2-3"]),
    scores: [180, 0],
  };
  const notYet = playTile(below, "5-5");
  assert.equal(notYet.scores[0], 190);
  assert.equal(notYet.phase, PHASE.PLAYING);
  assert.equal(notYet.matchWinner, null);

  const near = {
    ...openingState("5-5", ["1-2", "2-3"]),
    scores: [190, 0],
  };
  const after = playTile(near, "5-5");
  assert.equal(after.scores[0], 200);
  assert.ok(after.scores[0] >= after.targetScore);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  section("engine: 190 + 10 reaches 200 and completes the match");
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

{
  const byId = indexTiles([createTile(0, 3)]);
  const players = [{ hand: [] }, { hand: ["0-3"] }];
  assert.equal(
    calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId }),
    5
  );
  assert.equal(
    scoreAllFivesPlay({ board: openWith(createTile(2, 3)), isOpening: true }),
    5
  );
  section("round-end 3 pips → 5; live exposed 5 also awards +5");
}

console.log("\nAll Fives opening-tile scoring tests passed.");
