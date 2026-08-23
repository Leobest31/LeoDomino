/**
 * All Fives spinner / four-way cross layout containment + routing.
 * Run: node src/board/allFivesSpinner.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  computeSafeFeltBounds,
  computePlayBounds,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  SPINNER_MAIN_STRAIGHT,
  SPINNER_ARM_STRAIGHT,
  TURN_EVERY,
  FIRST_FOLD_LEFT,
  FIRST_FOLD_RIGHT,
} from "./layoutEngine.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 1024, height: 600 },
  phone: { width: 390, height: 700 },
};

assert.equal(TURN_EVERY, 5, "LeoDomino main-chain lock is 5");
assert.equal(SPINNER_MAIN_STRAIGHT, 5);
assert.equal(SPINNER_ARM_STRAIGHT, 2);

function tile(id, left, right) {
  return { id, left, right };
}

function dbl(id, pip = 3) {
  return { id, left: pip, right: pip };
}

function allBoxes(layout) {
  return [...layout.tiles, ...(layout.armTiles || [])].map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
  }));
}

function centerOf(t) {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

function span(values) {
  return Math.max(...values) - Math.min(...values);
}

function assertNoOverlap(boxes, label) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const hit =
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(hit, false, `${label}: ${a.id} overlaps ${b.id}`);
    }
  }
}

function assertInsideSafe(boxes, viewport, label) {
  const play = computePlayBounds(viewport, 12, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const box of boxes) {
    assert.ok(
      box.x >= safe.minX - 0.75 &&
        box.y >= safe.minY - 0.75 &&
        box.x + box.w <= safe.maxX + 0.75 &&
        box.y + box.h <= safe.maxY + 0.75,
      `${label}: ${box.id} clipped outside felt`
    );
  }
}

function assertHorizontalRun(tiles, label) {
  assert.ok(tiles.length >= 1 && tiles.every(Boolean), `${label}: missing tiles`);
  if (tiles.length < 2) return;
  const ys = tiles.map((t) => centerOf(t).y);
  const xs = tiles.map((t) => centerOf(t).x);
  const ySpan = span(ys);
  const xSpan = span(xs);
  assert.ok(
    ySpan <= 6,
    `${label}: first ${tiles.length} tiles must stay on one horizontal line (y-span ${ySpan.toFixed(2)})`
  );
  assert.ok(
    xSpan > ySpan,
    `${label}: run must be horizontal (x-span ${xSpan.toFixed(2)} vs y-span ${ySpan.toFixed(2)})`
  );
}

function assertVerticalRun(tiles, label) {
  assert.ok(tiles.length >= 1 && tiles.every(Boolean), `${label}: missing tiles`);
  if (tiles.length < 2) return;
  const ys = tiles.map((t) => centerOf(t).y);
  const xs = tiles.map((t) => centerOf(t).x);
  const ySpan = span(ys);
  const xSpan = span(xs);
  assert.ok(
    xSpan <= 6,
    `${label}: first ${tiles.length} tiles must stay on one vertical line (x-span ${xSpan.toFixed(2)})`
  );
  assert.ok(
    ySpan > xSpan,
    `${label}: run must be vertical (y-span ${ySpan.toFixed(2)} vs x-span ${xSpan.toFixed(2)})`
  );
}

function fourWay(leftCount, rightCount, northCount, southCount) {
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

function layoutCross(vp, board, north, south, tile = locked) {
  return calculateBoardLayout(board, vp, {
    centerTileId: "3-3",
    tileWidth: tile.w,
    tileHeight: tile.h,
    hudRight: 0,
    spinnerId: "3-3",
    spinnerNorth: north,
    spinnerSouth: south,
    rulesetId: "american",
  });
}

function firstTurnIndex(tiles, startDir) {
  return tiles.findIndex((t) => t && t.travelDir !== startDir);
}

function assertMainFirstFold(arm, startDir, foldDir, label) {
  const idx = firstTurnIndex(arm, startDir);
  if (idx < 0) {
    for (const t of arm) {
      assert.equal(t.travelDir, startDir, `${label}: expected ${startDir}`);
    }
    return;
  }
  assert.ok(idx >= 1 && idx <= 5, `${label}: first fold at ${idx}`);
  for (let i = 0; i < idx; i += 1) {
    assert.equal(arm[i].travelDir, startDir, `${label} [${i}] ${startDir}`);
  }
  assert.equal(arm[idx].travelDir, foldDir, `${label}: fold ${foldDir}`);
}

function branchFromSpinner(layout, board) {
  const spinIdx = board.findIndex((t) => t.id === "3-3");
  const byId = Object.fromEntries(layout.tiles.map((t) => [t.tileId, t]));
  const left = [];
  for (let i = spinIdx - 1; i >= 0; i -= 1) left.push(byId[board[i].id]);
  const right = [];
  for (let i = spinIdx + 1; i < board.length; i += 1) right.push(byId[board[i].id]);
  const arms = layout.armTiles || [];
  const north = arms.filter((t) => t.branch === "SPINNER_TOP" || t.branch === "north");
  const south = arms.filter((t) => t.branch === "SPINNER_BOTTOM" || t.branch === "south");
  return { spinner: byId["3-3"], left, right, north, south };
}

{
  const { board, north, south } = fourWay(1, 1, 1, 1);
  const layout = layoutCross(VIEWPORTS.desktop, board, north, south);
  const boxes = allBoxes(layout);
  assert.equal(boxes.length, 5, "four-way cross keeps spinner + 4 arms");
  assertNoOverlap(boxes, "four-way");
  assertInsideSafe(boxes, VIEWPORTS.desktop, "four-way");
  const scales = new Set(
    [...layout.tiles, ...(layout.armTiles || [])].map(() => layout.scale)
  );
  assert.equal(scales.size, 1, "uniform scale for the whole spinner layout");
  console.log("✓ four-way spinner cross stays inside felt");
}

{
  const compact = { w: 40, h: 76 };
  const packed = fourWay(5, 5, 2, 2);
  const layout = layoutCross(VIEWPORTS.desktop, packed.board, packed.north, packed.south, compact);
  const { left, right, north, south } = branchFromSpinner(layout, packed.board);
  assertHorizontalRun([layout.tiles.find((t) => t.tileId === "3-3"), ...left.slice(0, 5)], "compact left 1–5");
  assertHorizontalRun([layout.tiles.find((t) => t.tileId === "3-3"), ...right.slice(0, 5)], "compact right 1–5");
  assertVerticalRun(north.slice(0, 2), "compact top 1–2");
  assertVerticalRun(south.slice(0, 2), "compact bottom 1–2");
  console.log("✓ 5-straight LEFT/RIGHT still holds when that rail fits at preferred size");
}

{
  const packed = fourWay(5, 5, 2, 2);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed.board, packed.north, packed.south);
    const boxes = allBoxes(layout);
    const expected =
      packed.board.length + packed.north.length + packed.south.length;
    assert.equal(boxes.length, expected, `${name} 5/5/2/2: all tiles visible`);
    assertNoOverlap(boxes, `${name}-5-5-2-2`);
    assertInsideSafe(boxes, vp, `${name}-5-5-2-2`);
    const { left, right, north, south } = branchFromSpinner(layout, packed.board);
    assert.equal(left.length, 5, `${name} left count`);
    assert.equal(right.length, 5, `${name} right count`);
    assert.equal(north.length, 2, `${name} north count`);
    assert.equal(south.length, 2, `${name} south count`);
    assertMainFirstFold(left, "W", FIRST_FOLD_LEFT, `${name} left`);
    assertMainFirstFold(right, "E", FIRST_FOLD_RIGHT, `${name} right`);
    assertVerticalRun([layout.tiles.find((t) => t.tileId === "3-3"), ...north.slice(0, 2)], `${name} top 1–2`);
    assertVerticalRun([layout.tiles.find((t) => t.tileId === "3-3"), ...south.slice(0, 2)], `${name} bottom 1–2`);
  }
  console.log("✓ left/right keep locked fold direction; top/bottom 1–2 stay vertical");
}

{
  const packed = fourWay(6, 6, 4, 4);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed.board, packed.north, packed.south);
    const boxes = allBoxes(layout);
    const expected =
      packed.board.length + packed.north.length + packed.south.length;
    assert.equal(boxes.length, expected, `${name} 6/6/4/4: no disappearing tiles`);
    assertNoOverlap(boxes, `${name}-6-6-4-4`);
    assertInsideSafe(boxes, vp, `${name}-6-6-4-4`);
    const { left, right, north, south } = branchFromSpinner(layout, packed.board);
    assertMainFirstFold(left, "W", FIRST_FOLD_LEFT, `${name} left`);
    assertMainFirstFold(right, "E", FIRST_FOLD_RIGHT, `${name} right`);
    assertVerticalRun(north.slice(0, 2), `${name} top does not turn before tile 3`);
    assertVerticalRun(south.slice(0, 2), `${name} bottom does not turn before tile 3`);
    const leftFold = firstTurnIndex(left, "W");
    const rightFold = firstTurnIndex(right, "E");
    if (leftFold >= 1) {
      const prev = left[leftFold - 1];
      const fold = left[leftFold];
      assert.ok(fold.y + fold.h / 2 < prev.y + prev.h / 2 - 2, `${name} left fold goes UP`);
    }
    if (rightFold >= 1) {
      const prev = right[rightFold - 1];
      const fold = right[rightFold];
      assert.ok(fold.y + fold.h / 2 > prev.y + prev.h / 2 + 2, `${name} right fold goes DOWN`);
    }
    assert.ok(north[2].x + north[2].w / 2 > north[1].x + north[1].w / 2 + 2, `${name} top tile 3 goes RIGHT`);
    assert.ok(south[2].x + south[2].w / 2 < south[1].x + south[1].w / 2 - 2, `${name} bottom tile 3 goes LEFT`);
    const tileScales = new Set(
      [...layout.tiles, ...(layout.armTiles || [])].map(() => layout.scale)
    );
    assert.equal(tileScales.size, 1, `${name} uniform scale after 6/6/4/4`);
  }
  console.log("✓ first fold stays LEFT→UP / RIGHT→DOWN; N/S may turn only after tile 2");
}

{
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    let left = 0;
    let right = 0;
    let north = 0;
    let south = 0;
    let prevScale = 1;
    for (let step = 1; step <= 12; step += 1) {
      if (step % 4 === 1) left += 1;
      else if (step % 4 === 2) right += 1;
      else if (step % 4 === 3) north += 1;
      else south += 1;
      const packed = fourWay(left, right, north, south);
      const layout = layoutCross(vp, packed.board, packed.north, packed.south);
      const boxes = allBoxes(layout);
      const expected =
        packed.board.length + packed.north.length + packed.south.length;
      assert.equal(
        boxes.length,
        expected,
        `${name} step ${step}: existing tiles remain visible`
      );
      assertNoOverlap(boxes, `${name}-${step}`);
      assertInsideSafe(boxes, vp, `${name}-${step}`);
      assert.ok(
        layout.scale <= prevScale + 0.001 || step === 1,
        `${name} step ${step}: scale must not jump up while the chain grows on a fixed felt`
      );
      prevScale = Math.min(prevScale, layout.scale);
      const tileScales = new Set(
        [...layout.tiles, ...(layout.armTiles || [])].map(() => layout.scale)
      );
      assert.equal(tileScales.size, 1, `${name} step ${step}: uniform scale`);
      const branches = branchFromSpinner(layout, packed.board);
      assertMainFirstFold(branches.left, "W", FIRST_FOLD_LEFT, `${name} step ${step} left`);
      assertMainFirstFold(branches.right, "E", FIRST_FOLD_RIGHT, `${name} step ${step} right`);
      if (branches.north.length >= 2) {
        assertVerticalRun(branches.north.slice(0, 2), `${name} step ${step} top 1–2`);
      } else if (branches.north.length) {
        assertVerticalRun(branches.north, `${name} step ${step} top`);
      }
      if (branches.south.length >= 2) {
        assertVerticalRun(branches.south.slice(0, 2), `${name} step ${step} bottom 1–2`);
      } else if (branches.south.length) {
        assertVerticalRun(branches.south, `${name} step ${step} bottom`);
      }
    }
  }
  console.log("✓ growing L/R/N/S branches stay on felt; next move auto-fits first");
}

{
  const packed = fourWay(4, 4, 3, 3);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed.board, packed.north, packed.south);
    const boxes = allBoxes(layout);
    assert.equal(
      boxes.length,
      packed.board.length + packed.north.length + packed.south.length,
      `${name} stress: all tiles visible`
    );
    assertNoOverlap(boxes, `${name}-stress`);
    assertInsideSafe(boxes, vp, `${name}-stress`);
    assert.ok(layout.scale > 0 && layout.scale <= 1, `${name} stress scale`);
    const { left, right, north, south } = branchFromSpinner(layout, packed.board);
    assertMainFirstFold(left, "W", FIRST_FOLD_LEFT, `${name} stress left`);
    assertMainFirstFold(right, "E", FIRST_FOLD_RIGHT, `${name} stress right`);
    assertVerticalRun(north.slice(0, 2), `${name} stress top 1–2`);
    assertVerticalRun(south.slice(0, 2), `${name} stress bottom 1–2`);
  }
  console.log("✓ desktop/tablet/phone spinner stress layouts remain contained");
}

{
  const packed = fourWay(6, 6, 4, 4);
  const desktop = layoutCross(VIEWPORTS.desktop, packed.board, packed.north, packed.south);
  const tablet = layoutCross(VIEWPORTS.tablet, packed.board, packed.north, packed.south);
  const phone = layoutCross(VIEWPORTS.phone, packed.board, packed.north, packed.south);
  for (const [name, layout] of [
    ["desktop", desktop],
    ["tablet", tablet],
    ["phone", phone],
  ]) {
    const { left, right, north, south } = branchFromSpinner(layout, packed.board);
    assertMainFirstFold(left, "W", FIRST_FOLD_LEFT, `resize ${name} left`);
    assertMainFirstFold(right, "E", FIRST_FOLD_RIGHT, `resize ${name} right`);
    assertVerticalRun(north.slice(0, 2), `resize ${name} top`);
    assertVerticalRun(south.slice(0, 2), `resize ${name} bottom`);
    assert.equal(
      layout.tiles.length + layout.armTiles.length,
      packed.board.length + packed.north.length + packed.south.length,
      `resize ${name}: no tiles lost`
    );
  }
  console.log("✓ resizing still preserves LEFT→UP / RIGHT→DOWN and 2-tile N/S locks");
}

console.log("\nAll Fives spinner layout tests passed.");
