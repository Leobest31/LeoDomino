/**
 * All Fives spinner scoring, main-chain priority, and HUD score hold.
 * Run: node src/game/rules/allFivesSpinner.test.js
 */

import assert from "node:assert/strict";
import { createTile, generateSet, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  exposedEndTotal,
  scoreAllFivesPlay,
} from "./allFivesScoring.js";
import {
  PLAY_SCORE_HOLD_MS,
  SPINNER_NORTH,
  SPINNER_SOUTH,
  collectExposedEndValues,
  getExposedBoardEnds,
  getAllFivesLegalMoves,
  hudScoresDuringHold,
  shouldShowPlayScorePopup,
  spinnerBranchesAvailable,
} from "./allFivesSpinner.js";
import { playTile } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import { isAutoPlaceable, resolvePlayChoice } from "../interaction.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function allFivesState(overrides = {}) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["2-3", "3-4", "5-6"] },
      { id: "b", hand: ["0-1", "0-2"] },
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
    targetScore: ALL_FIVES_MATCH_TARGET,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    ...overrides,
  };
}

function spinnerBoard() {
  let board = createBoard();
  board = placeTile(board, createTile(3, 3), END.RIGHT);
  return board;
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(2, 3), END.RIGHT);
  assert.equal(exposedEndTotal(board, { spinnerId: "3-3" }), 8);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "3-3" }), 0);
  section("3-3 spinner + 2-3 → 2+3+3=8, live 8 awards 0");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(3, 4), END.RIGHT);
  assert.equal(exposedEndTotal(board, { spinnerId: "3-3" }), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "3-3" }), 10);
  section("3-3 spinner + 4-3 → 4+3+3=10 live +10");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(2, 3), END.RIGHT);
  const values = collectExposedEndValues({ board, spinnerId: "3-3" });
  assert.deepEqual(values.slice().sort((a, b) => a - b), [2, 6]);
  section("one-sided spinner counts as terminal double plus the outer pip");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(3, 4), END.RIGHT);
  board = placeTile(board, createTile(2, 3), END.LEFT);
  const values = collectExposedEndValues({
    board,
    spinnerId: "3-3",
    spinnerNorth: [{ id: "3-5", left: 3, right: 5 }],
    spinnerSouth: [{ id: "3-6", left: 3, right: 6 }],
  });
  assert.equal(values.length, 4);
  assert.deepEqual(values.slice().sort((a, b) => a - b), [2, 4, 5, 6]);
  const total = values.reduce((sum, pip) => sum + pip, 0);
  assert.equal(total, 17);
  section("every active exposed branch endpoint is counted exactly once");
}

{
  assert.equal(shouldShowPlayScorePopup(0), false);
  assert.equal(shouldShowPlayScorePopup(10), true);
  const after = playTile(
    allFivesState({
      players: [
        { id: "a", hand: ["3-3", "2-3", "3-4"] },
        { id: "b", hand: ["0-1"] },
      ],
    }),
    "3-3"
  );
  assert.equal(after.lastPlayPoints, 0);
  assert.equal(shouldShowPlayScorePopup(after.lastPlayPoints), false);
  section("zero-point move produces no score popup");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["3-3", "2-3"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  state = playTile(state, "3-3");
  state = {
    ...state,
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["2-3", "5-6"] },
      state.players[1],
    ],
  };
  const after = playTile(state, "2-3", END.RIGHT);
  assert.equal(after.scores[0], 0);
  assert.equal(after.lastPlayPoints, 0);
  section("engine: 3-3 + 2-3 awards 0 (2+3+3=8 is not a live score)");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["3-3", "3-4"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  state = playTile(state, "3-3");
  state = {
    ...state,
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["3-4", "5-6"] },
      state.players[1],
    ],
  };
  const after = playTile(state, "3-4", END.RIGHT);
  assert.equal(after.scores[0], 10);
  assert.equal(after.lastPlayPoints, 10);
  section("engine: 3-3 + 4-3 awards +10 (4+3+3)");
}

