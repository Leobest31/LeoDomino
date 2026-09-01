/**
 * LeoDomino American spinner scoring + arm legality (A–F).
 * Run: node src/game/rules/americanLeoDominoSpinner.test.js
 */
import assert from "node:assert/strict";
import { createTile, generateSet, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import { AMERICAN_MATCH_TARGET, AMERICAN_RULESET_ID } from "../rulesets/american.js";
import {
  explainAllFivesScore,
  exposedEndTotal,
} from "./allFivesScoring.js";
import {
  SPINNER_NORTH,
  SPINNER_SOUTH,
  areSpinnerArmsOpen,
  countSpinnerAttachments,
  getAllFivesLegalMoves,
  getCurrentTerminalEnds,
  isSpinnerExposedScoringTerminal,
} from "./allFivesSpinner.js";
import { getAvailableActions, getCurrentLegalMoves, playTile } from "./drawDominoes.js";
import { HAITIAN_RULESET_ID } from "../rulesets/haitian.js";
import { LEGACY_RULESET_ID } from "../rulesets/legacy.js";
import {
  ONLINE_ACTION_PLAY,
  applyOnlineAction,
} from "../../online/gameAuthority.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function contributions(report) {
  return Object.fromEntries(
    report.endpoints.map((end) => [end.port ?? end.branch, end.contribution])
  );
}

function americanState(overrides = {}) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [
      { id: "you", hand: ["6-6", "3-6"] },
      { id: "leobest", hand: ["0-1"] },
    ],
    reserve: [],
    board: createBoard(),
    spinnerId: null,
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
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
    ...overrides,
  };
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 3), END.RIGHT);
  const layout = { board, spinnerId: "6-6", spinnerNorth: [], spinnerSouth: [] };
  const ends = getCurrentTerminalEnds(layout);
  const values = ends.flatMap((end) =>
    Array.isArray(end.values) && end.values.length ? end.values : [end.contribution]
  );
  assert.deepEqual(values.slice().sort((a, b) => a - b), [3, 6, 6]);
  assert.equal(countSpinnerAttachments(board, "6-6"), 1);
  assert.equal(isSpinnerExposedScoringTerminal(board, "6-6"), true);
  const report = explainAllFivesScore(layout);
  assert.equal(report.exactTotal, 15);
  assert.equal(report.awarded, 15);
  assert.equal(exposedEndTotal(board, { spinnerId: "6-6" }), 15);

  let state = americanState({
    players: [
      { id: "you", hand: ["6-6", "3-6"] },
      { id: "leobest", hand: ["0-1"] },
    ],
  });
  state = playTile(state, "6-6");
  state = { ...state, currentPlayer: 0 };
  const after = playTile(state, "3-6", END.RIGHT);
  assert.equal(after.lastPlayPoints, 15);
  assert.equal(after.scores[0], 15);
  section("A. 6-6 + only 6-3: terminals 6,6,3 total 15 award +15");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 3), END.RIGHT);
  board = placeTile(board, createTile(6, 1), END.LEFT);
  const layout = { board, spinnerId: "6-6" };
  assert.equal(countSpinnerAttachments(board, "6-6"), 2);
  assert.equal(isSpinnerExposedScoringTerminal(board, "6-6"), false);
  const report = explainAllFivesScore(layout);
  assert.equal(
    report.endpoints.some((end) => end.sourceTileId === "6-6"),
    false
  );
  assert.deepEqual(contributions(report), { left: 1, right: 3 });
  assert.equal(report.exactTotal, 4);
  assert.equal(report.awarded, 0);
  section("B. two main attachments: spinner contributes 0; only outer ends");
}

