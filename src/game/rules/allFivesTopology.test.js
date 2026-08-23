/**
 * Canonical American / All Fives exposed-end topology.
 * Run: node src/game/rules/allFivesTopology.test.js
 */

import assert from "node:assert/strict";
import { createTile, generateSet, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  explainAllFivesScore,
  formatAllFivesScoreReport,
  exposedEndTotal,
} from "./allFivesScoring.js";
import {
  PLAY_SCORE_HOLD_MS,
  SPINNER_NORTH,
  SPINNER_SOUTH,
  getOpenScoringEndpoints,
  getSpinnerPortStates,
  hudScoresDuringHold,
  shouldShowPlayScorePopup,
} from "./allFivesSpinner.js";
import { playTile } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import { calculateBoardLayout } from "../../board/layoutEngine.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function report(board, extra = {}) {
  return explainAllFivesScore({ board, isOpening: false, ...extra });
}

function valuesOf(rep) {
  return Object.fromEntries(rep.endpoints.map((end) => [end.branch, end.value]));
}

function allFivesState(overrides = {}) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: [] },
      { id: "b", hand: [] },
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

{
  const board = placeTile(createBoard(), createTile(6, 3), END.RIGHT);
  const rep = explainAllFivesScore({ board, isOpening: true, tileId: "3-6" });
  assert.equal(rep.exposedTotal, 9);
  assert.equal(rep.pointsAwarded, 0);
  assert.deepEqual(
    rep.endpoints.map((end) => end.value).sort(),
    [3, 6]
  );
  section("A. non-double opener 6-3 → 9, awards 0");
}

{
  const board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  const rep = explainAllFivesScore({ board, isOpening: true, tileId: "5-5" });
  assert.deepEqual(valuesOf(rep), { spinner: 10 });
  assert.equal(rep.exposedTotal, 10);
  assert.equal(rep.pointsAwarded, 10);
  section("B. double opener 5-5 → 10 points");
}

{
  let board = placeTile(createBoard(), createTile(6, 3), END.RIGHT);
  board = placeTile(board, createTile(3, 5), END.LEFT);
  const rep = report(board);
  assert.deepEqual(valuesOf(rep), { left: 5, right: 6 });
  assert.equal(rep.exposedTotal, 11);
  assert.equal(
    rep.endpoints.some((end) => end.value === 3),
    false,
    "connected 3s are internal"
  );
  section("C. one normal connection — only outer 5 and 6");
}

{
  let before = placeTile(createBoard(), createTile(6, 4), END.RIGHT);
  assert.equal(report(before).exposedTotal, 10);
  const after = placeTile(before, createTile(6, 1), END.RIGHT);
  const rep = report(after, { tileId: "1-6" });
  assert.equal(rep.exposedTotal, 5);
  assert.deepEqual(valuesOf(rep), { left: 4, right: 1 });
  assert.equal(
    rep.endpoints.some((end) => end.value === 6),
    false,
    "consumed 6 disappeared"
  );
  section("D. consumed endpoint disappears (4+6 → 4+1)");
}

{
  const board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  assert.equal(exposedEndTotal(board, { spinnerId: "6-6" }), 12);
  section("E. ordinary double with 2 exposed sides → 12");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 1), END.RIGHT);
  assert.equal(exposedEndTotal(board, { spinnerId: "6-6" }), 13);
  section("F. one-sided spinner 6-6 + 1 → 1+6+6=13");
}

{
  let board = placeTile(createBoard(), createTile(6, 6), END.RIGHT);
  board = placeTile(board, createTile(6, 1), END.LEFT);
  board = placeTile(board, createTile(6, 2), END.RIGHT);
  const rep = report(board, { spinnerId: "6-6" });
  assert.equal(rep.endpoints.some((end) => end.sourceTileId === "6-6"), false);
  assert.equal(rep.exposedTotal, 3);
  section("G. ordinary double with 0 exposed sides → 0");
}

