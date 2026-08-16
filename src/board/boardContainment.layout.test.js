/**
 * Felt containment: every played tile has one layout entry inside safe felt.
 * Run: node src/board/boardContainment.layout.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  FIRST_FOLD_LEFT,
  FIRST_FOLD_RIGHT,
  FIRST_FOLD_TOP,
  FIRST_FOLD_BOTTOM,
  LEO_MAIN_STRAIGHT,
  LEO_ARM_STRAIGHT,
} from "./layoutEngine.js";
import { buildSpinnerArmDisplays } from "./connectionDisplay.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tabletLandscape: { width: 1024, height: 600 },
  tabletPortrait: { width: 768, height: 1024 },
  smallPhone: { width: 360, height: 640 },
  largePhone: { width: 430, height: 800 },
};

function section(title) {
  console.log(`✓ ${title}`);
}

function tile(id, left, right) {
  return { id, left, right };
}

function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function fourWay(leftCount, rightCount, northCount, southCount, extras = {}) {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= leftCount; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= rightCount; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  const north = [];
  let nPip = 3;
  for (let i = 1; i <= northCount; i += 1) {
    if (extras.northDoubleAt === i) {
      north.push(dbl(`N${i}`, nPip));
      continue;
    }
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
  return { board, north, south };
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

function allBoxes(layout) {
  return [...layout.tiles, ...(layout.armTiles || [])];
}

function assertComplete(layout, packed, label) {
  const played = packed.board.length + packed.north.length + packed.south.length;
  const boxes = allBoxes(layout);
  assert.equal(layout.tiles.length, packed.board.length, `${label} main count`);
  assert.equal(
    (layout.armTiles || []).length,
    packed.north.length + packed.south.length,
    `${label} arm count`
  );
  assert.equal(boxes.length, played, `${label} played ${played} !== layout ${boxes.length}`);
  const ids = new Set(boxes.map((t) => t.tileId));
  for (const t of [...packed.board, ...packed.north, ...packed.south]) {
    assert.ok(ids.has(t.id), `${label} missing ${t.id}`);
  }
  for (const t of boxes) {
    assert.ok(
      Number.isFinite(t.x) &&
        Number.isFinite(t.y) &&
        Number.isFinite(t.w) &&
        Number.isFinite(t.h) &&
        t.w > 0 &&
        t.h > 0,
      `${label} ${t.tileId} invalid box`
    );
    assert.ok(t.branch, `${label} ${t.tileId} missing branch`);
  }
}

function assertInsideSafe(layout, vp, label) {
  const play = computePlayBounds(vp, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const t of allBoxes(layout)) {
    assert.ok(
      t.x >= safe.minX - 0.75 &&
        t.y >= safe.minY - 0.75 &&
        t.x + t.w <= safe.maxX + 0.75 &&
        t.y + t.h <= safe.maxY + 0.75,
      `${label} ${t.tileId} outside safe felt (${t.x},${t.y},${t.w}x${t.h}) vs ${JSON.stringify(safe)}`
    );
  }
  assert.equal(layout.camera?.overflow, false, `${label} camera overflow`);
}

function assertNoOverlap(layout, label) {
  const boxes = allBoxes(layout);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const hit =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.equal(hit, false, `${label} overlap ${a.tileId}/${b.tileId}`);
    }
  }
}

function assertUniformScale(layout, label) {
  assert.ok(layout.scale > 0 && layout.scale <= 1, `${label} scale ${layout.scale}`);
}

assert.equal(LEO_MAIN_STRAIGHT, 5);
assert.equal(LEO_ARM_STRAIGHT, 2);
assert.equal(FIRST_FOLD_LEFT, "N");
assert.equal(FIRST_FOLD_RIGHT, "S");
assert.equal(FIRST_FOLD_TOP, "E");
assert.equal(FIRST_FOLD_BOTTOM, "W");
section("fixed LeoDomino routing constants");

{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "DominoLayoutEngine.js"), "utf8");
  assert.match(src, /completeMissingSpinnerArms/);
  assert.match(src, /scale \* 0\.96/);
  section("engine no longer fail-closes spinner arms; scale loops until contained");
}

{
  const cases = [
    [0, 0, 1, 0, "TOP 1"],
    [0, 0, 2, 0, "TOP 2"],
    [1, 1, 3, 0, "TOP 3+"],
    [0, 0, 0, 1, "BOTTOM 1"],
    [0, 0, 0, 2, "BOTTOM 2"],
    [1, 1, 0, 3, "BOTTOM 3+"],
    [6, 0, 0, 0, "LEFT 5+"],
    [0, 6, 0, 0, "RIGHT 5+"],
    [2, 2, 2, 2, "all four branches"],
    [6, 6, 4, 4, "four-way after folds"],
  ];
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    for (const [l, r, n, s, label] of cases) {
      const packed = fourWay(l, r, n, s);
      const layout = layoutOf(vp, packed);
      const tag = `${name} ${label}`;
      assertComplete(layout, packed, tag);
      assertInsideSafe(layout, vp, tag);
      assertNoOverlap(layout, tag);
      assertUniformScale(layout, tag);
    }
  }
  section("TOP/BOTTOM 1/2/3+ , LEFT/RIGHT 5+, four-way: complete and inside felt");
}

{
  const packed = fourWay(0, 0, 3, 0, { northDoubleAt: 3 });
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutOf(vp, packed);
    assertComplete(layout, packed, `${name} TOP double-on-fold`);
    assertInsideSafe(layout, vp, `${name} TOP double-on-fold`);
    const n3 = layout.armTiles.find((t) => t.tileId === "N3");
    assert.ok(n3, `${name} N3 (double on first TOP fold) must exist`);
    const n2 = layout.armTiles.find((t) => t.tileId === "N2");
    assert.ok(n3.x + n3.w / 2 > n2.x + n2.w / 2 + 2, `${name} N3 turns RIGHT`);
  }
  section("double on SPINNER_TOP fold is laid out, not dropped");
}

{
  const packed = fourWay(8, 8, 4, 4);
  const played = packed.board.length + packed.north.length + packed.south.length;
  assert.ok(played >= 20);
  for (const n of [20, 24, 28]) {
    const left = Math.min(10, Math.ceil((n - 1) / 3));
    const right = Math.min(10, Math.ceil((n - 1 - left) / 2));
    const north = Math.min(6, n - 1 - left - right);
    const south = n - 1 - left - right - north;
    const p = fourWay(left, right, north, south);
    const total = p.board.length + p.north.length + p.south.length;
    assert.equal(total, n, `constructed ${n}`);
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const a = layoutOf(vp, p);
      const b = layoutOf(vp, p);
      assertComplete(a, p, `${name} n=${n}`);
      assertInsideSafe(a, vp, `${name} n=${n}`);
      assertNoOverlap(a, `${name} n=${n}`);
      assert.equal(a.scale, b.scale, `${name} n=${n} scale deterministic`);
      for (let i = 0; i < a.tiles.length; i += 1) {
        assert.equal(a.tiles[i].tileId, b.tiles[i].tileId);
        assert.ok(Math.abs(a.tiles[i].x - b.tiles[i].x) < 1e-6);
        assert.ok(Math.abs(a.tiles[i].y - b.tiles[i].y) < 1e-6);
      }
    }
  }
  section("20 / 24 / 28 played tiles stay complete, contained, deterministic");
}

{
  const packed = fourWay(4, 4, 3, 3);
  const phone = layoutOf(VIEWPORTS.smallPhone, packed);
  const desktop = layoutOf(VIEWPORTS.desktop, packed);
  assertComplete(phone, packed, "phone");
  assertComplete(desktop, packed, "desktop");
  assert.ok(
    desktop.scale + 0.001 >= phone.scale,
    `larger viewport restores scale phone=${phone.scale} desktop=${desktop.scale}`
  );
  assert.ok(desktop.scale <= 1);
  const short = layoutOf(VIEWPORTS.desktop, fourWay(1, 1, 0, 0));
  assert.ok(short.scale >= 0.99, `short chain preferred scale ${short.scale}`);
  section("preferred size when it fits; uniform shrink only when needed; restore on larger felt");
}

{
  const packed = fourWay(1, 1, 3, 2);
  const layout = layoutOf(VIEWPORTS.desktop, packed);
  const spin = layout.tiles.find((t) => t.tileId === "3-3");
  const displays = buildSpinnerArmDisplays(
    spin,
    packed.north,
    packed.south,
    layout.gap,
    layout.armTiles.map((t) => ({
      id: t.tileId,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      orientation: t.orientation,
      travelDir: t.travelDir,
      branch: t.branch,
    }))
  );
  assert.equal(displays.length, packed.north.length + packed.south.length);
  const partial = buildSpinnerArmDisplays(
    spin,
    packed.north,
    packed.south,
    layout.gap,
    layout.armTiles.slice(0, 1).map((t) => ({
      id: t.tileId,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
    }))
  );
  assert.equal(
    partial.length,
    packed.north.length + packed.south.length,
    "renderer fallback must still show every spinner-arm tile"
  );
  section("renderer keeps every TOP/BOTTOM tile even if an engine entry is missing");
}

{
  const destSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../game/destinationTarget.js"),
    "utf8"
  );
  const boardJsx = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "BoardContainer.jsx"), "utf8");
  assert.match(destSrc, /north\[north\.length - 1\]\.id/);
  assert.match(boardJsx, /boardTileId=\{tile\.id\}/);
  section("drop targets still resolve to rendered board tile ids");
}

console.log("\nBoard containment layout tests passed.");
