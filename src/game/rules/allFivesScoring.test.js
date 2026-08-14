/**
 * American open-end / round-end scoring helpers.
 * Run: node src/game/rules/allFivesScoring.test.js
 */

import assert from "node:assert/strict";
import { createTile, indexTiles, generateSet } from "../tiles.js";
import { createBoard } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  AMERICAN_MATCH_TARGET,
  calculateAllFivesRoundPoints,
  exposedEndTotal,
  roundToNearestFive,
  scoreAllFivesPlay,
} from "./allFivesScoring.js";
import { emptySpinnerState, placeAmericanTile } from "./americanSpinner.js";
import { calculateRoundPoints } from "./scoring.js";
import { playTile, startMatch } from "./drawDominoes.js";
import { AMERICAN_RULESET_ID } from "../rulesets/american.js";

function section(title) {
  console.log(`✓ ${title}`);
}

{
  assert.equal(ALL_FIVES_MATCH_TARGET, 200);
  assert.equal(AMERICAN_MATCH_TARGET, 200);
  section("American match target is 200");
}

{
  const byId = indexTiles(generateSet());
  const placed = placeAmericanTile(
    { board: [], byId, ...emptySpinnerState() },
    byId["5-5"],
    END.RIGHT
  );
  assert.equal(exposedEndTotal({ ...placed, byId }), 10);
  assert.equal(scoreAllFivesPlay({ state: { ...placed, byId } }), 10);
  section("opening 5–5 → 10 points");
}

{
  const byId = indexTiles(generateSet());
  const placed = placeAmericanTile(
    { board: [], byId, ...emptySpinnerState() },
    byId["4-6"],
    END.RIGHT
  );
  assert.equal(scoreAllFivesPlay({ state: { ...placed, byId } }), 10);
  section("opening 6–4 → 10 points");
}

{
  const byId = indexTiles(generateSet());
  const placed = placeAmericanTile(
    { board: [], byId, ...emptySpinnerState() },
    byId["2-3"],
    END.RIGHT
  );
  // Opening may score: 5 is a multiple of 5.
  assert.equal(scoreAllFivesPlay({ state: { ...placed, byId } }), 5);
  section("opening 3–2 → 5 points (opening may score)");
}

{
  const byId = indexTiles(generateSet());
  const placed = placeAmericanTile(
    { board: [], byId, ...emptySpinnerState() },
    byId["3-6"],
    END.RIGHT
  );
  assert.equal(scoreAllFivesPlay({ state: { ...placed, byId } }), 0);
  section("opening 3–6 → 0 points");
}

{
  assert.equal(roundToNearestFive(0), 0);
  assert.equal(roundToNearestFive(12), 10);
  assert.equal(roundToNearestFive(13), 15);
  assert.equal(roundToNearestFive(7), 5);
  assert.equal(roundToNearestFive(8), 10);
  section("roundToNearestFive brackets");
}

{
  const byId = indexTiles([
    createTile(1, 2),
    createTile(2, 2),
    createTile(3, 4),
  ]);
  const players = [{ hand: [] }, { hand: ["2-2", "3-4"] }];
  assert.equal(calculateRoundPoints({ winnerIndex: 0, players, byId }), 11);
  assert.equal(calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId }), 10);
  section("round-end: 11 pips → 10");
}

{
  const byId = indexTiles([createTile(6, 6), createTile(0, 1)]);
  const players = [{ hand: [] }, { hand: ["6-6", "0-1"] }]; // 13
  assert.equal(calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId }), 15);
  section("round-end: 13 pips → 15");
}

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
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    ...emptySpinnerState(),
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
}

{
  const after = playTile(openingState("5-5", ["2-3", "1-2"]), "5-5");
  assert.equal(after.scores[0], 10);
  assert.equal(after.targetScore, 200);
  assert.equal(after.spinnerId, "5-5");
  section("engine: opening 5–5 awards 10 via scorePlay");
}

{
  const match = startMatch({
    seed: 42,
    playerIds: ["you", "rival"],
    rulesetId: AMERICAN_RULESET_ID,
  });
  assert.equal(match.targetScore, 200);
  section("startMatch American target 200");
}

console.log("\nAmerican scoring helper tests passed.");