{
  let board = placeTile(createBoard(), createTile(4, 4), END.RIGHT);
  board = placeTile(board, createTile(3, 4), END.RIGHT);
  const layout = {
    spinnerId: "4-4",
    spinnerNorth: [{ id: "0-4", left: 4, right: 0 }],
  };
  const ports = getSpinnerPortStates({ board, ...layout });
  assert.equal(ports.right.status, "occupied");
  assert.equal(ports.north.status, "occupied");
  assert.equal(ports.south.status, "inactive");
  const rep = report(board, layout);
  assert.equal(rep.endpoints.some((end) => end.branch === "south"), false);
  assert.equal(
    rep.endpoints.filter((end) => end.sourceTileId === "4-4").reduce((s, e) => s + e.value, 0),
    8
  );
  assert.equal(rep.exposedTotal, 11);
  assert.equal(rep.pointsAwarded, 0);
  assert.notEqual(rep.exposedTotal, 15);
  section("H. spinner 4-4 one-sided + 3 + north 0 = 11, empty south not a fourth 4");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const lone = placeTile(createBoard(), createTile(pip, pip), END.RIGHT);
    assert.equal(exposedEndTotal(lone, { spinnerId: id }), pip * 2);
    const one = placeTile(lone, createTile(pip, (pip + 1) % 7), END.RIGHT);
    assert.equal(exposedEndTotal(one, { spinnerId: id }), ((pip + 1) % 7) + pip * 2);
    const both = placeTile(one, createTile(pip, (pip + 2) % 7), END.LEFT);
    assert.equal(
      exposedEndTotal(both, { spinnerId: id }),
      ((pip + 1) % 7) + ((pip + 2) % 7)
    );
  }
  section("I. spinner 0-0 through 6-6: lone 2×, one side Y+X+X, both sides outer only");
}

{
  // Old 4-port model counted empty south (4) after north existed:
  // left 4 + consumed-or-new 6/1 + north 6 + south 4 → 15.
  let board = placeTile(createBoard(), createTile(4, 4), END.RIGHT);
  board = placeTile(board, createTile(4, 6), END.RIGHT);
  const layout = {
    spinnerId: "4-4",
    spinnerNorth: [
      { id: "2-4", left: 4, right: 2 },
      { id: "2-6", left: 2, right: 6 },
    ],
  };
  board = placeTile(board, createTile(1, 6), END.RIGHT);
  const rep = report(board, { ...layout, tileId: "1-6", end: END.RIGHT });
  assert.equal(rep.boardTileIds.includes("4-6"), true);
  assert.equal(
    rep.endpoints.some((end) => end.sourceTileId === "4-6"),
    false,
    "consumed 6 on 4-6 is internal"
  );
  assert.deepEqual(valuesOf(rep), { spinner: 8, right: 1, north: 6 });
  assert.equal(rep.exposedTotal, 15);
  assert.equal(rep.pointsAwarded, 15);
  const dump = formatAllFivesScoreReport(rep);
  assert.match(dump, /EXPOSED TOTAL: 15/);
  assert.match(dump, /POINTS: 15/);
  section("J. one-sided 4-4 + right 1 + north 6 = 15; empty south is not counted");
}

{
  // Old 4-port: 5-5 left + 5-3 right + north 2 + empty south 5 = 15.
  let board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  board = placeTile(board, createTile(3, 5), END.RIGHT);
  const layout = {
    spinnerId: "5-5",
    spinnerNorth: [{ id: "2-5", left: 5, right: 2 }],
  };
  const byId = indexTiles(generateSet());
  const rep = explainAllFivesScore({
    board,
    isOpening: false,
    tileId: "3-5",
    ...layout,
    byId,
  });
  assert.equal(rep.boardTileIds.includes("4-1"), false);
  assert.equal(rep.endpoints.some((end) => end.sourceTileId === "4-1"), false);
  assert.deepEqual(valuesOf(rep), { spinner: 10, right: 3, north: 2 });
  assert.equal(rep.exposedTotal, 15);
  assert.equal(rep.pointsAwarded, 15);
  const dump = formatAllFivesScoreReport(rep);
  assert.match(dump, /MOVE: 3-5/);
  assert.match(dump, /EXPOSED TOTAL: 15/);
  assert.match(dump, /POINTS: 15/);
  section("K. one-sided 5-5 + 3 + north 2 = 15; empty south is not a fourth 5");
}

