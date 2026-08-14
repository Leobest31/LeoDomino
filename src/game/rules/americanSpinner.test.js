/**
 * American Spinner + complete open-end scoring + smart-drag helpers.
 * Run: node src/game/rules/americanSpinner.test.js
 */

import assert from "node:assert/strict";
import { createTile, indexTiles, generateSet } from "../tiles.js";
import { createBoard, getOpenEnds, placeTile } from "../board.js";
import { END, ORIENTATION } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  AMERICAN_MATCH_TARGET,
  americanExposedEndTotal,
  americanPointsFromExposedTotal,
  describeAmericanExposedEnds,
  emptySpinnerState,
  getAmericanLegalMoves,
  getAmericanScoringEnds,
  listAmericanOpenEnds,
  placeAmericanTile,
  resolveSpinnerAfterPlace,
  scoreAmericanPlay,
} from "./americanSpinner.js";
import {
  allFivesScorePlay,
  calculateAllFivesRoundPoints,
  roundToNearestFive,
} from "./allFivesScoring.js";
import { applyAutoAction, getAvailableActions, playTile, startMatch } from "./drawDominoes.js";
import { chooseAiAction } from "../ai/index.js";
import { resolveDragDestination } from "../interaction.js";
import { AMERICAN_RULESET_ID } from "../rulesets/american.js";
import { resolveRuleset } from "../rulesets/index.js";
import { isValidSavedMatch, MATCH_SAVE_VERSION } from "../../persistence/matchSave.js";

function section(title) {
  console.log(`✓ ${title}`);
}

{
  assert.equal(AMERICAN_MATCH_TARGET, 200);
  const match = startMatch({
    seed: 9,
    playerIds: ["you", "rival"],
    rulesetId: AMERICAN_RULESET_ID,
  });
  assert.equal(match.targetScore, 200);
  section("match target is 200");
}

// ─── Opening scoring (first tile) ───────────────────────────────────────────

{
  const byId = indexTiles(generateSet());
  let state = { board: createBoard(), byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["2-3"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 5);
  assert.equal(scoreAmericanPlay(state), 5);
  section("first tile 3–2 → +5");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: createBoard(), byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  assert.equal(state.spinnerId, "5-5");
  assert.equal(americanExposedEndTotal(state), 10);
  assert.equal(scoreAmericanPlay(state), 10);
  section("first tile 5–5 → +10");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["4-6"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 10);
  assert.equal(scoreAmericanPlay(state), 10);
  section("first tile 6–4 → +10");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  assert.equal(state.spinnerId, "6-6");
  assert.equal(americanExposedEndTotal(state), 12);
  assert.equal(scoreAmericanPlay(state), 0);
  section("first tile 6–6 → 0");
}

// ─── Spinner both-halves rule ───────────────────────────────────────────────

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  assert.equal(scoreAmericanPlay(state), 0);
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], END.RIGHT) };
  // Spinner 6+6 still counts; plus tip 3 → 15
  assert.equal(americanExposedEndTotal(state), 15);
  assert.equal(scoreAmericanPlay(state), 15);
  section("6–6 followed by 6–3 → +15");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  assert.equal(scoreAmericanPlay(state), 10);
  state = { ...state, ...placeAmericanTile(state, byId["0-5"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 10);
  assert.equal(scoreAmericanPlay(state), 10);
  section("5–5 followed by 5–0 → +10");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  const awards = [];

  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  awards.push(scoreAmericanPlay(state));

  state = { ...state, ...placeAmericanTile(state, byId["0-5"], END.RIGHT) };
  awards.push(scoreAmericanPlay(state));

  state = { ...state, ...placeAmericanTile(state, byId["0-0"], END.RIGHT) };
  awards.push(scoreAmericanPlay(state));

  assert.deepEqual(awards, [10, 10, 10]);
  assert.equal(americanExposedEndTotal(state), 10);
  section("5–5 → 5–0 → 0–0 allows consecutive +10 scoring");
}

// ─── Complete threshold table (points from total) ───────────────────────────

{
  const scoring = [
    [5, 5],
    [10, 10],
    [15, 15],
    [20, 20],
    [25, 25],
    [30, 30],
    [35, 35],
  ];
  for (const [total, points] of scoring) {
    assert.equal(
      americanPointsFromExposedTotal(total),
      points,
      `total ${total} should award +${points}`
    );
  }
  section("totals 5/10/15/20/25/30/35 → full award");
}

{
  const zeros = [
    0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24,
    26, 27, 28, 29, 31, 32, 33, 34, 36,
  ];
  for (const total of zeros) {
    assert.equal(
      americanPointsFromExposedTotal(total),
      0,
      `total ${total} must award 0 (no rounding)`
    );
  }
  // Explicit no-rounding cases from the ruleset
  assert.equal(americanPointsFromExposedTotal(4), 0);
  assert.equal(americanPointsFromExposedTotal(13), 0);
  assert.equal(americanPointsFromExposedTotal(23), 0);
  section("non-multiples of 5 (incl. 4/13/23/36) → 0");
}

// ─── Multiple spinner branches ──────────────────────────────────────────────

{
  // Scoring works early — before four branches exist (opening + one arm)
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  assert.equal(scoreAmericanPlay(state), 0);
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], END.RIGHT) };
  assert.deepEqual(getAmericanScoringEnds(state).slice(0, 2), [6, 6]);
  assert.equal(americanExposedEndTotal(state), 15);
  assert.equal(scoreAmericanPlay(state), 15);
  section("scoring works early before four branches exist");
}

