/**
 * Preferred board tile size on expanded tablet-landscape felt.
 * Run: node src/board/boardPlayableSize.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  BOARD_TILE_HAND_FACTOR,
  BOARD_BASE_SHORT_MAX_PX,
  resolveBoardTileBase,
} from "./layoutEngine.js";
import {
  estimateFeltHeight,
  TABLET_LANDSCAPE_CHROME_AFTER,
} from "../ui/gameplayOrientation.js";
import { GAMEPLAY_REF } from "../ui/gameplayLayout.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

assert.equal(BOARD_TILE_HAND_FACTOR, 2.93);
assert.equal(LOCKED_BOARD_TILE_SHORT_PX, GAMEPLAY_REF.playedShort);
assert.equal(LOCKED_BOARD_TILE_LONG_PX, GAMEPLAY_REF.playedLong);

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function shortMediumChain() {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= 2; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= 2; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return { board, north: [], south: [] };
}

function mediumChain() {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= 3; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= 3; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return { board, north: [], south: [] };
}

function longSpinner() {
  const packed = mediumChain();
  packed.north = [
    tile("N1", 3, 6),
    tile("N2", 6, 1),
    tile("N3", 1, 4),
  ];
  packed.south = [
    tile("S1", 3, 0),
    tile("S2", 0, 5),
    tile("S3", 5, 2),
  ];
  packed.board.unshift(tile("L5", 2, packed.board[0].left));
  packed.board.push(tile("R5", packed.board[packed.board.length - 1].right, 4));
  return packed;
}

function layoutOf(vp, packed) {
  return calculateBoardLayout(packed.board, vp, {
    centerTileId: "3-3",
    tileWidth: locked.w,
    tileHeight: locked.h,
    hudRight: 0,
    spinnerId: "3-3",
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

/** Inner felt on 1280×800 tablet landscape (full-width shell, 97% stage, 8px wood). */
const TABLET_FELT = {
  width: Math.round(1280 * 0.94 * 0.97 - 16),
  height: estimateFeltHeight(800, TABLET_LANDSCAPE_CHROME_AFTER),
};

{
  const base = resolveBoardTileBase(TABLET_FELT, {
    w: GAMEPLAY_REF.playedShort,
    h: GAMEPLAY_REF.playedLong,
  });
  assert.ok(
    base.w >= GAMEPLAY_REF.playedShort - 2,
    `tablet landscape must keep preferred short side, got ${base.w}`
  );
  assert.ok(base.w <= BOARD_BASE_SHORT_MAX_PX);
  const oldCap = Math.min(TABLET_FELT.width / 14, TABLET_FELT.height / 6.5);
  assert.ok(
    base.w > oldCap + 4,
    `must not use old vw/14·vh/6.5 cap ${oldCap}, got ${base.w}`
  );
}

{
  const packed = shortMediumChain();
  const layout = layoutOf(TABLET_FELT, packed);
  assert.equal(layout.tiles.length, packed.board.length);
  assert.ok(
    layout.scale >= 0.99,
    `short/medium chain on 1280×800 felt should stay preferred, scale=${layout.scale}`
  );
  const sample = layout.tiles.find((t) => t.tileId === "3-3");
  assert.ok(sample.w >= GAMEPLAY_REF.playedShort - 2, `spinner short ${sample.w}`);
  const play = computePlayBounds(TABLET_FELT, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const t of layout.tiles) {
    assert.ok(t.x >= safe.minX - 0.75);
    assert.ok(t.y >= safe.minY - 0.75);
    assert.ok(t.x + t.w <= safe.maxX + 0.75);
    assert.ok(t.y + t.h <= safe.maxY + 0.75);
  }
  assert.equal(layout.camera?.overflow, false);
}

{
  const packed = mediumChain();
  const layout = layoutOf(TABLET_FELT, packed);
  assert.equal(layout.tiles.length, packed.board.length);
  assert.ok(layout.scale <= 1);
  const play = computePlayBounds(TABLET_FELT, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const t of layout.tiles) {
    assert.ok(t.x >= safe.minX - 0.75);
    assert.ok(t.y >= safe.minY - 0.75);
    assert.ok(t.x + t.w <= safe.maxX + 0.75);
    assert.ok(t.y + t.h <= safe.maxY + 0.75);
  }
  assert.equal(layout.camera?.overflow, false);
}

{
  const packed = longSpinner();
  const a = layoutOf(TABLET_FELT, packed);
  const b = layoutOf(TABLET_FELT, packed);
  const played = packed.board.length + packed.north.length + packed.south.length;
  assert.equal(a.tiles.length + a.armTiles.length, played);
  assert.equal(a.scale, b.scale);
  assert.equal(layoutOf({ ...TABLET_FELT, width: 900 }, packed).tiles.length, a.tiles.length);
  assert.equal(a.camera?.overflow, false);
  const play = computePlayBounds(TABLET_FELT, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const t of [...a.tiles, ...a.armTiles]) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
    assert.ok(t.x >= safe.minX - 0.75);
    assert.ok(t.y >= safe.minY - 0.75);
    assert.ok(t.x + t.w <= safe.maxX + 0.75);
    assert.ok(t.y + t.h <= safe.maxY + 0.75);
  }
}

{
  const phone = { width: 760, height: 360 };
  const packed = longSpinner();
  const layout = layoutOf(phone, packed);
  const played = packed.board.length + packed.north.length + packed.south.length;
  assert.equal(layout.tiles.length + layout.armTiles.length, played);
  assert.ok(layout.scale <= 1);
  assert.equal(layout.camera?.overflow, false);
}

console.log("Board playable-size layout tests passed.");
