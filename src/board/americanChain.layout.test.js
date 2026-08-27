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
  packAmericanArmLimit,
  packFirstRunLimit,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  MARGIN,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  resolveBoardTileBase,
} from "./layoutEngine.js";
import { resolveGameplayLayout } from "../ui/gameplayLayout.js";
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

function fourWayBoard(leftCount, rightCount, northCount, southCount) {
  const { board, spinnerId } = snakeBoard(leftCount, rightCount, 3);
  const north = [];
  let nPip = 3;
  for (let i = 1; i <= northCount; i += 1) {
    const next = (nPip + 3) % 7;
    north.push(tile(`N${i}`, nPip, next));
    nPip = next;
  }
  const south = [];
  let sPip = 3;
  for (let i = 1; i <= southCount; i += 1) {
    const next = (sPip + 4) % 7;
    south.push(tile(`S${i}`, sPip, next));
    sPip = next;
  }
  return { board, spinnerId, north, south };
}

const PHONE_PORTRAITS = Object.freeze([
  { name: "360", width: 360, height: 800 },
  { name: "384", width: 384, height: 832 },
  { name: "390", width: 390, height: 844 },
  { name: "402", width: 402, height: 874 },
  { name: "430", width: 430, height: 932 },
]);

function portraitStage(vp, rulesetId = "american") {
  const L = resolveGameplayLayout(
    { width: vp.width, height: vp.height },
    { playerCount: 2, rulesetId }
  );
  const stage = {
    width: Math.round(L.feltWidth),
    height: Math.round(L.feltHeight),
  };
  const size = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
  return { L, stage, size };
}

function layoutAmerican(pack, stage, size, extra = {}) {
  return calculateBoardLayout(pack.board, stage, americanOptions({
    tileWidth: size.w,
    tileHeight: size.h,
    spinnerId: pack.spinnerId,
    spinnerNorth: pack.north || [],
    spinnerSouth: pack.south || [],
    ...extra,
  }));
}

function measureFelt(layout, stage) {
  const boxes = boxesOf(layout);
  const play = computePlayBounds(stage, MARGIN, 0, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const aabb = computeChainBounds(
    boxes.map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h }))
  );
  const safeW = safe.maxX - safe.minX;
  const safeH = safe.maxY - safe.minY;
  return {
    boxes,
    safe,
    aabb,
    safeW,
    safeH,
    slackFracW: (safeW - aabb.width) / safeW,
    slackFracH: (safeH - aabb.height) / safeH,
    short: renderedShort(boxes),
  };
}

function assertInsideSafe(boxes, safe, label) {
  for (const b of boxes) {
    assert.ok(b.x >= safe.minX - 0.75, `${label} ${b.id} left`);
    assert.ok(b.y >= safe.minY - 0.75, `${label} ${b.id} top`);
    assert.ok(b.x + b.w <= safe.maxX + 0.75, `${label} ${b.id} right`);
    assert.ok(b.y + b.h <= safe.maxY + 0.75, `${label} ${b.id} bottom`);
  }
}

function verticalLaneCount(boxes) {
  const cols = new Set(
    boxes
      .filter((b) => b.h >= b.w - 0.5)
      .map((b) => Math.round((b.x + b.w / 2) / 12) * 12)
  );
  return cols.size;
}

{
  assert.equal(packAmericanArmLimit(900, 112, 59, 2), 2);
  assert.equal(packAmericanArmLimit(300, 112, 59, 2), 1);
  assert.equal(packAmericanArmLimit(332, 119, 63, 2, 3, 3), 1);
  assert.equal(packAmericanArmLimit(972, 223, 119, 2, 2, 2), 2);
  section("American spinner arms fold after 1 tile when 2-straight cannot fit width");
}