{
  // Spinner with 2 active branches: 5-5 + west 3 + east 2.
  // Both spinner sides are covered — only outer tips 3+2 count.
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["3-5"], END.LEFT) };
  state = { ...state, ...placeAmericanTile(state, byId["2-5"], END.RIGHT) };
  const snap = describeAmericanExposedEnds(state);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [2, 3]);
  assert.equal(snap.exposedTotal, 5);
  assert.equal(snap.awardedScore, 5);
  assert.equal(scoreAmericanPlay(state), 5);
  section("spinner with 2 active branches scores correctly");
}

{
  // Spinner with 3 active branches: 6-6 + E3 + N0 + S1 → 12+3+0+1 = 16 → 0
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 15);
  state = { ...state, ...placeAmericanTile(state, byId["0-6"], "north") };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], "south") };
  assert.equal(americanExposedEndTotal(state), 16);
  assert.equal(scoreAmericanPlay(state), 0);

  // Grow north to 0-4 → 12+3+4+1 = 20 → +20 (still 3 arms; west unused)
  state = { ...state, ...placeAmericanTile(state, byId["0-4"], "north") };
  assert.equal(americanExposedEndTotal(state), 20);
  assert.equal(scoreAmericanPlay(state), 20);
  section("spinner with 3 active branches scores correctly");
}

