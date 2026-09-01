/**
 * American 🇺🇸 All Fives-style live scoring.
 * Run: node src/game/rules/americanScoring.test.js
 */
import assert from "node:assert/strict";
import { createTile, generateSet, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  AMERICAN_MATCH_TARGET,
  AMERICAN_RULESET_ID,
  ALL_FIVES_RULESET_ID,
  HUMAN_INDEX,
  calculateAllFivesRoundPoints,
  calculateRoundPoints,
  exposedEndTotal,
  explainAllFivesScore,
  playTile,
  resolveRuleset,
  scoreAllFivesPlay,
  startMatch,
  usesAllFivesSpinner,
} from "../index.js";
import { SPINNER_NORTH } from "./allFivesSpinner.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function americanOpening(tileId, extras = [], currentPlayer = 0) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  const opener = [tileId, ...extras];
  const other = ["0-1", "0-2"];
  return {
    seed: 1,
    byId,
    players: [
      { id: "you", hand: currentPlayer === 0 ? opener : other },
      { id: "leobest", hand: currentPlayer === 1 ? opener : other },
    ],
    reserve: [],
    board: createBoard(),
    spinnerId: null,
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer,
    scores: [0, 0],
    round: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
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
  const american = resolveRuleset(AMERICAN_RULESET_ID);
  const allFives = resolveRuleset(ALL_FIVES_RULESET_ID);
  const classic = resolveRuleset("legacy");
  assert.equal(american.defaultTargetScore, 150);
  assert.equal(american.defaultTargetScore, AMERICAN_MATCH_TARGET);
  assert.equal(typeof american.policies.scorePlay, "function");
  assert.equal(american.policies.scorePlay, allFives.policies.scorePlay);
  assert.equal(american.policies.explainPlayScore, allFives.policies.explainPlayScore);
  assert.equal(american.policies.calculateRoundPoints, calculateAllFivesRoundPoints);
  assert.notEqual(american.policies.calculateRoundPoints, calculateRoundPoints);
  assert.equal(classic.policies.scorePlay, undefined);
  assert.equal(usesAllFivesSpinner({ rulesetId: "american" }), true);
  assert.equal(usesAllFivesSpinner({ rulesetId: "allFives" }), true);
  assert.equal(usesAllFivesSpinner({ rulesetId: "legacy" }), false);
  assert.equal(usesAllFivesSpinner({ rulesetId: "haitian" }), false);
  const match = startMatch({
    seed: 9,
    playerIds: ["you", "leobest"],
    rulesetId: AMERICAN_RULESET_ID,
  });
  assert.equal(match.targetScore, 150);
  assert.equal(match.rulesetId, "american");
  section("American owns All Fives scoring; allFives id is a compatibility alias");
}

{
  const board = placeTile(createBoard(), createTile(2, 3), END.RIGHT);
  assert.equal(exposedEndTotal(board), 5);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 5);
  const after = playTile(americanOpening("2-3", ["5-5", "1-2"]), "2-3");
  assert.equal(after.scores[0], 5);
  assert.equal(after.lastPlayPoints, 5);
  section("+5 when exposed total is 5");
}

{
  const board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  assert.equal(exposedEndTotal(board), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 10);
  const after = playTile(americanOpening("5-5", ["2-3", "1-2"]), "5-5");
  assert.equal(after.scores[0], 10);
  assert.equal(after.lastPlayPoints, 10);
  section("+10 when exposed total is 10");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 3), END.RIGHT);
  assert.equal(exposedEndTotal(board, { spinnerId: "6-6" }), 15);
  assert.equal(scoreAllFivesPlay({ board, spinnerId: "6-6" }), 15);
  let state = americanOpening("6-6", ["3-6", "1-2"]);
  state = playTile(state, "6-6");
  state = { ...state, currentPlayer: 0 };
  const after = playTile(state, "3-6", END.RIGHT);
  assert.equal(after.scores[0], 15);
  assert.equal(after.lastPlayPoints, 15);
  section("+15 when exposed total is 15");
}