{
  // Real-device +15 used the old engine: spinner double still counted after a
  // T-shape (one main + one arm). Reconstruct that topology from topology, not
  // visual orientation. 4-4 spinner, MAIN_RIGHT 4-6 (outer 6), NORTH 4-1 (outer 1).
  let board = placeTile(createBoard(), createTile(4, 4), END.RIGHT);
  board = placeTile(board, createTile(4, 6), END.RIGHT);
  const north = [{ id: "4-1", left: 4, right: 1 }];
  const layout = { board, spinnerId: "4-4", spinnerNorth: north, spinnerSouth: [] };
  assert.equal(countSpinnerAttachments(board, "4-4", north, []), 2);
  assert.equal(isSpinnerExposedScoringTerminal(board, "4-4", north, []), false);
  const report = explainAllFivesScore(layout);
  assert.equal(
    report.endpoints.some((end) => end.sourceTileId === "4-4"),
    false,
    "spinner 12 is excluded once two chain directions exist"
  );
  assert.deepEqual(contributions(report), { right: 6, north: 1 });
  assert.equal(report.exactTotal, 7);
  assert.equal(report.awarded, 0);
  assert.notEqual(report.awarded, 15);

  const altBoard = placeTile(
    placeTile(createBoard(), createTile(5, 5), END.RIGHT),
    createTile(5, 3),
    END.RIGHT
  );
  const altNorth = [{ id: "5-2", left: 5, right: 2 }];
  const alt = explainAllFivesScore({
    board: altBoard,
    spinnerId: "5-5",
    spinnerNorth: altNorth,
  });
  assert.deepEqual(contributions(alt), { right: 3, north: 2 });
  assert.equal(alt.exactTotal, 5);
  assert.equal(alt.awarded, 5);
  section("C. screenshot T-shape: 4-4 + 4-6 + north 4-1 → 6+1=7 award 0, not +15");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 3), END.RIGHT);
  const one = explainAllFivesScore({ board, spinnerId: "6-6" });
  assert.equal(one.exactTotal, 15);
  assert.equal(one.awarded, 15);
  assert.equal(one.endpoints.find((end) => end.sourceTileId === "6-6")?.contribution, 12);

  board = placeTile(board, createTile(6, 4), END.LEFT);
  const two = explainAllFivesScore({ board, spinnerId: "6-6" });
  assert.equal(countSpinnerAttachments(board, "6-6"), 2);
  assert.equal(
    two.endpoints.some((end) => end.sourceTileId === "6-6"),
    false
  );
  assert.deepEqual(contributions(two), { left: 4, right: 3 });
  assert.equal(two.exactTotal, 7);
  assert.equal(two.awarded, 0);

  let state = americanState({
    players: [
      { id: "you", hand: ["6-6", "3-6", "4-6"] },
      { id: "leobest", hand: ["0-1"] },
    ],
  });
  state = playTile(state, "6-6");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "3-6", END.RIGHT);
  assert.equal(state.lastPlayPoints, 15);
  state = { ...state, currentPlayer: 0 };
  const afterSecond = playTile(state, "4-6", END.LEFT);
  assert.equal(afterSecond.lastPlayPoints, 0);
  assert.equal(
    explainAllFivesScore({
      board: afterSecond.board,
      spinnerId: afterSecond.spinnerId,
    }).endpoints.some((end) => end.sourceTileId === "6-6"),
    false
  );
  section("D. second main attachment removes spinner-double at that transition");
}