for (const phone of PHONE_PORTRAITS) {
  const { stage, size } = portraitStage(phone);
  const firstFloor = packFirstRunLimit(stage.height - 2 * MARGIN - 24, size.h, size.w, CHAIN_GAP);
  assert.ok(firstFloor <= 3, `${phone.name}: portrait first-run floor is wrap-early (${firstFloor})`);

  const shortPack = snakeBoard(2, 2);
  const shortLayout = layoutAmerican(shortPack, stage, size);
  const shortBoxes = boxesOf(shortLayout);
  const spin = shortBoxes.find((b) => b.id === shortPack.spinnerId);
  assert.equal(spin.orientation, "horizontal", `${phone.name} short: spinner horizontal`);
  assert.ok(spin.w > spin.h + 0.5);
  assert.ok(shortLayout.scale >= 0.99, `${phone.name} short chain keeps preferred scale, got ${shortLayout.scale}`);
  assertNoOverlap(shortBoxes, `${phone.name} short`);
  assert.ok(!shortLayout.camera?.overflow);

  const medPack = snakeBoard(4, 6);
  const medLayout = layoutAmerican(medPack, stage, size);
  const medM = measureFelt(medLayout, stage);
  assertNoOverlap(medM.boxes, `${phone.name} medium`);
  assertConnectedFaceGap(medM.boxes, medPack.board, medLayout, `${phone.name} medium`);
  assertInsideSafe(medM.boxes, medM.safe, `${phone.name} medium`);
  assert.ok(!medLayout.camera?.overflow, `${phone.name} medium overflow`);
  assert.ok(
    medM.short + 0.05 >= size.w * 0.72,
    `${phone.name} medium short ${medM.short.toFixed(1)} collapsed vs preferred ${size.w.toFixed(1)}`
  );

  const longPack = snakeBoard(8, 16);
  const longLayout = layoutAmerican(longPack, stage, size);
  const longM = measureFelt(longLayout, stage);
  assertNoOverlap(longM.boxes, `${phone.name} long`);
  assertConnectedFaceGap(longM.boxes, longPack.board, longLayout, `${phone.name} long`);
  assertInsideSafe(longM.boxes, longM.safe, `${phone.name} long`);
  assert.ok(!longLayout.camera?.overflow);
  assertParallelClearance(longM.boxes, longLayout, `${phone.name} long`);
  assert.ok(
    verticalLaneCount(longM.boxes) >= 2,
    `${phone.name} long chain must occupy more than one vertical lane`
  );
  assert.ok(
    longM.short + 0.05 >= 31,
    `${phone.name} long-chain short ${longM.short.toFixed(1)} must stay readable`
  );
  if (longLayout.scale < 0.97) {
    assert.ok(
      longM.slackFracW < 0.16 || longM.slackFracH < 0.12,
      `${phone.name} long: shrunk while leaving unused felt ` +
        `${(longM.slackFracW * 100).toFixed(0)}% × ${(longM.slackFracH * 100).toFixed(0)}%`
    );
  }

  const fullPack = snakeBoard(14, 13);
  const fullLayout = layoutAmerican(fullPack, stage, size);
  const fullM = measureFelt(fullLayout, stage);
  assert.equal(fullM.boxes.length, 28, `${phone.name} 28-tile count`);
  assertNoOverlap(fullM.boxes, `${phone.name} 28`);
  assertInsideSafe(fullM.boxes, fullM.safe, `${phone.name} 28`);
  assert.ok(!fullLayout.camera?.overflow);
  assert.ok(
    fullM.short + 0.05 >= 33,
    `${phone.name} 28-tile short ${fullM.short.toFixed(1)} must not collapse`
  );
  if (fullLayout.scale < 0.97) {
    assert.ok(
      fullM.slackFracW < 0.16 || fullM.slackFracH < 0.12,
      `${phone.name} 28: unused felt ${(fullM.slackFracW * 100).toFixed(0)}% × ${(fullM.slackFracH * 100).toFixed(0)}%`
    );
  }

  const topPack = snakeBoard(0, 8);
  const topLayout = layoutAmerican(topPack, stage, size);
  const topDirs = topLayout.tiles.map((t) => t.travelDir).join("");
  assert.ok(
    /E|W/.test(topDirs),
    `${phone.name} north-heavy chain must turn before the top bound, got ${topDirs}`
  );
  assert.ok(!topLayout.camera?.overflow);

  const botPack = snakeBoard(8, 0);
  const botLayout = layoutAmerican(botPack, stage, size);
  const botDirs = botLayout.tiles.map((t) => t.travelDir).join("");
  assert.ok(
    /E|W/.test(botDirs),
    `${phone.name} south-heavy chain must turn before the bottom bound, got ${botDirs}`
  );
  assert.ok(!botLayout.camera?.overflow);

  const branchPack = fourWayBoard(4, 4, 3, 3);
  const branchLayout = layoutAmerican(branchPack, stage, size);
  const branchBoxes = boxesOf(branchLayout);
  const branchSpin = branchBoxes.find((b) => b.id === branchPack.spinnerId);
  assert.equal(branchSpin.orientation, "horizontal", `${phone.name} branched spinner`);
  const n1 = branchBoxes.find((b) => b.id === "N1");
  const s1 = branchBoxes.find((b) => b.id === "S1");
  assert.ok(n1.x + n1.w <= branchSpin.x + 1, `${phone.name} NORTH sits left of spinner`);
  assert.ok(s1.x >= branchSpin.x + branchSpin.w - 1, `${phone.name} SOUTH sits right of spinner`);
  assertNoOverlap(branchBoxes, `${phone.name} branches`);
  assertInsideSafe(branchBoxes, measureFelt(branchLayout, stage).safe, `${phone.name} branches`);
  const branchM = measureFelt(branchLayout, stage);
  assert.ok(
    branchLayout.scale > 0.62,
    `${phone.name} branched scale ${branchLayout.scale.toFixed(3)} must beat the old 0.45 height-bound column`
  );
  assert.ok(
    branchM.short + 0.05 >= 38,
    `${phone.name} branched short ${branchM.short.toFixed(1)} must beat the old ~29 CSS`
  );
}
section("portrait 360–430: wrap-first American lanes keep readable scale");