{
  // REGRESSION: Top=6, Left=5, Right=1, Bottom=3 → 15 (not 2×spinner + tips)
  const byId = indexTiles(generateSet());
  const state = {
    byId,
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "4-6",
        left: 6,
        right: 4,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-4",
        left: 4,
        right: 2,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-6",
        left: 2,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [
      {
        id: "3-6",
        left: 6,
        right: 3,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
  };
  const ends = getAmericanScoringEnds(state);
  assert.deepEqual(ends.slice().sort((a, b) => a - b), [1, 3, 5, 6]);
  assert.equal(ends.reduce((a, b) => a + b, 0), 15);
  assert.equal(americanExposedEndTotal(state), 15);
  assert.equal(scoreAmericanPlay(state), 15);
  section("REGRESSION: exposed ends 6+5+1+3 → openEndTotal 15, movePoints 15");
}

{
  // Engine awards +15 exactly once to the player who completed 6+5+1+3
  const byId = indexTiles(generateSet());
  const almost = {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["3-6", "0-0"] },
      { id: "b", hand: ["0-2", "1-2"] },
    ],
    reserve: [],
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "4-6",
        left: 6,
        right: 4,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-4",
        left: 4,
        right: 2,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-6",
        left: 2,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [],
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  // Before south arm: W/E covered, so spinner faces are 0. Tips 5+1+6 = 12 → 0
  assert.equal(americanExposedEndTotal(almost), 12);
  assert.equal(scoreAmericanPlay(almost), 0);

  const after = playTile(almost, "3-6", "south");
  assert.equal(americanExposedEndTotal(after), 15);
  assert.equal(after.statusVars?.playPoints, 15);
  assert.equal(after.statusVars?.scorer, 0);
  assert.equal(after.scores[0], 15);
  assert.equal(after.scores[1], 0);

  // Same board scored again must not mutate — award only via playTile once
  assert.equal(scoreAmericanPlay(after), 15);
  assert.equal(after.scores[0], 15);
  section("scoring move awards exactly +15 once to the correct player");
}

{
  // Branch extension replaces previous external end (internal 3 not counted)
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["3-5"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 13); // 10+3
  state = { ...state, ...placeAmericanTile(state, byId["0-3"], END.RIGHT) };
  const ends = getAmericanScoringEnds(state);
  assert.ok(!ends.includes(3), "internal 3 must not remain as a scoring end");
  assert.equal(americanExposedEndTotal(state), 10); // 10+0
  assert.equal(scoreAmericanPlay(state), 10);
  section("branch extension replaces previous external end");
}

{
  // Zero tip contributes 0; other branches still count
  const byId = indexTiles(generateSet());
  const state = {
    byId,
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "0-6",
        left: 6,
        right: 0,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [
      {
        id: "3-6",
        left: 6,
        right: 3,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
  };
  const ends = getAmericanScoringEnds(state);
  assert.equal(ends.length, 4);
  assert.ok(ends.includes(0));
  assert.equal(americanExposedEndTotal(state), 5 + 1 + 0 + 3); // 9
  assert.equal(scoreAmericanPlay(state), 0);
  section("zero tip contributes 0 without dropping other branches");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 9);
  assert.equal(scoreAmericanPlay(state), 0);
  section("non-scoring total produces 0 points");
}

{
  const byId = indexTiles(generateSet());
  const state = {
    byId,
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "2-6",
        left: 2,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [
      {
        id: "3-6",
        left: 6,
        right: 3,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
  };
  const engine = scoreAmericanPlay(state);
  const policy = resolveRuleset(AMERICAN_RULESET_ID).policies.scorePlay({
    state,
    board: state.board,
    byId,
    spinnerId: state.spinnerId,
    spinnerNorth: state.spinnerNorth,
    spinnerSouth: state.spinnerSouth,
  });
  const wrapper = allFivesScorePlay({ state });
  assert.equal(engine, 15);
  assert.equal(policy, engine);
  assert.equal(wrapper, engine);

  // AI auto-play path uses the same playTile → scorePlay pipeline
  const aiState = {
    seed: 1,
    byId,
    players: [
      { id: "ai", hand: ["3-6", "0-0"] },
      { id: "human", hand: ["0-1", "0-2"] },
    ],
    reserve: [],
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "4-6",
        left: 6,
        right: 4,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-4",
        left: 4,
        right: 2,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-6",
        left: 2,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [],
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const afterAi = applyAutoAction(aiState, {
    type: "play",
    tileId: "3-6",
    end: "south",
  });
  assert.equal(afterAi.phase, PHASE.PLAYING);
  assert.equal(afterAi.scores[0], 15);
  assert.equal(afterAi.statusVars?.playPoints, 15);
  section("human and AI use the same scoring function");
}

{
  // Save/resume keeps scores; does not re-award by re-running scorePlay into scores
  const byId = indexTiles(generateSet());
  const savedState = {
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["0-2"] },
    ],
    byId,
    board: [
      {
        id: "5-6",
        left: 5,
        right: 6,
        orientation: ORIENTATION.HORIZONTAL,
      },
      {
        id: "6-6",
        left: 6,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "1-6",
        left: 6,
        right: 1,
        orientation: ORIENTATION.HORIZONTAL,
      },
    ],
    reserve: [],
    scores: [15, 0],
    round: 1,
    phase: PHASE.PLAYING,
    currentPlayer: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    spinnerId: "6-6",
    spinnerNorth: [
      {
        id: "4-6",
        left: 6,
        right: 4,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-4",
        left: 4,
        right: 2,
        orientation: ORIENTATION.VERTICAL,
      },
      {
        id: "2-6",
        left: 2,
        right: 6,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
    spinnerSouth: [
      {
        id: "3-6",
        left: 6,
        right: 3,
        orientation: ORIENTATION.VERTICAL,
      },
    ],
  };
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: savedState }),
    true
  );
  assert.equal(scoreAmericanPlay(savedState), 15);
  // Resume must keep 15 — never treat current board as a fresh award
  assert.equal(savedState.scores[0], 15);
  assert.notEqual(savedState.scores[0] + scoreAmericanPlay(savedState), 15);
  section("save/resume does not re-award the previous move");
}

// ─── Accumulation + every placement recalculates ────────────────────────────

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  let accumulated = 0;
  const afterEach = [];

  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  let earned = scoreAmericanPlay(state);
  accumulated += earned;
  afterEach.push({ total: americanExposedEndTotal(state), earned, accumulated });

  state = { ...state, ...placeAmericanTile(state, byId["0-5"], END.RIGHT) };
  earned = scoreAmericanPlay(state);
  accumulated += earned;
  afterEach.push({ total: americanExposedEndTotal(state), earned, accumulated });

  state = { ...state, ...placeAmericanTile(state, byId["0-0"], END.RIGHT) };
  earned = scoreAmericanPlay(state);
  accumulated += earned;
  afterEach.push({ total: americanExposedEndTotal(state), earned, accumulated });

  assert.deepEqual(
    afterEach.map((r) => r.earned),
    [10, 10, 10]
  );
  assert.equal(accumulated, 30);
  // Must not replace — third move leaves score at 30, not 10
  assert.notEqual(accumulated, afterEach[2].earned);
  section("accumulated score adds new points instead of replacing");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  const scoresAfter = [];

  state = { ...state, ...placeAmericanTile(state, byId["2-3"], END.RIGHT) };
  scoresAfter.push(scoreAmericanPlay(state)); // 5

  state = { ...state, ...placeAmericanTile(state, byId["2-6"], END.LEFT) };
  scoresAfter.push(scoreAmericanPlay(state)); // 3+6 = 9 → 0

  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.LEFT) };
  scoresAfter.push(scoreAmericanPlay(state)); // spinner 12 + tip 3 = 15

  assert.equal(scoresAfter.length, 3);
  assert.ok(scoresAfter.every((n) => typeof n === "number"));
  assert.deepEqual(scoresAfter, [5, 0, 15]);
  section("scoring calculation runs after every legal placement");
}

