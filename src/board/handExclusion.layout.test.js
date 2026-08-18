/**
 * Player-hand exclusion zone — south spinner branch must not enter the tray.
 * Run: node src/board/handExclusion.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  FIRST_FOLD_BOTTOM,
  FIRST_FOLD_TOP,
  MARGIN,
} from "./layoutEngine.js";
import {
  HAND_EXCLUSION_GAP_PX,
  measureHandExclusionPx,
} from "./handExclusion.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

/** 1280×800 tablet board-container vs dock, from live device/layout pass. */
const TABLET_STAGE = { top: 143, bottom: 787, height: 644 };
const TABLET_DOCK = { top: 673, bottom: 799 };
const TABLET_FELT = {
  width: 1151,
  height: TABLET_STAGE.height,
};

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function southBranch(count) {
  const board = [
    tile("L2", 4, 5),
    tile("L1", 5, 3),
    dbl("3-3", 3),
    tile("R1", 3, 1),
    tile("R2", 1, 6),
  ];
  const south = [];
  let pip = 3;
  for (let i = 1; i <= count; i += 1) {
    const next = (pip + 2) % 7;
    south.push(tile(`S${i}`, pip, next));
    pip = next;
  }
  return { board, north: [], south };
}

function layoutOf(vp, packed, hudBottom) {
  return calculateBoardLayout(packed.board, vp, {
    centerTileId: "3-3",
    tileWidth: locked.w,
    tileHeight: locked.h,
    hudRight: 0,
    hudLeft: 0,
    hudBottom,
    spinnerId: "3-3",
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

function allBoxes(layout) {
  return [...layout.tiles, ...(layout.armTiles || [])];
}

{
  const px = measureHandExclusionPx(TABLET_STAGE, TABLET_DOCK);
  assert.equal(HAND_EXCLUSION_GAP_PX, 12);
  assert.equal(px, TABLET_STAGE.bottom - TABLET_DOCK.top + HAND_EXCLUSION_GAP_PX);
  assert.equal(px, 126);
  assert.equal(measureHandExclusionPx(TABLET_STAGE, null), 0);
  assert.equal(measureHandExclusionPx(TABLET_STAGE, { top: 900 }), 0);
}

{
  const play = computePlayBounds(TABLET_FELT, MARGIN, 0, 0, 126);
  assert.equal(play.hudBottom, 126);
  assert.ok(play.maxY <= TABLET_FELT.height - MARGIN - 126 + 0.01);
  const full = computePlayBounds(TABLET_FELT, MARGIN, 0, 0, 0);
  assert.ok(play.maxY < full.maxY - 100, "exclusion must raise the bottom bound");
}

function assertInsideExclusion(layout, vp, hudBottom, label) {
  const play = computePlayBounds(vp, MARGIN, 0, 0, hudBottom);
  const safe = computeSafeFeltBounds(play);
  for (const t of allBoxes(layout)) {
    assert.ok(
      t.x >= safe.minX - 0.75 &&
        t.y >= safe.minY - 0.75 &&
        t.x + t.w <= safe.maxX + 0.75 &&
        t.y + t.h <= safe.maxY + 0.75,
      `${label}: ${t.tileId} left usable felt (${t.y + t.h} vs ${safe.maxY})`
    );
    assert.ok(
      t.y + t.h <= play.maxY + 0.75,
      `${label}: ${t.tileId} entered hand exclusion`
    );
  }
  assert.equal(layout.camera?.overflow, false, `${label}: overflow`);
}

{
  const hudBottom = 126;
  const packed = southBranch(1);
  const layout = layoutOf(TABLET_FELT, packed, hudBottom);
  assert.equal(layout.tiles.length, packed.board.length);
  assert.equal(layout.armTiles.length, 1);
  assert.ok(
    layout.scale >= 0.99,
    `1 south tile must keep preferred size, scale=${layout.scale}`
  );
  assertInsideExclusion(layout, TABLET_FELT, hudBottom, "south-1");

  const spin = layout.tiles.find((t) => t.tileId === "3-3");
  const s1 = layout.armTiles.find((t) => t.tileId === "S1");
  assert.ok(spin && s1);
  assert.ok(s1.y >= spin.y + spin.h - 1, "south tile stays below spinner");
  const full = computePlayBounds(TABLET_FELT, MARGIN, 0, 0, 0);
  const fullMidY = (full.minY + full.maxY) / 2;
  const spinCy = spin.y + spin.h / 2;
  assert.ok(
    spinCy < fullMidY - 8,
    `spinner must shift up into unused felt, cy=${spinCy} fullMid=${fullMidY}`
  );
}

{
  const hudBottom = 126;
  const packed = southBranch(2);
  const layout = layoutOf(TABLET_FELT, packed, hudBottom);
  assert.equal(layout.armTiles.length, 2);
  const s1 = layout.armTiles.find((t) => t.tileId === "S1");
  const s2 = layout.armTiles.find((t) => t.tileId === "S2");
  assert.ok(s1 && s2);
  assert.ok(
    s1.travelDir === "S" || s1.orientation === "vertical",
    `S1 must stay south, dir=${s1.travelDir}`
  );
  assert.ok(
    s2.travelDir === "S" || s2.orientation === "vertical",
    `S2 must stay south (2-straight lock), dir=${s2.travelDir}`
  );
  assertInsideExclusion(layout, TABLET_FELT, hudBottom, "south-2");
}

{
  const hudBottom = 126;
  const packed = southBranch(3);
  const layout = layoutOf(TABLET_FELT, packed, hudBottom);
  assert.equal(layout.armTiles.length, 3);
  const s3 = layout.armTiles.find((t) => t.tileId === "S3");
  assert.ok(s3);
  assert.equal(
    s3.travelDir,
    FIRST_FOLD_BOTTOM,
    `tile 3 must turn LEFT, got ${s3.travelDir}`
  );
  assertInsideExclusion(layout, TABLET_FELT, hudBottom, "south-3-left");
}

{
  const hudBottom = 126;
  const packed = southBranch(2);
  packed.north = [tile("N1", 3, 6), tile("N2", 6, 0), tile("N3", 0, 4)];
  packed.board.unshift(tile("L3", 2, packed.board[0].left));
  packed.board.push(tile("R3", packed.board[packed.board.length - 1].right, 4));
  const layout = layoutOf(TABLET_FELT, packed, hudBottom);
  const played = packed.board.length + packed.north.length + packed.south.length;
  assert.equal(layout.tiles.length + layout.armTiles.length, played);
  const n3 = layout.armTiles.find((t) => t.tileId === "N3");
  assert.ok(n3);
  assert.equal(n3.travelDir, FIRST_FOLD_TOP, `north tile 3 RIGHT, got ${n3.travelDir}`);
  assertInsideExclusion(layout, TABLET_FELT, hudBottom, "cross");
  const bb = computeChainBounds(
    allBoxes(layout).map((t) => ({ id: t.tileId, x: t.x, y: t.y, w: t.w, h: t.h }))
  );
  const play = computePlayBounds(TABLET_FELT, MARGIN, 0, 0, hudBottom);
  const safe = computeSafeFeltBounds(play);
  assert.ok(
    Math.abs(bb.cx - (safe.minX + safe.maxX) / 2) < 2,
    `cross bbox cx ${bb.cx}`
  );
  assert.ok(
    Math.abs(bb.cy - (safe.minY + safe.maxY) / 2) < 2,
    `cross bbox cy ${bb.cy}`
  );
}

console.log("Hand-exclusion layout tests passed.");
