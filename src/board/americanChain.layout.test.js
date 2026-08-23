/**
 * American 🇺🇸 chain layout — horizontal spinner + parallel-run clearance.
 * Run: node src/board/americanChain.layout.test.js
 */
import assert from "node:assert/strict";
import {
  CHAIN_GAP,
  calculateBoardLayout,
  layoutBoard,
  measureMinRowClearance,
  parallelRunClearance,
  usesAmericanBoardLayout,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
} from "./layoutEngine.js";
import { END } from "../game/constants.js";
import { playTile, listLegalMoves } from "../game/index.js";
import { generateSet, indexTiles } from "../game/tiles.js";
import { createBoard } from "../game/board.js";
import { PHASE } from "../game/rules/constants.js";

const TILE = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

const PORTRAIT_STAGES = Object.freeze([
  { name: "narrow-portrait", width: 360, height: 520 },
  { name: "mid-portrait", width: 390, height: 580 },
  { name: "tall-portrait", width: 412, height: 640 },
]);

function section(title) {
  console.log(`✓ ${title}`);
}

function tile(id, left, right) {
  return { id, left, right };
}

function dbl(id, pip = 5) {
  return { id, left: pip, right: pip };
}

function americanOptions(extra = {}) {
  return {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    hudLeft: 0,
    rulesetId: "american",
    ...extra,
  };
}

function snakeBoard(leftCount, rightCount, pip = 5) {
  const id = `${pip}-${pip}`;
  const board = [dbl(id, pip)];
  let leftPip = pip;
  for (let i = 1; i <= leftCount; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = pip;
  for (let i = 1; i <= rightCount; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return { board, spinnerId: id };
}

function boxesOf(layout) {
  return [...layout.tiles, ...(layout.armTiles || [])].map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    rotation: t.rotation,
    travelDir: t.travelDir,
    double: t.double,
    branch: t.branch,
  }));
}

function renderedShort(boxes) {
  return Math.min(...boxes.map((b) => Math.min(b.w, b.h)));
}

function assertNoOverlap(boxes, label) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const hit =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.equal(hit, false, `${label}: ${a.id} overlaps ${b.id}`);
    }
  }
}

function assertConnectedFaceGap(boxes, board, layout, label) {
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  for (let i = 0; i < board.length - 1; i += 1) {
    const a = byId[board[i].id];
    const b = byId[board[i + 1].id];
    assert.ok(a && b, `${label}: missing ${board[i].id}→${board[i + 1].id}`);
    const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
    const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
    assert.ok(xOv || yOv, `${label}: disconnected ${a.id}→${b.id}`);
    assert.ok(!(xOv && yOv), `${label}: body underlap ${a.id}→${b.id}`);
    const bothH = a.w >= a.h - 0.5 && b.w >= b.h - 0.5;
    const bothV = a.h >= a.w - 0.5 && b.h >= b.w - 0.5;
    const collinear =
      (bothH && Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 6) ||
      (bothV && Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 6);
    if (!collinear) continue;
    const gap = yOv
      ? a.x >= b.x
        ? a.x - (b.x + b.w)
        : b.x - (a.x + a.w)
      : a.y >= b.y
        ? a.y - (b.y + b.h)
        : b.y - (a.y + a.h);
    assert.ok(
      gap >= Math.min(CHAIN_GAP, Number(layout.gap) || CHAIN_GAP) - 1.25 &&
        gap <= CHAIN_GAP + 2.5,
      `${label}: connected gap ${a.id}→${b.id} is ${gap}, expected ~${layout.gap ?? CHAIN_GAP}`
    );
  }
}

function assertParallelClearance(boxes, layout, label) {
  const rowClear = measureMinRowClearance(boxes);
  if (rowClear == null) return null;
  const short = renderedShort(boxes);
  const minClear = short + (Number(layout.gap) || CHAIN_GAP);
  assert.ok(
    rowClear + 1.25 >= minClear,
    `${label}: parallel rows ${rowClear.toFixed(2)}px apart, need >= ${minClear.toFixed(2)}`
  );
  return rowClear;
}

{
  assert.equal(usesAmericanBoardLayout("american"), true);
  assert.equal(usesAmericanBoardLayout("allFives"), true);
  assert.equal(usesAmericanBoardLayout("legacy"), false);
  assert.equal(usesAmericanBoardLayout("haitian"), false);
  assert.equal(parallelRunClearance(TILE, CHAIN_GAP), TILE.w + CHAIN_GAP);
  section("American layout policy is gated off Classic/Haitian");
}