{
  let board = placeTile(createBoard(), createTile(4, 4), END.RIGHT);
  board = placeTile(board, createTile(4, 6), END.RIGHT);
  board = placeTile(board, createTile(4, 5), END.LEFT);
  assert.equal(areSpinnerArmsOpen(board, "4-4"), true);
  const north = [{ id: "4-1", left: 4, right: 1 }];
  const oneArm = explainAllFivesScore({
    board,
    spinnerId: "4-4",
    spinnerNorth: north,
  });
  assert.equal(
    oneArm.endpoints.some((end) => end.sourceTileId === "4-4"),
    false
  );
  assert.deepEqual(contributions(oneArm), { left: 5, right: 6, north: 1 });
  assert.equal(oneArm.exactTotal, 12);
  assert.equal(oneArm.awarded, 0);

  const south = [{ id: "4-2", left: 4, right: 2 }];
  const bothArms = explainAllFivesScore({
    board,
    spinnerId: "4-4",
    spinnerNorth: north,
    spinnerSouth: south,
  });
  assert.deepEqual(contributions(bothArms), { left: 5, right: 6, north: 1, south: 2 });
  assert.equal(bothArms.exactTotal, 14);
  assert.equal(bothArms.awarded, 0);
  assert.equal(
    bothArms.endpoints.some((end) => end.sourceTileId === "4-4"),
    false
  );
  section("E. extra arms contribute only outer pips, never spinner 8/12 again");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  const opening = americanState({
    board,
    spinnerId: "6-6",
    currentPlayer: 0,
    players: [
      { id: "you", hand: ["3-6", "0-1"] },
      { id: "leobest", hand: ["0-2"] },
    ],
  });
  const local = playTile(opening, "3-6", END.RIGHT);
  const online = applyOnlineAction(opening, {
    seat: 0,
    action: { type: ONLINE_ACTION_PLAY, tileId: "3-6", end: END.RIGHT },
  });
  assert.equal(local.lastPlayPoints, 15);
  assert.equal(online.state.lastPlayPoints, 15);
  assert.equal(local.scores[0], online.state.scores[0]);
  assert.deepEqual(
    explainAllFivesScore({
      board: local.board,
      spinnerId: local.spinnerId,
    }).exactTotal,
    explainAllFivesScore({
      board: online.state.board,
      spinnerId: online.state.spinnerId,
    }).exactTotal
  );

  let tState = americanState({
    players: [
      { id: "you", hand: ["4-4", "4-6", "4-5", "1-4"] },
      { id: "leobest", hand: ["0-1"] },
    ],
  });
  tState = playTile(tState, "4-4");
  tState = { ...tState, currentPlayer: 0 };
  tState = playTile(tState, "4-6", END.RIGHT);
  tState = { ...tState, currentPlayer: 0 };
  const beforeLeft = tState;
  const localLeft = playTile(beforeLeft, "4-5", END.LEFT);
  const onlineLeft = applyOnlineAction(beforeLeft, {
    seat: 0,
    action: { type: ONLINE_ACTION_PLAY, tileId: "4-5", end: END.LEFT },
  });
  assert.equal(localLeft.lastPlayPoints, onlineLeft.state.lastPlayPoints);
  assert.equal(areSpinnerArmsOpen(localLeft.board, "4-4"), true);

  tState = { ...localLeft, currentPlayer: 0 };
  const localArm = playTile(tState, "1-4", SPINNER_NORTH);
  const onlineArm = applyOnlineAction(tState, {
    seat: 0,
    action: { type: ONLINE_ACTION_PLAY, tileId: "1-4", end: SPINNER_NORTH },
  });
  assert.equal(localArm.lastPlayPoints, onlineArm.state.lastPlayPoints);
  assert.equal(
    explainAllFivesScore({
      board: localArm.board,
      spinnerId: localArm.spinnerId,
      spinnerNorth: localArm.spinnerNorth,
    }).exactTotal,
    12
  );

  const mismatch = { ...tState, currentPlayer: 0, players: [
    { ...tState.players[0], hand: ["0-6"] },
    tState.players[1],
  ] };
  assert.throws(() => playTile(mismatch, "0-6", SPINNER_NORTH), /Illegal placement/);
  assert.throws(
    () =>
      applyOnlineAction(mismatch, {
        seat: 0,
        action: { type: ONLINE_ACTION_PLAY, tileId: "0-6", end: SPINNER_NORTH },
      }),
    /Illegal placement/
  );
  section("F. playTile and applyOnlineAction award the same totals; pip mismatch rejected");
}