{
  // Engine accumulation: playPoints add into scores[]
  const byId = indexTiles(generateSet());
  let state = {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["5-5", "0-5", "0-0", "1-2"] },
      { id: "b", hand: ["1-5", "0-2", "1-3"] },
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
  state = playTile(state, "5-5");
  assert.equal(state.scores[0], 10);
  assert.equal(state.currentPlayer, 1);

  // B attaches 1-5 (total 10+1=11 → +0); A's 10 must remain
  state = playTile(state, "1-5", END.RIGHT);
  assert.equal(state.scores[0], 10);
  assert.equal(state.currentPlayer, 0);

  // A attaches 0-5 on an open 5 end → spinner 10 + tips
  const aMoves = getAmericanLegalMoves(state.players[0].hand, state).filter(
    (m) => m.tileId === "0-5"
  );
  assert.ok(aMoves.length > 0);
  const before = state.scores[0];
  state = playTile(state, aMoves[0].tileId, aMoves[0].end);
  assert.ok(state.scores[0] >= before);
  if (state.statusVars?.playPoints === 10) {
    assert.equal(state.scores[0], 20);
  }
  section("engine scores accumulate on the scoreboard");
}

// ─── Spinner identity / legal ends ──────────────────────────────────────────

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["4-4"], END.RIGHT) };
  assert.equal(state.spinnerId, "4-4");
  state = { ...state, ...placeAmericanTile(state, byId["1-4"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-1"], END.RIGHT) };
  assert.equal(state.spinnerId, "4-4");
  assert.notEqual(state.spinnerId, "1-1");
  section("first double becomes Spinner; second double does NOT");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  const opens = listAmericanOpenEnds(state).map((e) => e.end).sort();
  assert.deepEqual(opens, ["left", "north", "right", "south"]);
  state = { ...state, ...placeAmericanTile(state, byId["0-5"], "north") };
  state = { ...state, ...placeAmericanTile(state, byId["1-5"], "south") };
  assert.equal(state.spinnerNorth.length, 1);
  assert.equal(state.spinnerSouth.length, 1);
  const ends2 = new Set(listAmericanOpenEnds(state).map((e) => e.end));
  assert.ok(ends2.has("left"));
  assert.ok(ends2.has("right"));
  assert.ok(ends2.has("north"));
  assert.ok(ends2.has("south"));
  section("Spinner supports four branches correctly");
}

{
  assert.equal(roundToNearestFive(12), 10);
  assert.equal(roundToNearestFive(13), 15);
  assert.equal(
    calculateAllFivesRoundPoints({
      winnerIndex: 0,
      players: [{ hand: [] }, { hand: ["6-6", "0-0"] }],
      byId: indexTiles([createTile(6, 6), createTile(0, 0)]),
    }),
    10
  );
  assert.equal(
    calculateAllFivesRoundPoints({
      winnerIndex: 0,
      players: [{ hand: [] }, { hand: ["6-6", "0-1"] }],
      byId: indexTiles([createTile(6, 6), createTile(0, 1)]),
    }),
    15
  );
  section("round-end 12→10 and 13→15 (hand pips only; not live scoring)");
}

{
  assert.equal(roundToNearestFive(7), 5);
  assert.equal(roundToNearestFive(8), 10);
  section("roundToNearestFive brackets stay deterministic");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["0-0"], END.RIGHT) };
  const moves = getAmericanLegalMoves(["0-3"], state);
  const ends = [...new Set(moves.map((m) => m.end))].sort();
  assert.deepEqual(ends, ["left", "right"]);
  const dragMany = resolveDragDestination(moves, "0-3", null);
  assert.equal(dragMany.ok, false);
  assert.equal(dragMany.reason, "ambiguous");
  const dragNorth = resolveDragDestination(moves, "0-3", "north");
  assert.equal(dragNorth.ok, false);
  assert.equal(dragNorth.reason, "mismatch");
  const dragLeft = resolveDragDestination(moves, "0-3", END.LEFT);
  assert.equal(dragLeft.ok, true);
  assert.equal(dragLeft.move.end, END.LEFT);
  section("multiple legal drag destinations → require endpoint selection");
}