{
  const { stage, size } = portraitStage({ name: "390", width: 390, height: 844 });
  const classic = calculateBoardLayout(snakeBoard(4, 6).board, stage, {
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    spinnerId: "5-5",
    rulesetId: "legacy",
  });
  const haitian = calculateBoardLayout(snakeBoard(4, 6).board, stage, {
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    spinnerId: "5-5",
    rulesetId: "haitian",
  });
  const classicSpin = classic.tiles.find((t) => t.tileId === "5-5");
  const haitianSpin = haitian.tiles.find((t) => t.tileId === "5-5");
  assert.ok(classicSpin.h > classicSpin.w + 0.5, "Classic spinner stays vertical");
  assert.ok(haitianSpin.h > haitianSpin.w + 0.5, "Haitian spinner stays vertical");
  const classicDirs = classic.tiles.map((t) => t.travelDir).join("");
  assert.ok(
    classicDirs.includes("E") || classicDirs.includes("W"),
    `Classic main chain stays E/W, got ${classicDirs}`
  );
  assert.ok(!classic.camera?.overflow);
  assert.ok(!haitian.camera?.overflow);
  section("Classic and Haitian geometry is unchanged by the American wrap path");
}

{
  const vp = { width: 1280, height: 720 };
  const classicWide = calculateBoardLayout(snakeBoard(5, 5).board, vp, {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    spinnerId: "5-5",
    rulesetId: "legacy",
  });
  const play = computePlayBounds(vp, MARGIN, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const firstRun = packFirstRunLimit(
    safe.maxX - safe.minX,
    TILE.h,
    TILE.w,
    CHAIN_GAP
  );
  const right = classicWide.tiles.filter((t) => String(t.tileId).startsWith("R"));
  const foldAt = Math.min(firstRun, 5, right.length);
  for (let i = 0; i < foldAt; i += 1) {
    assert.equal(
      right[i].travelDir,
      "E",
      `Classic right[${i}] stays E while 5-straight fits (floor ${firstRun}), got ${right.map((t) => t.travelDir).join("")}`
    );
  }
  const spin = classicWide.tiles.find((t) => t.tileId === "5-5");
  assert.ok(spin.h > spin.w + 0.5);
  section("Classic 5-straight ceiling still holds when the felt can fit it");
}

console.log("\nAmerican chain layout tests passed.");