{
  const lone = americanState({
    board: placeTile(createBoard(), createTile(4, 4), END.RIGHT),
    spinnerId: "4-4",
    players: [
      { id: "you", hand: ["4-6"] },
      { id: "leobest", hand: ["0-1"] },
    ],
  });
  const loneMoves = getAllFivesLegalMoves(lone.players[0].hand, lone);
  assert.equal(areSpinnerArmsOpen(lone.board, "4-4"), false);
  assert.equal(loneMoves.some((m) => m.end === SPINNER_NORTH || m.end === SPINNER_SOUTH), false);
  assert.ok(loneMoves.some((m) => m.end === END.LEFT || m.end === END.RIGHT));

  let oneSide = placeTile(lone.board, createTile(4, 6), END.RIGHT);
  const oneState = { ...lone, board: oneSide, players: [{ id: "you", hand: ["1-4"] }, lone.players[1]] };
  assert.equal(areSpinnerArmsOpen(oneSide, "4-4"), false);
  assert.equal(
    getAllFivesLegalMoves(["1-4"], oneState).some((m) => m.end === SPINNER_NORTH),
    false
  );
  assert.throws(() => playTile(oneState, "1-4", SPINNER_NORTH), /Illegal placement/);
  assert.throws(
    () =>
      applyOnlineAction(
        { ...oneState, currentPlayer: 0 },
        { seat: 0, action: { type: ONLINE_ACTION_PLAY, tileId: "1-4", end: SPINNER_NORTH } }
      ),
    /Illegal placement/
  );

  oneSide = placeTile(oneSide, createTile(4, 5), END.LEFT);
  const open = { ...oneState, board: oneSide, players: [{ id: "you", hand: ["1-4"] }, lone.players[1]] };
  assert.equal(areSpinnerArmsOpen(oneSide, "4-4"), true);
  const armMoves = getAllFivesLegalMoves(["1-4"], open);
  assert.ok(armMoves.some((m) => m.end === SPINNER_NORTH));
  assert.ok(armMoves.some((m) => m.end === SPINNER_SOUTH));
  const current = getCurrentLegalMoves(open);
  const available = getAvailableActions(open);
  assert.deepEqual(
    current.map((m) => `${m.tileId}:${m.end}`).sort(),
    available.legalMoves.map((m) => `${m.tileId}:${m.end}`).sort()
  );
  const onlineArm = applyOnlineAction(
    { ...open, currentPlayer: 0 },
    { seat: 0, action: { type: ONLINE_ACTION_PLAY, tileId: "1-4", end: SPINNER_NORTH } }
  );
  const localArm = playTile({ ...open, currentPlayer: 0 }, "1-4", SPINNER_NORTH);
  assert.equal(localArm.spinnerNorth.at(-1)?.id, "1-4");
  assert.equal(onlineArm.state.spinnerNorth.at(-1)?.id, "1-4");
  assert.equal(localArm.lastPlayPoints, onlineArm.state.lastPlayPoints);
  section("NORTH/SOUTH closed until both mains; then matching arm play is legal on client and server");
}

{
  const classic = americanState({
    rulesetId: LEGACY_RULESET_ID,
    board: placeTile(createBoard(), createTile(6, 6), END.RIGHT),
    spinnerId: "6-6",
    players: [
      { id: "you", hand: ["3-6", "1-6"] },
      { id: "rival", hand: ["0-1"] },
    ],
  });
  const classicMoves = getCurrentLegalMoves(classic);
  assert.equal(classicMoves.some((m) => m.end === SPINNER_NORTH || m.end === SPINNER_SOUTH), false);
  const afterClassic = playTile(classic, "3-6", END.RIGHT);
  assert.equal(afterClassic.lastPlayPoints == null || afterClassic.lastPlayPoints === 0, true);
  assert.equal(afterClassic.scores[0], 0);

  const haitian = americanState({
    rulesetId: HAITIAN_RULESET_ID,
    targetScore: 4,
    board: placeTile(createBoard(), createTile(6, 6), END.RIGHT),
    spinnerId: "6-6",
    players: [
      { id: "you", hand: ["3-6", "1-6"] },
      { id: "rival", hand: ["0-1"] },
    ],
  });
  const haitianMoves = getCurrentLegalMoves(haitian);
  assert.equal(haitianMoves.some((m) => m.end === SPINNER_NORTH || m.end === SPINNER_SOUTH), false);
  const afterHaitian = playTile(haitian, "3-6", END.RIGHT);
  assert.equal(afterHaitian.lastPlayPoints == null || afterHaitian.lastPlayPoints === 0, true);
  assert.equal(afterHaitian.scores[0], 0);
  section("Classic and Haitian stay linear two-end; they do not award American count points");
}

console.log("\nLeoDomino American spinner scoring tests passed.");