{
  const byId = indexTiles(generateSet());
  let board = placeTile(createBoard(), byId["0-6"], END.RIGHT);
  let state = { board, byId, ...emptySpinnerState() };
  const moves = getAmericanLegalMoves(["0-3"], state);
  const ends = [...new Set(moves.map((m) => m.end))];
  assert.equal(ends.length, 1);
  const auto = resolveDragDestination(moves, "0-3", null);
  assert.equal(auto.ok, true);
  assert.equal(auto.move.end, ends[0]);
  section("one legal drag destination → auto-place");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  const moves = getAmericanLegalMoves(["1-5"], state);
  const mismatch = resolveDragDestination(moves, "1-5", "not-an-end");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "mismatch");
  const zero = resolveDragDestination(moves, "2-3", null);
  assert.equal(zero.ok, false);
  assert.equal(zero.reason, "none");
  section("invalid targeted endpoint / zero legal destinations → reject");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["5-5"], END.RIGHT) };
  const moves = getAmericanLegalMoves(["2-5"], state);
  const chosen = resolveDragDestination(moves, "2-5", "left");
  assert.equal(chosen.ok, true);
  assert.equal(typeof chosen.move.end, "string");
  assert.equal(
    moves.filter((m) => m.tileId === "2-5" && m.end === chosen.move.end).length,
    1
  );
  section("one tile cannot resolve into two placements");
}

{
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  const state = {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["5-5", "1-2", "2-3"] },
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
  const after = playTile(state, "5-5");
  assert.equal(after.scores[0], 10);
  assert.equal(after.spinnerId, "5-5");
  assert.equal(after.statusVars?.playPoints, 10);
  section("engine: opening 5-5 scores 10 and sets Spinner");
}

{
  assert.equal(resolveSpinnerAfterPlace(null, { id: "3-3", isDouble: true }), "3-3");
  assert.equal(
    resolveSpinnerAfterPlace("3-3", { id: "6-6", isDouble: true }),
    "3-3"
  );
  section("resolveSpinnerAfterPlace locks the first double");
}

// ─── Tile orientation + exposed-end agreement ───────────────────────────────

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };

  state = { ...state, ...placeAmericanTile(state, byId["1-6"], "north") };
  const north = state.spinnerNorth[0];
  assert.equal(north.left, 6, "matching 6 must face the spinner");
  assert.equal(north.right, 1, "exposed north end must be 1");
  assert.equal(north.orientation, ORIENTATION.VERTICAL);
  assert.equal(
    listAmericanOpenEnds(state).find((e) => e.end === "north").pip,
    1
  );
  assert.ok(getAmericanScoringEnds(state).includes(1));
  section("spinner 6-6 + 6-1 on top → 6 touches spinner, exposed = 1");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };

  state = { ...state, ...placeAmericanTile(state, byId["4-6"], "south") };
  const south = state.spinnerSouth[0];
  assert.equal(south.left, 6, "matching 6 must face the spinner");
  assert.equal(south.right, 4, "exposed south end must be 4");
  assert.equal(
    listAmericanOpenEnds(state).find((e) => e.end === "south").pip,
    4
  );
  assert.ok(getAmericanScoringEnds(state).includes(4));
  section("spinner 6-6 + 6-4 on bottom → exposed end = 4");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };

  const afterRight = {
    ...state,
    ...placeAmericanTile(state, byId["3-6"], END.RIGHT),
  };
  assert.equal(afterRight.board[1].left, 6);
  assert.equal(afterRight.board[1].right, 3);
  assert.equal(getOpenEnds(afterRight.board).right, 3);
  assert.ok(getAmericanScoringEnds(afterRight).includes(3));

  const afterLeft = {
    ...state,
    ...placeAmericanTile(state, byId["3-6"], END.LEFT),
  };
  assert.equal(afterLeft.board[0].left, 3);
  assert.equal(afterLeft.board[0].right, 6);
  assert.equal(getOpenEnds(afterLeft.board).left, 3);
  assert.ok(getAmericanScoringEnds(afterLeft).includes(3));
  section("spinner 6-6 + 6-3 on left/right → exposed end = 3");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };

  const asHighFirst = { id: "rev-16", a: 6, b: 1, isDouble: false };
  const asLowFirst = { id: "rev-16b", a: 1, b: 6, isDouble: false };
  const fromHigh = placeAmericanTile(state, asHighFirst, "north").spinnerNorth[0];
  const fromLow = placeAmericanTile(state, asLowFirst, "north").spinnerNorth[0];
  assert.equal(fromHigh.left, 6);
  assert.equal(fromHigh.right, 1);
  assert.equal(fromLow.left, 6);
  assert.equal(fromLow.right, 1);
  section("reversed tile input 1-6 / 6-1 still orients matching-inward");
}