{
  const board = placeTile(createBoard(), createTile(3, 6), END.RIGHT);
  assert.equal(exposedEndTotal(board), 9);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true }), 0);
  const after = playTile(americanOpening("3-6", ["5-5", "1-2"]), "3-6");
  assert.equal(after.scores[0], 0);
  assert.equal(after.lastPlayPoints, 0);
  section("no score when total is not divisible by 5");
}

{
  const five = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  assert.equal(explainAllFivesScore({ board: five }).exactTotal, 10);
  const six = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  assert.equal(explainAllFivesScore({ board: six }).exactTotal, 12);
  assert.equal(scoreAllFivesPlay({ board: six }), 0);
  const four = placeTile(createBoard(), createTile(4, 4), END.RIGHT);
  assert.equal(explainAllFivesScore({ board: four }).exactTotal, 8);
  const after55 = playTile(americanOpening("5-5", ["0-1"]), "5-5");
  assert.equal(after55.lastPlayPoints, 10);
  const after66 = playTile(americanOpening("6-6", ["0-1"]), "6-6");
  assert.equal(after66.lastPlayPoints, 0);
  section("exposed double counts both halves (5-5=10, 6-6=12, 4-4=8)");
}

{
  let state = americanOpening("4-4", ["4-6", "4-5", "1-4", "2-4", "2-6"]);
  state = playTile(state, "4-4");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "4-6", END.RIGHT);
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "4-5", END.LEFT);
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "1-4", SPINNER_NORTH);
  const report = explainAllFivesScore({
    board: state.board,
    spinnerId: state.spinnerId,
    spinnerNorth: state.spinnerNorth,
    spinnerSouth: state.spinnerSouth,
  });
  assert.equal(state.spinnerId, "4-4");
  assert.ok(state.spinnerNorth.length >= 1);
  assert.equal(
    report.endpoints.some((end) => end.sourceTileId === "4-4"),
    false
  );
  assert.equal(report.exactTotal, 12);
  assert.equal(state.lastPlayPoints, 0);
  section("spinner/branch scoring uses outer chain ends only after the spinner is enclosed");
}

{
  const after = playTile(americanOpening("5-5", ["2-3"], HUMAN_INDEX), "5-5");
  assert.equal(after.currentPlayer === 0 || after.scores[0] === 10, true);
  assert.equal(after.scores[0], 10);
  assert.equal(after.scores[1], 0);
  assert.equal(after.lastPlayPointsSeat, HUMAN_INDEX);
  section("human scores live count points");
}

{
  const after = playTile(americanOpening("4-6", ["2-3"], 1), "4-6");
  assert.equal(after.scores[0], 0);
  assert.equal(after.scores[1], 10);
  assert.equal(after.lastPlayPointsSeat, 1);
  section("LeoBest scores live count points");
}

{
  const below = { ...americanOpening("5-5", ["1-2"]), scores: [140, 20] };
  const after = playTile(below, "5-5");
  assert.equal(after.scores[0], 150);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  assert.ok(after.scores[0] >= AMERICAN_MATCH_TARGET);

  const stillPlaying = playTile(
    { ...americanOpening("2-3", ["1-2"]), scores: [140, 20] },
    "2-3"
  );
  assert.equal(stillPlaying.scores[0], 145);
  assert.equal(stillPlaying.phase, PHASE.PLAYING);
  section("score accumulation toward 150 ends the match at the target");
}

{
  const saved = resolveRuleset("allFives");
  assert.equal(saved.policies.scorePlay, resolveRuleset("american").policies.scorePlay);
  const viaAllFives = playTile(
    { ...americanOpening("2-3", ["1-2"]), rulesetId: ALL_FIVES_RULESET_ID, targetScore: 200 },
    "2-3"
  );
  assert.equal(viaAllFives.scores[0], 5);
  section("legacy rulesetId allFives still uses count scoring, not Classic");
}

console.log("\nAmerican scoring tests passed.");