{
  const { board, spinnerId } = snakeBoard(1, 1);
  const layout = calculateBoardLayout(board, { width: 900, height: 520 }, americanOptions({
    spinnerId,
  }));
  const spin = layout.tiles.find((t) => t.tileId === spinnerId);
  assert.ok(spin, "spinner present");
  assert.equal(spin.orientation, "horizontal");
  assert.equal(spin.rotation, 0);
  assert.ok(spin.w > spin.h + 0.5, `spinner ${spin.w}×${spin.h} must stay horizontal`);
  const left = layout.tiles.find((t) => t.tileId === "L1");
  const right = layout.tiles.find((t) => t.tileId === "R1");
  assert.equal(left.orientation, "vertical");
  assert.equal(right.orientation, "vertical");
  assert.ok(left.y + left.h <= spin.y + 1 || left.y >= spin.y + spin.h - 1);
  assert.ok(right.y + right.h <= spin.y + 1 || right.y >= spin.y + spin.h - 1);
  section("American spinner stays horizontal; main chain is vertical");
}

{
  const { board, spinnerId } = snakeBoard(1, 1);
  const classic = calculateBoardLayout(board, { width: 900, height: 520 }, {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    spinnerId,
    rulesetId: "legacy",
  });
  const spin = classic.tiles.find((t) => t.tileId === spinnerId);
  assert.ok(spin.h > spin.w + 0.5, "Classic spinner remains vertical");
  section("Classic spinner orientation is unchanged");
}

{
  const north = [tile("N1", 5, 2), tile("N2", 2, 1)];
  const south = [tile("S1", 5, 3), tile("S2", 3, 0)];
  const { board, spinnerId } = snakeBoard(2, 2);
  const layout = calculateBoardLayout(board, { width: 1100, height: 700 }, americanOptions({
    spinnerId,
    spinnerNorth: north,
    spinnerSouth: south,
  }));
  const boxes = boxesOf(layout);
  const spin = boxes.find((b) => b.id === spinnerId);
  assert.equal(spin.orientation, "horizontal");
  assert.ok(spin.w > spin.h + 0.5);
  const n1 = boxes.find((b) => b.id === "N1");
  const s1 = boxes.find((b) => b.id === "S1");
  assert.ok(n1.x + n1.w <= spin.x + 1, "north/spinner TOP branch is left of the horizontal spinner");
  assert.ok(s1.x >= spin.x + spin.w - 1, "south/spinner BOTTOM branch is right of the horizontal spinner");
  assertNoOverlap(boxes, "four-way");
  section("spinner branches attach to the left and right of the horizontal spinner");
}

for (const stage of PORTRAIT_STAGES) {
  const { board, spinnerId } = snakeBoard(6, 12);
  const layout = calculateBoardLayout(board, stage, americanOptions({ spinnerId }));
  const boxes = boxesOf(layout);
  assert.equal(boxes.length, board.length, `${stage.name}: every tile is placed`);
  const spin = boxes.find((b) => b.id === spinnerId);
  assert.equal(spin.orientation, "horizontal", `${stage.name}: spinner horizontal`);
  assert.ok(spin.w > spin.h + 0.5, `${stage.name}: spinner footprint`);
  assertNoOverlap(boxes, stage.name);
  assertConnectedFaceGap(boxes, board, layout, stage.name);
  const rowClear = assertParallelClearance(boxes, layout, stage.name);
  assert.ok(
    rowClear != null,
    `${stage.name}: long American chain must create parallel rows`
  );
  assert.ok(layout.scale > 0.2 && layout.scale <= 1, `${stage.name} scale`);
  assert.ok(!layout.camera?.overflow, `${stage.name}: stay on felt`);
  const ys = [...new Set(boxes.filter((b) => b.w >= b.h - 0.5).map((b) => Math.round(b.y)))];
  const xs = [...new Set(boxes.filter((b) => b.h >= b.w - 0.5).map((b) => Math.round(b.x)))];
  assert.ok(
    ys.length >= 2 || xs.length >= 2,
    `${stage.name}: uses table space with more than one parallel run`
  );
}
section("portrait stages keep parallel-row clearance without device CSS");

{
  const { board, spinnerId } = snakeBoard(8, 16);
  const layout = calculateBoardLayout(
    board,
    { width: 390, height: 580 },
    americanOptions({ spinnerId })
  );
  const boxes = boxesOf(layout);
  assertNoOverlap(boxes, "long-american");
  assertParallelClearance(boxes, layout, "long-american");
  assert.ok(!layout.camera?.overflow, "long American chain stays on the table");
  const aabbH =
    Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y));
  assert.ok(aabbH > renderedShort(boxes) * 3, "long chain uses vertical felt before crowding");
  section("long American chains use available table space");
}