{
  const board = placeTile(createBoard(), createTile(2, 5), END.RIGHT);
  const after = placeTile(board, createTile(3, 5), END.RIGHT);
  const byId = indexTiles([
    createTile(2, 5),
    createTile(3, 5),
    createTile(4, 1),
  ]);
  const rep = explainAllFivesScore({
    board: after,
    isOpening: false,
    tileId: "3-5",
    byId,
  });
  assert.equal(after.some((tile) => tile.id === "1-4" || tile.id === "4-1"), false);
  assert.equal(rep.endpoints.some((end) => String(end.sourceTileId).includes("4-1")), false);
  assert.equal(rep.endpoints.some((end) => String(end.sourceTileId).includes("1-4")), false);
  assert.deepEqual(valuesOf(rep), { left: 2, right: 3 });
  assert.equal(rep.exposedTotal, 5);
  section("L. unplayed 4-1 cannot affect scoring");
}

{
  let board = placeTile(createBoard(), createTile(0, 0), END.RIGHT);
  board = placeTile(board, createTile(0, 5), END.RIGHT);
  const rep = report(board);
  assert.equal(rep.exposedTotal, 5);
  assert.equal(rep.pointsAwarded, 5);
  section("M. live exact 5 awards +5");
}

{
  const board = placeTile(createBoard(), createTile(4, 6), END.RIGHT);
  const rep = explainAllFivesScore({ board, isOpening: true });
  assert.equal(rep.exposedTotal, 10);
  assert.equal(rep.pointsAwarded, 10);
  section("N. valid +10");
}

{
  let board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  board = placeTile(board, createTile(4, 5), END.RIGHT);
  const rep = report(board, {
    spinnerId: "5-5",
    spinnerNorth: [{ id: "n-6", left: 5, right: 6 }],
  });
  assert.equal(rep.exposedTotal, 20);
  assert.equal(rep.pointsAwarded, 20);
  section("O. valid +20 from spinner double + 4 + north 6");
}

{
  let board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  board = placeTile(board, createTile(4, 5), END.RIGHT);
  const rep = report(board, {
    spinnerId: "5-5",
    spinnerNorth: [{ id: "n-6", left: 5, right: 6 }],
    spinnerSouth: [{ id: "s-5", left: 5, right: 5 }],
  });
  assert.equal(rep.exposedTotal, 30);
  assert.equal(rep.pointsAwarded, 30);
  assert.equal(
    rep.terminals.find((end) => end.sourceTileId === "s-5")?.type,
    "terminal-double"
  );
  assert.equal(
    rep.terminals.find((end) => end.sourceTileId === "s-5")?.contribution,
    10
  );
  section("P. valid +30 from spinner double + 4 + north 6 + south 5-5");
}

{
  let board = placeTile(createBoard(), createTile(3, 3), END.RIGHT);
  board = placeTile(board, createTile(3, 2), END.RIGHT);
  const rep = report(board, { spinnerId: "3-3" });
  assert.equal(rep.exposedTotal, 8);
  assert.equal(rep.pointsAwarded, 0);
  assert.equal(shouldShowPlayScorePopup(rep.pointsAwarded), false);
  section("Q. zero-point move");
}

{
  let state = allFivesState({
    currentPlayer: 1,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["5-5", "1-2"] },
    ],
  });
  const after = playTile(state, "5-5");
  assert.equal(after.scores[1], 10);
  assert.equal(after.lastPlayPoints, 10);
  assert.equal(after.lastPlayPointsSeat, 1);
  section("R. AI scoring uses the same playTile pipeline");
}