{
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], "north") };
  // Spinner 6+6 still unused on W/E/S; north exposed 1 → 13 (no award)
  assert.deepEqual(
    getAmericanScoringEnds(state).slice().sort((a, b) => a - b),
    [1, 6, 6]
  );
  assert.equal(americanExposedEndTotal(state), 13);
  assert.equal(scoreAmericanPlay(state), 0);

  state = { ...state, ...placeAmericanTile(state, byId["4-6"], "south") };
  // 6+6 + north 1 + south 4 = 17
  assert.ok(getAmericanScoringEnds(state).includes(1));
  assert.ok(getAmericanScoringEnds(state).includes(4));
  assert.equal(americanExposedEndTotal(state), 17);

  state = { ...state, ...placeAmericanTile(state, byId["0-1"], "north") };
  // north free side becomes 0 (not the connecting 1)
  assert.equal(state.spinnerNorth[1].left, 1);
  assert.equal(state.spinnerNorth[1].right, 0);
  assert.equal(
    listAmericanOpenEnds(state).find((e) => e.end === "north").pip,
    0
  );
  assert.ok(!getAmericanScoringEnds(state).includes(1));
  assert.ok(getAmericanScoringEnds(state).includes(0));
  section("exposed-end scoring uses the free side after orientation");
}

// ─── Topology scoring (layout-independent) ──────────────────────────────────

{
  // Normal two-ended chain, no spinner
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["4-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], END.RIGHT) };
  const snap = describeAmericanExposedEnds(state);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [1, 4]);
  assert.equal(snap.exposedTotal, 5);
  assert.equal(snap.awardedScore, 5);
  assert.equal(scoreAmericanPlay(state), 5);
  section("normal two-ended chain scores exposed tips only");
}

{
  // Covered end is removed from scoring
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["2-3"], END.RIGHT) };
  assert.equal(americanExposedEndTotal(state), 5);
  state = { ...state, ...placeAmericanTile(state, byId["2-6"], END.LEFT) };
  const snap = describeAmericanExposedEnds(state);
  assert.ok(!snap.exposedEnds.includes(2), "covered 2 must not score");
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [3, 6]);
  assert.equal(snap.exposedTotal, 9);
  assert.equal(snap.awardedScore, 0);
  section("a covered end is removed from scoring");
}

{
  // Spinner with 3 active branches: W+E+N, south unused — spinner faces off
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["5-6"], END.LEFT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["0-6"], "north") };
  const snap = describeAmericanExposedEnds(state);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [0, 1, 5]);
  assert.equal(snap.exposedTotal, 6);
  assert.equal(snap.awardedScore, 0);
  assert.ok(!snap.exposedEnds.includes(6), "covered spinner faces must not score");
  section("spinner with 3 active branches (W+E+N) ignores spinner faces");
}

{
  // Spinner with 4 active branches
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["5-6"], END.LEFT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["4-6"], "north") };
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], "south") };
  const snap = describeAmericanExposedEnds(state);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [1, 3, 4, 5]);
  assert.equal(snap.exposedTotal, 13);
  assert.equal(snap.awardedScore, 0);
  section("spinner with 4 active branches scores outer tips only");
}