{
  const { board, spinnerId } = snakeBoard(4, 10);
  const viaLayoutBoard = layoutBoard(
    board,
    board.findIndex((t) => t.id === spinnerId),
    { width: 360, height: 520 },
    TILE,
    { rulesetId: "american", spinnerId }
  );
  const spin = viaLayoutBoard.placements.find((p) => p.id === spinnerId);
  assert.ok(spin.w > spin.h + 0.5, "layoutBoard American spinner horizontal");
  const rowClear = measureMinRowClearance(viaLayoutBoard.placements);
  if (rowClear != null) {
    const short = renderedShort(viaLayoutBoard.placements);
    assert.ok(rowClear + 1.25 >= short + viaLayoutBoard.gap);
  }
  section("layoutBoard honors American rulesetId");
}

{
  const { board, spinnerId } = snakeBoard(0, 4);
  const haitian = calculateBoardLayout(board, { width: 800, height: 400 }, {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    spinnerId,
    rulesetId: "haitian",
  });
  const spin = haitian.tiles.find((t) => t.tileId === spinnerId);
  assert.ok(spin.h > spin.w + 0.5, "Haitian opening double stays vertical");
  section("Haitian double orientation is unchanged");
}

{
  const spinner = dbl("5-5", 5);
  const later = dbl("1-1", 1);
  const board = [
    tile("L1", 4, 5),
    spinner,
    tile("R1", 5, 6),
    tile("R2", 6, 1),
    later,
  ];
  const north = [tile("N1", 5, 2)];
  const south = [tile("S1", 5, 3)];
  const layout = calculateBoardLayout(
    board,
    { width: 900, height: 620 },
    americanOptions({ spinnerId: "5-5", spinnerNorth: north, spinnerSouth: south })
  );
  const boxes = boxesOf(layout);
  const spin = boxes.find((b) => b.id === "5-5");
  const extra = boxes.find((b) => b.id === "1-1");
  const n1 = boxes.find((b) => b.id === "N1");
  const s1 = boxes.find((b) => b.id === "S1");
  const east = boxes.find((b) => b.id === "R1");
  const west = boxes.find((b) => b.id === "L1");
  assert.equal(spin.orientation, "horizontal", "first spinner stays horizontal");
  assert.ok(spin.w > spin.h + 0.5);
  assert.ok(extra.h > extra.w + 0.5, "later double is a vertical chain tile, not a hub");
  assert.equal(extra.orientation, "vertical");
  assert.ok(west.y + west.h <= spin.y + 1 || west.y >= spin.y + spin.h - 1, "MAIN_LEFT stays on the vertical main chain");
  assert.ok(east.y + east.h <= spin.y + 1 || east.y >= spin.y + spin.h - 1, "MAIN_RIGHT stays on the vertical main chain");
  assert.ok(n1.x + n1.w <= spin.x + 1, "north branch attaches to the left of the spinner");
  assert.ok(s1.x >= spin.x + spin.w - 1, "south branch attaches to the right of the spinner");
  const spinCy = spin.y + spin.h / 2;
  assert.ok(Math.abs(n1.y + n1.h / 2 - spinCy) < spin.h * 2, "left branch stays on the spinner hub");
  assert.ok(Math.abs(s1.y + s1.h / 2 - spinCy) < spin.h * 2, "right branch stays on the spinner hub");
  assertNoOverlap(boxes, "later-double-hub");
  section("later doubles do not steal the American spinner hub");
}

{
  const { board, spinnerId } = snakeBoard(8, 16);
  const layout = calculateBoardLayout(
    board,
    { width: 390, height: 580 },
    americanOptions({ spinnerId })
  );
  const boxes = boxesOf(layout);
  const spin = boxes.find((b) => b.id === spinnerId);
  assert.equal(spin.orientation, "horizontal", "long chain keeps the original spinner horizontal");
  assert.ok(spin.w > spin.h + 0.5);
  const doubles = boxes.filter((b) => b.double);
  for (const tileBox of doubles) {
    if (tileBox.id === spinnerId) {
      assert.equal(tileBox.orientation, "horizontal");
    } else {
      assert.ok(
        tileBox.h > tileBox.w + 0.5,
        `${tileBox.id} on a long American chain is not a second hub`
      );
    }
  }
  const left = boxes.find((b) => b.id === "L1");
  const right = boxes.find((b) => b.id === "R1");
  assert.equal(left.branch, "MAIN_LEFT");
  assert.equal(right.branch, "MAIN_RIGHT");
  assert.ok(left.y + left.h <= spin.y + 2 || left.y >= spin.y + spin.h - 2);
  assert.ok(right.y + right.h <= spin.y + 2 || right.y >= spin.y + spin.h - 2);
  section("long American chains keep the original spinner topology");
}