{
  let board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  board = placeTile(board, createTile(4, 5), END.RIGHT);
  const layout = {
    spinnerId: "5-5",
    spinnerNorth: [{ id: "n-6", left: 5, right: 6 }],
  };
  const a = report(board, layout);
  const b = report(board, layout);
  calculateBoardLayout(board, { width: 390, height: 700 }, {
    tileWidth: 72,
    tileHeight: 136,
    spinnerId: "5-5",
  });
  calculateBoardLayout(board, { width: 1280, height: 720 }, {
    tileWidth: 40,
    tileHeight: 76,
    spinnerId: "5-5",
  });
  assert.deepEqual(a.endpoints, b.endpoints);
  assert.equal(a.exposedTotal, b.exposedTotal);
  assert.equal(a.pointsAwarded, 20);
  section("S. same topology after resize → identical score");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["4-4", "4-6", "2-4", "2-6", "1-6", "0-0"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  state = playTile(state, "4-4");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "4-6", END.RIGHT);
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "2-4", SPINNER_NORTH);
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "2-6", SPINNER_NORTH);
  state = { ...state, currentPlayer: 0 };
  const after = playTile(state, "1-6", END.RIGHT);
  const expected = explainAllFivesScore({
    board: after.board,
    spinnerId: after.spinnerId,
    spinnerNorth: after.spinnerNorth,
    spinnerSouth: after.spinnerSouth,
    tileId: "1-6",
    end: END.RIGHT,
  });
  assert.deepEqual(valuesOf(expected), { spinner: 8, right: 1, north: 6 });
  assert.equal(expected.exposedTotal, 15);
  assert.equal(after.lastPlayPoints, 15);
  section("J-engine. playTile 6-1 awards +15 from spinner double + 1 + 6");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["5-5", "2-5", "3-5", "0-0"] },
      { id: "b", hand: ["1-4", "0-1"] },
    ],
    reserve: ["6-6"],
  });
  state = playTile(state, "5-5");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "2-5", SPINNER_NORTH);
  state = { ...state, currentPlayer: 0 };
  const after = playTile(state, "3-5", END.RIGHT);
  assert.equal(after.board.some((tile) => tile.id === "1-4" || tile.id === "4-1"), false);
  assert.equal(after.players[1].hand.includes("1-4"), true);
  const expected = explainAllFivesScore({
    board: after.board,
    spinnerId: after.spinnerId,
    spinnerNorth: after.spinnerNorth,
    spinnerSouth: after.spinnerSouth,
    tileId: "3-5",
    end: END.RIGHT,
    byId: after.byId,
  });
  assert.equal(expected.endpoints.some((end) => end.sourceTileId === "4-1"), false);
  assert.deepEqual(valuesOf(expected), { spinner: 10, right: 3, north: 2 });
  assert.equal(expected.exposedTotal, 15);
  assert.equal(after.lastPlayPoints, 15);
  section("K-engine. playTile 5-3 awards +15; unplayed 4-1 cannot affect score");
}

{
  const boardIds = new Set(["2-5", "3-5"]);
  let board = placeTile(createBoard(), createTile(2, 5), END.RIGHT);
  board = placeTile(board, createTile(3, 5), END.RIGHT);
  const hands = ["4-1", "6-6"];
  const reserve = ["0-0"];
  const rep = report(board);
  for (const end of rep.endpoints) {
    assert.ok(boardIds.has(end.sourceTileId), `A: ${end.sourceTileId} on board`);
  }
  assert.equal(rep.endpoints.every((end) => end.branch === "left" || end.branch === "right"), true);
  const ports = new Set(rep.endpoints.map((end) => `${end.branch}:${end.sourcePort}`));
  assert.equal(ports.size, rep.endpoints.length, "D: unique physical endpoints");
  for (const id of [...hands, ...reserve]) {
    assert.equal(rep.endpoints.some((end) => end.sourceTileId === id), false, `E: ${id}`);
  }

  let spinnerBoard = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  spinnerBoard = placeTile(spinnerBoard, createTile(3, 5), END.RIGHT);
  const spinnerLayout = {
    spinnerId: "5-5",
    spinnerNorth: [{ id: "2-5", left: 5, right: 2 }],
  };
  const occupied = getSpinnerPortStates({ board: spinnerBoard, ...spinnerLayout });
  const openEnds = getOpenScoringEndpoints({ board: spinnerBoard, ...spinnerLayout });
  assert.equal(occupied.right.status, "occupied");
  assert.equal(occupied.north.status, "occupied");
  assert.equal(occupied.south.status, "inactive");
  assert.equal(
    openEnds.some((end) => end.source === "spinner-port" && end.branch === "right"),
    false,
    "C: occupied right spinner port is not a scoring end"
  );
  assert.equal(
    openEnds.some((end) => end.branch === "south"),
    false,
    "C: inactive south port is not a scoring end"
  );
  section("invariants A–E + C: board-only, open, unique, occupied ports excluded");
}