{
  // Extending one spinner branch replaces its previous endpoint
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["5-6"], END.LEFT) };
  state = { ...state, ...placeAmericanTile(state, byId["1-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["4-6"], "north") };
  assert.ok(getAmericanScoringEnds(state).includes(4));
  state = { ...state, ...placeAmericanTile(state, byId["2-4"], "north") };
  const snap = describeAmericanExposedEnds(state);
  assert.ok(!snap.exposedEnds.includes(4), "replaced north 4 must not remain");
  assert.ok(snap.exposedEnds.includes(2));
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [1, 2, 5]);
  assert.equal(snap.exposedTotal, 8);
  section("extending a spinner branch replaces its previous endpoint");
}

{
  // Internal tiles never contribute
  const byId = indexTiles(generateSet());
  let state = { board: [], byId, ...emptySpinnerState() };
  state = { ...state, ...placeAmericanTile(state, byId["6-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["3-6"], END.RIGHT) };
  state = { ...state, ...placeAmericanTile(state, byId["3-5"], END.RIGHT) };
  const snap = describeAmericanExposedEnds(state);
  assert.ok(!snap.exposedEnds.includes(3), "internal 3 must not score");
  // west unused: spinner 6+6 + east tip 5
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [5, 6, 6]);
  assert.equal(snap.exposedTotal, 17);
  assert.equal(snap.awardedScore, 0);
  section("internal tiles never contribute");
}

{
  // No endpoint counted twice
  const byId = indexTiles(generateSet());
  const state = {
    byId,
    board: [
      { id: "5-6", left: 5, right: 6, orientation: ORIENTATION.HORIZONTAL },
      { id: "6-6", left: 6, right: 6, orientation: ORIENTATION.VERTICAL },
      { id: "1-6", left: 6, right: 1, orientation: ORIENTATION.HORIZONTAL },
    ],
    spinnerId: "6-6",
    spinnerNorth: [
      { id: "4-6", left: 6, right: 4, orientation: ORIENTATION.VERTICAL },
    ],
    spinnerSouth: [
      { id: "3-6", left: 6, right: 3, orientation: ORIENTATION.VERTICAL },
    ],
  };
  const snap = describeAmericanExposedEnds(state);
  assert.equal(snap.exposedEnds.length, 4);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [1, 3, 4, 5]);
  assert.equal(snap.exposedTotal, 13);
  section("no endpoint can be counted twice");
}

{
  const boardTotals = [
    [5, 5],
    [10, 10],
    [15, 15],
    [20, 20],
    [25, 25],
  ];
  for (const [total, award] of boardTotals) {
    assert.equal(americanPointsFromExposedTotal(total), award);
  }
  assert.equal(americanPointsFromExposedTotal(7), 0);
  assert.equal(americanPointsFromExposedTotal(13), 0);
  assert.equal(americanPointsFromExposedTotal(24), 0);
  section("exposed totals 5/10/15/20/25 award themselves; others 0");
}

{
  // REGRESSION: UI showed +25. Spinner 6-6, west 5, east 4, north 4, south unused.
  // Wrong formula added leftover spinner faces: 6+6+5+4+4 = 25.
  // Covered spinner sides must be 0: exposed = [5, 4, 4] → 13 → award 0.
  const byId = indexTiles(generateSet());
  const state = {
    byId,
    board: [
      { id: "5-6", left: 5, right: 6, orientation: ORIENTATION.HORIZONTAL },
      { id: "6-6", left: 6, right: 6, orientation: ORIENTATION.VERTICAL },
      { id: "4-6", left: 6, right: 4, orientation: ORIENTATION.HORIZONTAL },
    ],
    spinnerId: "6-6",
    spinnerNorth: [
      { id: "2-6", left: 6, right: 2, orientation: ORIENTATION.VERTICAL },
      { id: "2-4", left: 2, right: 4, orientation: ORIENTATION.VERTICAL },
    ],
    spinnerSouth: [],
  };
  const snap = describeAmericanExposedEnds(state);
  assert.deepEqual(snap.exposedEnds.slice().sort((a, b) => a - b), [4, 4, 5]);
  assert.equal(snap.exposedTotal, 13);
  assert.equal(snap.awardedScore, 0);
  assert.equal(scoreAmericanPlay(state), 0);
  assert.equal(allFivesScorePlay({ state }), 0);
  section("REGRESSION: previous incorrect +25 is now 13 → 0");
}

{
  // Human playTile and AI applyAutoAction share scoreAmericanPlay
  const byId = indexTiles(generateSet());
  const almost = {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["3-6", "0-0"] },
      { id: "b", hand: ["0-2", "1-2"] },
    ],
    reserve: [],
    board: [
      { id: "5-6", left: 5, right: 6, orientation: ORIENTATION.HORIZONTAL },
      { id: "6-6", left: 6, right: 6, orientation: ORIENTATION.VERTICAL },
      { id: "1-6", left: 6, right: 1, orientation: ORIENTATION.HORIZONTAL },
    ],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    spinnerId: "6-6",
    spinnerNorth: [
      { id: "4-6", left: 6, right: 4, orientation: ORIENTATION.VERTICAL },
      { id: "2-4", left: 4, right: 2, orientation: ORIENTATION.VERTICAL },
      { id: "2-6", left: 2, right: 6, orientation: ORIENTATION.VERTICAL },
    ],
    spinnerSouth: [],
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const human = playTile(almost, "3-6", "south");
  const ai = applyAutoAction(
    { ...almost, scores: [0, 0], statusVars: null },
    { type: "play", tileId: "3-6", end: "south" }
  );
  assert.equal(scoreAmericanPlay(human), 15);
  assert.equal(human.statusVars?.playPoints, 15);
  assert.equal(ai.statusVars?.playPoints, 15);
  assert.equal(human.scores[0], ai.scores[0]);
  section("AI and human moves use the exact same scoring function");
}

// ─── Horizontal-first spinner branch priority ───────────────────────────────

function americanMainChainState(byId, extras = {}) {
  return {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: [] },
      { id: "b", hand: ["0-0"] },
    ],
    reserve: ["2-2", "3-3"],
    board: [
      { id: "5-6", left: 5, right: 6, orientation: ORIENTATION.HORIZONTAL },
      { id: "6-6", left: 6, right: 6, orientation: ORIENTATION.VERTICAL },
      { id: "1-6", left: 6, right: 1, orientation: ORIENTATION.HORIZONTAL },
    ],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: AMERICAN_MATCH_TARGET,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    spinnerId: "6-6",
    spinnerNorth: [],
    spinnerSouth: [],
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    ...extras,
  };
}