{
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  let state = {
    seed: 1,
    byId,
    players: [
      { id: "you", hand: ["3-6", "3-3", "6-6", "2-3"] },
      { id: "leobest", hand: ["0-1", "0-2"] },
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
    targetScore: 150,
    rulesetId: "american",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  state = playTile(state, "3-6");
  assert.equal(state.spinnerId, null, "non-double opener is not the spinner");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "3-3", END.LEFT);
  assert.equal(state.spinnerId, "3-3", "first double becomes the spinner");
  state = { ...state, currentPlayer: 0 };
  state = playTile(state, "6-6", END.RIGHT);
  assert.equal(state.spinnerId, "3-3", "later double does not replace the spinner");
  const layout = calculateBoardLayout(
    state.board,
    { width: 720, height: 480 },
    americanOptions({ spinnerId: state.spinnerId })
  );
  const spin = layout.tiles.find((t) => t.tileId === "3-3");
  const later = layout.tiles.find((t) => t.tileId === "6-6");
  assert.equal(spin.orientation, "horizontal");
  assert.ok(later.h > later.w + 0.5, "played later double stays a chain tile");
  section("engine spinner identity matches the laid hub");
}

{
  const spinner = dbl("5-5", 5);
  const board = [spinner];
  let state = {
    seed: 2,
    byId: indexTiles(generateSet()),
    players: [
      { id: "you", hand: ["4-5", "5-6", "2-5", "1-5"] },
      { id: "leobest", hand: ["0-1", "0-2"] },
    ],
    reserve: [],
    board,
    spinnerId: "5-5",
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: 150,
    rulesetId: "american",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const moves = listLegalMoves(state, 0);
  const endsFor45 = [...new Set(moves.filter((m) => m.tileId === "4-5").map((m) => m.end))];
  assert.ok(endsFor45.includes(END.LEFT), "4-5 can continue MAIN_LEFT");
  assert.ok(endsFor45.includes(END.RIGHT), "4-5 can continue MAIN_RIGHT");
  assert.ok(endsFor45.includes(END.NORTH), "4-5 can attach to spinner left branch");
  assert.ok(endsFor45.includes(END.SOUTH), "4-5 can attach to spinner right branch");

  const leftPlay = playTile({ ...state, currentPlayer: 0 }, "4-5", END.NORTH);
  const rightPlay = playTile({ ...state, currentPlayer: 0 }, "4-5", END.SOUTH);
  assert.equal(leftPlay.spinnerNorth.at(-1)?.id, "4-5");
  assert.equal(rightPlay.spinnerSouth.at(-1)?.id, "4-5");

  const leftLayout = calculateBoardLayout(leftPlay.board, { width: 900, height: 620 }, americanOptions({
    spinnerId: "5-5",
    spinnerNorth: leftPlay.spinnerNorth,
    spinnerSouth: leftPlay.spinnerSouth,
  }));
  const rightLayout = calculateBoardLayout(rightPlay.board, { width: 900, height: 620 }, americanOptions({
    spinnerId: "5-5",
    spinnerNorth: rightPlay.spinnerNorth,
    spinnerSouth: rightPlay.spinnerSouth,
  }));
  const leftSpin = [...leftLayout.tiles, ...leftLayout.armTiles].find((t) => t.tileId === "5-5");
  const leftArm = [...leftLayout.tiles, ...leftLayout.armTiles].find((t) => t.tileId === "4-5");
  const rightSpin = [...rightLayout.tiles, ...rightLayout.armTiles].find((t) => t.tileId === "5-5");
  const rightArm = [...rightLayout.tiles, ...rightLayout.armTiles].find((t) => t.tileId === "4-5");
  assert.ok(leftArm.x + leftArm.w <= leftSpin.x + 1, "legal NORTH play sits on the spinner's left");
  assert.ok(rightArm.x >= rightSpin.x + rightSpin.w - 1, "legal SOUTH play sits on the spinner's right");
  section("legal play can choose the spinner's left or right branch");
}

console.log("\nAmerican chain layout tests passed.");