{
  const board = placeTile(spinnerBoard(), createTile(3, 5), END.RIGHT);
  const state = allFivesState({
    board,
    spinnerId: "3-3",
    players: [
      { id: "a", hand: ["2-3", "0-5"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const moves = getAllFivesLegalMoves(state.players[0].hand, state);
  assert.equal(spinnerBranchesAvailable(state.players[0].hand, state), true);
  assert.ok(moves.some((m) => m.end === END.RIGHT && m.tileId === "0-5"));
  assert.ok(moves.some((m) => m.end === SPINNER_NORTH && m.tileId === "2-3"));
  assert.ok(moves.some((m) => m.end === END.LEFT && m.tileId === "2-3"));
  assert.equal(isAutoPlaceable(moves, "0-5"), true);
  assert.equal(isAutoPlaceable(moves, "2-3"), true);
  assert.equal(resolvePlayChoice(moves, "2-3")?.end, END.LEFT);
  assert.equal(resolvePlayChoice(moves, "2-3", SPINNER_NORTH)?.end, SPINNER_NORTH);
  section("Case C — unique main-chain end auto-places; spinner remains an explicit target");
}

{
  const board = placeTile(spinnerBoard(), createTile(2, 3), END.LEFT);
  const state = allFivesState({
    board,
    spinnerId: "3-3",
    players: [
      { id: "a", hand: ["3-5", "0-2"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const moves = getAllFivesLegalMoves(state.players[0].hand, state);
  assert.ok(moves.some((m) => m.end === END.LEFT && m.tileId === "0-2"));
  assert.ok(moves.some((m) => m.end === SPINNER_SOUTH && m.tileId === "3-5"));
  assert.equal(isAutoPlaceable(moves, "0-2"), true);
  section("legal left move does not hide spinner destinations for other tiles");
}

{
  const board = spinnerBoard();
  const state = allFivesState({
    board,
    spinnerId: "3-3",
    players: [
      { id: "a", hand: ["2-3"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const moves = getAllFivesLegalMoves(state.players[0].hand, state);
  assert.ok(moves.some((m) => m.end === END.LEFT));
  assert.ok(moves.some((m) => m.end === END.RIGHT));
  assert.ok(moves.some((m) => m.end === SPINNER_NORTH));
  assert.ok(moves.some((m) => m.end === SPINNER_SOUTH));
  assert.equal(isAutoPlaceable(moves, "2-3"), false);
  section("legal left+right+spinner → player must choose; no auto-play");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(3, 5), END.LEFT);
  board = placeTile(board, createTile(3, 6), END.RIGHT);
  const state = allFivesState({
    board,
    spinnerId: "3-3",
    players: [
      { id: "a", hand: ["2-3", "0-1"] },
      { id: "b", hand: ["0-4"] },
    ],
  });
  assert.equal(spinnerBranchesAvailable(state.players[0].hand, state), true);
  const moves = getAllFivesLegalMoves(state.players[0].hand, state);
  assert.equal(moves.some((m) => m.end === END.LEFT), false);
  assert.equal(moves.some((m) => m.end === END.RIGHT), false);
  assert.ok(moves.some((m) => m.end === SPINNER_NORTH && m.tileId === "2-3"));
  assert.ok(moves.some((m) => m.end === SPINNER_SOUTH && m.tileId === "2-3"));
  assert.equal(isAutoPlaceable(moves, "2-3"), false);
  assert.equal(resolvePlayChoice(moves, "2-3", SPINNER_NORTH)?.end, SPINNER_NORTH);
  assert.equal(resolvePlayChoice(moves, "2-3", SPINNER_SOUTH)?.end, SPINNER_SOUTH);
  assert.equal(resolvePlayChoice(moves, "2-3", END.LEFT), null);
  section("no legal left/right move → spinner branch becomes available");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(3, 5), END.LEFT);
  board = placeTile(board, createTile(3, 6), END.RIGHT);
  const state = allFivesState({
    board,
    spinnerId: "3-3",
    spinnerNorth: [{ id: "2-3", left: 3, right: 2, orientation: "vertical" }],
    players: [
      { id: "a", hand: ["3-4"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const moves = getAllFivesLegalMoves(state.players[0].hand, state);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].end, SPINNER_SOUTH);
  assert.equal(isAutoPlaceable(moves, "3-4"), true);
  assert.equal(resolvePlayChoice(moves, "3-4")?.end, SPINNER_SOUTH);
  section("Case A — one spinner destination auto-places");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(3, 5), END.LEFT);
  board = placeTile(board, createTile(3, 6), END.RIGHT);
  let state = allFivesState({
    board,
    spinnerId: "3-3",
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["2-3"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const north = playTile(state, "2-3", SPINNER_NORTH);
  assert.equal(north.spinnerNorth.length, 1);
  assert.equal(north.spinnerNorth[0].id, "2-3");
  assert.equal(north.spinnerSouth.length, 0);
  state = allFivesState({
    board,
    spinnerId: "3-3",
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["2-3"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const south = playTile(state, "2-3", SPINNER_SOUTH);
  assert.equal(south.spinnerSouth.length, 1);
  assert.equal(south.spinnerNorth.length, 0);
  assert.throws(() => playTile(state, "2-3", END.LEFT), /Illegal placement/);
  section("spinner branch drop is the exact chosen arm; invalid end rejected");
}

{
  assert.equal(PLAY_SCORE_HOLD_MS, 2000);
  const during = hudScoresDuringHold({
    scores: [20, 0],
    lastPlayPoints: 10,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(during, [10, 0]);
  const after = hudScoresDuringHold({
    scores: [20, 0],
    lastPlayPoints: 10,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 2000,
  });
  assert.deepEqual(after, [20, 0]);
  const zero = hudScoresDuringHold({
    scores: [10, 0],
    lastPlayPoints: 0,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(zero, [10, 0]);
  section("scoreboard lags ~2s behind table +N; zero-point has no hold");
}

{
  const values = collectExposedEndValues({
    board: [
      { id: "3-3", left: 3, right: 3 },
      { id: "3-4", left: 3, right: 4 },
    ],
  });
  assert.equal(
    values.reduce((sum, pip) => sum + pip, 0),
    10,
    "one-sided spinner 3-3 + outer 4 is 4+3+3, not last-two-tile 3+3+4 arithmetic"
  );
  section("exposed-end total is topology, not last-two-tile arithmetic");
}

{
  const board = openDouble(5);
  const ends = getExposedBoardEnds({ board, spinnerId: "5-5" });
  assert.equal(ends.length, 1);
  assert.equal(ends[0].type, "terminal-double");
  assert.deepEqual(ends[0].values, [5, 5]);
  assert.equal(ends.reduce((sum, end) => sum + end.value, 0), 10);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true, spinnerId: "5-5" }), 10);
  section("A. lone 5-5 is a main-line terminal double exposing 10");
}

function openDouble(pip) {
  return placeTile(createBoard(), createTile(pip, pip), END.RIGHT);
}

{
  let board = openDouble(5);
  board = placeTile(board, createTile(5, 3), END.RIGHT);
  const total = exposedEndTotal(board, { spinnerId: "5-5" });
  assert.equal(total, 13);
  section("B. one main side occupied: 3+5+5=13");
}

{
  let board = openDouble(5);
  board = placeTile(board, createTile(5, 1), END.LEFT);
  board = placeTile(board, createTile(5, 2), END.RIGHT);
  const ends = getExposedBoardEnds({ board, spinnerId: "5-5" });
  assert.equal(ends.some((end) => end.tileId === "5-5"), false);
  assert.equal(exposedEndTotal(board, { spinnerId: "5-5" }), 3);
  section("C. both main-chain sides consumed — double contributes 0");
}

{
  const board = openDouble(4);
  const total = exposedEndTotal(board, { spinnerId: "4-4" });
  assert.equal(total, 8);
  assert.equal(scoreAllFivesPlay({ board, isOpening: true, spinnerId: "4-4" }), 0);
  section("D. spinner with no branches — 4-4 contributes 8");
}

{
  let board = openDouble(4);
  board = placeTile(board, createTile(4, 6), END.RIGHT);
  const ends = getExposedBoardEnds({
    board,
    spinnerId: "4-4",
    spinnerNorth: [{ id: "4-1", left: 4, right: 1 }],
  });
  const byPort = Object.fromEntries(ends.map((end) => [end.port, end]));
  assert.equal(byPort.left, undefined, "empty left spinner port is not a scoring terminal");
  assert.equal(byPort.right.value, 6, "occupied right scores the outer 6");
  assert.equal(byPort.north.value, 1, "occupied north scores the outer 1");
  assert.equal(byPort.south, undefined, "empty south is inactive, not a scoring end");
  assert.equal(byPort.right.source, "terminal");
  assert.equal(byPort.north.source, "terminal");
  assert.equal(
    ends.filter((end) => end.source === "spinner-port").length,
    0,
    "empty TOP/BOTTOM are not extra spinner-port copies"
  );
  const total = ends.reduce((sum, end) => sum + end.value, 0);
  assert.equal(byPort.spinner.value, 8);
  assert.equal(byPort.spinner.type, "terminal-double");
  assert.equal(total, 15);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, spinnerId: "4-4", spinnerNorth: [{ id: "4-1", left: 4, right: 1 }] }), 15);
  section("E. one-sided spinner still counts both halves; empty south is not a terminal");
}

{
  let board = openDouble(4);
  board = placeTile(board, createTile(4, 6), END.RIGHT);
  const ends = getExposedBoardEnds({
    board,
    spinnerId: "4-4",
    spinnerNorth: [{ id: "4-1", left: 4, right: 1 }],
    spinnerSouth: [{ id: "4-2", left: 4, right: 2 }],
  });
  const spinnerPorts = ends.filter((end) => end.source === "spinner-port");
  assert.equal(spinnerPorts.length, 0, "unused left spinner port is not a scoring terminal");
  assert.equal(
    ends.filter((end) => end.port === "north" || end.port === "south" || end.port === "right")
      .every((end) => end.source === "terminal"),
    true
  );
  assert.equal(ends.reduce((sum, end) => sum + end.value, 0), 8 + 6 + 1 + 2);
  section("F. empty main side keeps spinner as terminal double; N/S outers also count");
}

{
  // Current 4-4 bug: leftmost spinner, right occupied, top occupied.
  // Old logic counted terminal 4-4 as 8 plus empty south 4 plus outer ends
  // 3 and 0 = 15. Occupied spinner faces must not add 4+4.
  let board = openDouble(4);
  board = placeTile(board, createTile(3, 4), END.RIGHT);
  const layout = {
    spinnerId: "4-4",
    spinnerNorth: [{ id: "0-4", left: 4, right: 0 }],
  };
  const ends = getExposedBoardEnds({ board, ...layout });
  const total = ends.reduce((sum, end) => sum + end.value, 0);
  const spinnerContribution = ends
    .filter((end) => end.tileId === "4-4")
    .reduce((sum, end) => sum + end.value, 0);
  assert.equal(spinnerContribution, 8, "one-sided 4-4 still counts both halves");
  assert.equal(total, 11);
  assert.equal(scoreAllFivesPlay({ board, isOpening: false, ...layout }), 0);
  assert.equal(
    ends.some((end) => end.port === "south"),
    false,
    "empty south is not a fourth copy of the spinner pip"
  );
  section("G. 4-4 one-sided + top 0 + right 3 = 11, not a 4-port 15");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const lone = openDouble(pip);
    assert.equal(
      exposedEndTotal(lone, { spinnerId: id }),
      pip * 2,
      `${id} lone`
    );

    let oneSide = placeTile(lone, createTile(pip, (pip + 1) % 7), END.RIGHT);
    const outer = (pip + 1) % 7;
    const oneExpected = outer + pip * 2;
    assert.equal(
      exposedEndTotal(oneSide, { spinnerId: id }),
      oneExpected,
      `${id} one main side: Y+X+X`
    );

    const both = placeTile(oneSide, createTile(pip, (pip + 2) % 7), END.LEFT);
    const bothExpected = outer + ((pip + 2) % 7);
    assert.equal(
      exposedEndTotal(both, { spinnerId: id }),
      bothExpected,
      `${id} both main sides: spinner internal`
    );
    assert.equal(
      getExposedBoardEnds({ board: both, spinnerId: id }).some((end) => end.tileId === id),
      false,
      `${id} enclosed spinner contributes 0`
    );

    const branched = getExposedBoardEnds({
      board: oneSide,
      spinnerId: id,
      spinnerNorth: [{ id: `n-${pip}`, left: pip, right: 0 }],
    });
    const spinnerOpen = branched.filter((end) => end.source === "spinner-port");
    assert.equal(spinnerOpen.length, 0, `${id} empty TOP/BOTTOM are not spinner-port copies`);
    const spinnerTerm = branched.find((end) => end.tileId === id);
    assert.equal(spinnerTerm?.reason, "spinner-terminal-double-on-main-line");
    assert.equal(spinnerTerm?.contribution, pip * 2);
    assert.equal(
      branched.some((end) => end.port === "south"),
      false,
      `${id} empty south is not a scoring end`
    );
  }
  section("H. exposure rules hold for 0-0 through 6-6");
}

{
  let board = spinnerBoard();
  board = placeTile(board, createTile(2, 3), END.LEFT);
  board = placeTile(board, createTile(3, 5), END.RIGHT);
  board = placeTile(board, createTile(5, 5), END.RIGHT);
  const ends = getExposedBoardEnds({ board, spinnerId: "3-3" });
  assert.equal(ends.find((end) => end.port === "right")?.value, 10);
  assert.equal(ends.find((end) => end.port === "right")?.type, "terminal-double");
  assert.equal(ends.some((end) => end.tileId === "3-3"), false);
  assert.equal(exposedEndTotal(board, { spinnerId: "3-3" }), 12);
  board = placeTile(board, createTile(5, 1), END.RIGHT);
  assert.equal(
    getExposedBoardEnds({ board, spinnerId: "3-3" }).some((end) => end.tileId === "5-5"),
    false
  );
  assert.equal(exposedEndTotal(board, { spinnerId: "3-3" }), 3);
  section("later non-spinner terminal doubles count both sides until extended");
}

console.log("\nAll Fives spinner tests passed.");