{
  for (let a = 0; a <= 6; a += 1) {
    for (let b = 0; b <= 6; b += 1) {
      for (let c = 0; c <= 6; c += 1) {
        const first = createTile(a, b);
        const second = createTile(b, c);
        if (first.id === second.id) continue;
        let board = placeTile(createBoard(), first, END.RIGHT);
        try {
          board = placeTile(board, second, END.RIGHT);
        } catch {
          continue;
        }
        const rep = report(board, { spinnerId: first.a === first.b ? first.id : null });
        const left = board[0].left;
        const right = board[board.length - 1].right;
        const expectedLeft = Number(left);
        const firstIsSpinner = Number(first.a) === Number(first.b);
        const secondIsSpinner = !firstIsSpinner && Number(second.a) === Number(second.b);
        const leftEnd = rep.endpoints.find((e) => e.branch === "left");
        const rightEnd = rep.endpoints.find((e) => e.branch === "right");
        if (firstIsSpinner) {
          assert.equal(
            leftEnd,
            undefined,
            `${first.id}+${second.id}: empty main left is not a separate terminal`
          );
          assert.equal(
            rep.endpoints.find((e) => e.branch === "spinner")?.value,
            Number(first.a) * 2
          );
        } else {
          assert.equal(leftEnd?.value, expectedLeft);
        }
        if (secondIsSpinner) {
          assert.equal(
            rightEnd,
            undefined,
            `${first.id}+${second.id}: empty main right is not a separate terminal`
          );
          assert.equal(
            rep.endpoints.find((e) => e.branch === "spinner")?.value,
            Number(second.a) * 2
          );
        } else {
          assert.equal(rightEnd?.value, Number(right));
        }
        const internalMatch = Number(board[0].right);
        if (board.length === 2 && Number(board[0].left) !== Number(board[0].right)) {
          const countB = rep.endpoints.filter((e) => e.value === internalMatch).length;
          const outerIsB = Number(board[0].left) === internalMatch || Number(right) === internalMatch;
          if (!outerIsB) assert.equal(countB, 0, `${first.id}+${second.id} leaked internal ${internalMatch}`);
        }
      }
    }
  }
  section("two-tile transitions: outer ends only, never a+b+b+c");
}

{
  const steps = [];
  let board = placeTile(createBoard(), createTile(5, 5), END.RIGHT);
  let north = [];
  let south = [];
  const snap = (label) => {
    const rep = report(board, { spinnerId: "5-5", spinnerNorth: north, spinnerSouth: south });
    steps.push({ label, total: rep.exposedTotal, ends: valuesOf(rep), points: rep.pointsAwarded });
    return rep;
  };

  let r = snap("spinner alone");
  assert.deepEqual(valuesOf(r), { spinner: 10 });

  board = placeTile(board, createTile(0, 5), END.LEFT);
  r = snap("left");
  assert.deepEqual(valuesOf(r), { left: 0, spinner: 10 });

  board = placeTile(board, createTile(1, 5), END.RIGHT);
  r = snap("right");
  assert.deepEqual(valuesOf(r), { left: 0, right: 1 });

  north = [{ id: "2-5", left: 5, right: 2 }];
  r = snap("top");
  assert.deepEqual(valuesOf(r), { left: 0, right: 1, north: 2 });
  assert.equal(r.endpoints.some((e) => e.branch === "south"), false);

  south = [{ id: "3-5", left: 5, right: 3 }];
  r = snap("bottom");
  assert.deepEqual(valuesOf(r), { left: 0, right: 1, north: 2, south: 3 });

  board = placeTile(board, createTile(0, 6), END.LEFT);
  r = snap("extend left");
  assert.deepEqual(valuesOf(r), { left: 6, right: 1, north: 2, south: 3 });

  board = placeTile(board, createTile(1, 4), END.RIGHT);
  r = snap("extend right");
  assert.deepEqual(valuesOf(r), { left: 6, right: 4, north: 2, south: 3 });
  assert.equal(r.exposedTotal, 15);
  assert.equal(r.pointsAwarded, 15);

  north = [...north, { id: "2-6", left: 2, right: 6 }];
  r = snap("extend top");
  assert.deepEqual(valuesOf(r), { left: 6, right: 4, north: 6, south: 3 });

  south = [...south, { id: "3-6", left: 3, right: 6 }];
  r = snap("extend bottom");
  assert.deepEqual(valuesOf(r), { left: 6, right: 4, north: 6, south: 6 });
  assert.equal(r.endpoints.filter((e) => e.sourceTileId === "5-5").length, 0);
  section("spinner branch growth: exact endpoints after every step");
}