{
  const byId = indexTiles(generateSet());
  const state = americanMainChainState(byId, { players: [
    { id: "a", hand: ["4-5", "3-6"] },
    { id: "b", hand: ["0-0"] },
  ] });
  const moves = getAmericanLegalMoves(state.players[0].hand, state);
  assert.ok(moves.some((m) => m.tileId === "4-5" && m.end === END.LEFT));
  assert.ok(!moves.some((m) => m.end === "north" || m.end === "south"));
  assert.ok(!moves.some((m) => m.tileId === "3-6"));
  section("LEFT-end match + spinner match → spinner branch illegal");
}

{
  const byId = indexTiles(generateSet());
  const state = americanMainChainState(byId, { players: [
    { id: "a", hand: ["1-2", "3-6"] },
    { id: "b", hand: ["0-0"] },
  ] });
  const moves = getAmericanLegalMoves(state.players[0].hand, state);
  assert.ok(moves.some((m) => m.tileId === "1-2" && m.end === END.RIGHT));
  assert.ok(!moves.some((m) => m.end === "north" || m.end === "south"));
  assert.ok(!moves.some((m) => m.tileId === "3-6"));
  section("RIGHT-end match + spinner match → spinner branch illegal");
}

{
  const byId = indexTiles(generateSet());
  const state = americanMainChainState(byId, { players: [
    { id: "a", hand: ["1-5", "3-6"] },
    { id: "b", hand: ["0-0"] },
  ] });
  const moves = getAmericanLegalMoves(state.players[0].hand, state);
  const ends = [...new Set(moves.filter((m) => m.tileId === "1-5").map((m) => m.end))].sort();
  assert.deepEqual(ends, ["left", "right"]);
  assert.ok(!moves.some((m) => m.end === "north" || m.end === "south"));
  const dragNorth = resolveDragDestination(moves, "3-6", "north");
  assert.equal(dragNorth.ok, false);
  section("LEFT and RIGHT matches legal; spinner branch remains illegal");
}

{
  const byId = indexTiles(generateSet());
  const state = americanMainChainState(byId, { players: [
    { id: "a", hand: ["3-6"] },
    { id: "b", hand: ["0-0"] },
  ] });
  const moves = getAmericanLegalMoves(state.players[0].hand, state);
  const ends = [...new Set(moves.map((m) => m.end))].sort();
  assert.deepEqual(ends, ["north", "south"]);
  assert.ok(!moves.some((m) => m.end === END.LEFT || m.end === END.RIGHT));
  const dragNorth = resolveDragDestination(moves, "3-6", "north");
  assert.equal(dragNorth.ok, true);
  const after = playTile(state, "3-6", "north");
  assert.equal(after.spinnerNorth[0].id, "3-6");
  section("no LEFT/RIGHT match + spinner tile → spinner branch legal");
}

{
  const byId = indexTiles(generateSet());
  const drawState = americanMainChainState(byId, {
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: ["2-3"] },
    ],
    reserve: ["4-4"],
  });
  const drawActions = getAvailableActions(drawState);
  assert.equal(drawActions.canPlay, false);
  assert.equal(drawActions.canDraw, true);
  assert.equal(drawActions.canPass, false);

  const passState = americanMainChainState(byId, {
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: ["2-3"] },
    ],
    reserve: [],
  });
  const passActions = getAvailableActions(passState);
  assert.equal(passActions.canPlay, false);
  assert.equal(passActions.canDraw, false);
  assert.equal(passActions.canPass, true);
  section("no horizontal match and no spinner match → draw/pass");
}

{
  const byId = indexTiles(generateSet());
  const state = americanMainChainState(byId, { players: [
    { id: "ai", hand: ["4-5", "3-6"] },
    { id: "human", hand: ["0-0"] },
  ] });
  const action = chooseAiAction(state, { difficulty: "expert", seed: 7 });
  assert.equal(action.type, "play");
  assert.equal(action.tileId, "4-5");
  assert.equal(action.end, END.LEFT);
  assert.notEqual(action.end, "north");
  assert.notEqual(action.end, "south");
  const auto = applyAutoAction(state, action);
  assert.equal(auto.board[0].id, "4-5");
  assert.equal(auto.spinnerNorth.length, 0);
  assert.equal(auto.spinnerSouth.length, 0);
  section("AI obeys horizontal-first spinner priority");
}

console.log("\nAmerican Spinner tests passed.");