{
  assert.equal(PLAY_SCORE_HOLD_MS, 2000);
  assert.equal(shouldShowPlayScorePopup(15), true);
  assert.equal(shouldShowPlayScorePopup(0), false);
  const during = hudScoresDuringHold({
    scores: [35, 0],
    lastPlayPoints: 15,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
    holdMs: 2000,
  });
  assert.deepEqual(during, [20, 0], "felt +15 while scoreboard still 20");
  const after = hudScoresDuringHold({
    scores: [35, 0],
    lastPlayPoints: 15,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 2000,
    holdMs: 2000,
  });
  assert.deepEqual(after, [35, 0], "scoreboard reflects +15 after 2s");
  const zero = hudScoresDuringHold({
    scores: [20, 0],
    lastPlayPoints: 0,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(zero, [20, 0]);
  const second = hudScoresDuringHold({
    scores: [45, 0],
    lastPlayPoints: 10,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(second, [35, 0], "consecutive scoring uses the latest hold");
  section("score popup ~2s then scoreboard; zero has no popup");
}

{
  const log = [];
  let state = allFivesState({
    players: [
      {
        id: "a",
        hand: ["5-5", "0-5", "1-5", "2-5", "3-5", "0-6", "1-4", "0-2", "0-4", "2-6", "6-6"],
      },
      { id: "b", hand: ["4-4"] },
    ],
  });
  const plays = [
    ["5-5", undefined],
    ["0-5", END.LEFT],
    ["1-5", END.RIGHT],
    ["2-5", SPINNER_NORTH],
    ["3-5", SPINNER_SOUTH],
    ["0-6", END.LEFT],
    ["1-4", END.RIGHT],
    ["0-2", SPINNER_NORTH],
    ["0-4", END.RIGHT],
    ["2-6", END.LEFT],
  ];
  for (const [tileId, end] of plays) {
    state = { ...state, currentPlayer: 0, players: [{ ...state.players[0], hand: [...state.players[0].hand] }, state.players[1]] };
    if (!state.players[0].hand.includes(tileId)) {
      state = {
        ...state,
        players: [{ ...state.players[0], hand: [tileId, ...state.players[0].hand] }, state.players[1]],
      };
    }
    state = playTile(state, tileId, end);
    const expected = explainAllFivesScore({
      board: state.board,
      isOpening: log.length === 0,
      spinnerId: state.spinnerId,
      spinnerNorth: state.spinnerNorth,
      spinnerSouth: state.spinnerSouth,
      tileId,
      end,
    });
    log.push({
      tile: tileId,
      ends: valuesOf(expected),
      total: expected.exposedTotal,
      expected: expected.pointsAwarded,
      awarded: state.lastPlayPoints,
    });
    assert.equal(
      state.lastPlayPoints,
      expected.pointsAwarded,
      `${tileId}: awarded ${state.lastPlayPoints} vs topology ${expected.pointsAwarded} total=${expected.exposedTotal}`
    );
  }
  assert.equal(log.length, 10);
  const scored = log.filter((row) => row.awarded > 0);
  assert.ok(scored.length >= 1);
  const mismatches = log.filter((row) => row.awarded !== row.expected);
  assert.equal(mismatches.length, 0, JSON.stringify(mismatches));
  section(`10 consecutive legal plays, zero scoring mismatches`);
}

console.log("\nAll Fives topology scoring tests passed.");
