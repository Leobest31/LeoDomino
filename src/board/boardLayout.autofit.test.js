/**
 * Board layout architecture — logical pack, AABB auto-fit, bbox centering.
 * Strengthens visibility / bounds / collision; does not relax existing suites.
 */
import assert from "node:assert/strict";
import {
  MARGIN,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  layoutBoard,
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  computeFitScale,
} from "./layoutEngine.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tabletLandscape: { width: 1024, height: 600 },
  tabletPortrait: { width: 768, height: 1024 },
  phonePortrait: { width: 390, height: 700 },
};

function tile(id, left = 0, right = 1) {
  return { id, left, right };
}

function dbl(id, pip = 6) {
  return { id, left: pip, right: pip };
}

function mkChain(n, leftCount = 0) {
  const right = n - 1 - leftCount;
  const tiles = [];
  for (let i = leftCount; i >= 1; i -= 1) {
    tiles.push(tile(`L${i}`, i % 7, (i + 1) % 7));
  }
  tiles.push(dbl("c"));
  for (let i = 1; i <= right; i += 1) {
    tiles.push(
      i % 5 === 0
        ? dbl(`R${i}`, i % 7)
        : tile(`R${i}`, (i - 1) % 7, i % 7)
    );
  }
  return { tiles, centerIndex: leftCount };
}

function assertNoOverlap(placements, label) {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const hit =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.ok(!hit, `${label} overlap ${a.id}/${b.id}`);
    }
  }
}

function assertInsideSafe(placements, viewport, label, hudRight = 0) {
  const play = computePlayBounds(viewport, MARGIN, hudRight, 0);
  const safe = computeSafeFeltBounds(play);
  const tol = 0.75;
  for (const p of placements) {
    assert.ok(p.x >= safe.minX - tol, `${label} ${p.id} left ${p.x} < ${safe.minX}`);
    assert.ok(p.y >= safe.minY - tol, `${label} ${p.id} top ${p.y} < ${safe.minY}`);
    assert.ok(
      p.x + p.w <= safe.maxX + tol,
      `${label} ${p.id} right ${p.x + p.w} > ${safe.maxX}`
    );
    assert.ok(
      p.y + p.h <= safe.maxY + tol,
      `${label} ${p.id} bottom ${p.y + p.h} > ${safe.maxY}`
    );
  }
}

function assertBboxCentered(placements, viewport, label, hudRight = 0) {
  const play = computePlayBounds(viewport, MARGIN, hudRight, 0);
  const safe = computeSafeFeltBounds(play);
  const midX = (safe.minX + safe.maxX) / 2;
  const midY = (safe.minY + safe.maxY) / 2;
  const bb = computeChainBounds(placements);
  assert.ok(
    Math.abs(bb.cx - midX) < 1.5,
    `${label} bbox cx ${bb.cx} vs felt ${midX}`
  );
  assert.ok(
    Math.abs(bb.cy - midY) < 1.5,
    `${label} bbox cy ${bb.cy} vs felt ${midY}`
  );
}

{
  const play = { minX: 10, maxX: 210, minY: 20, maxY: 180 };
  const safe = computeSafeFeltBounds(play, 8);
  assert.equal(safe.minX, 18);
  assert.equal(safe.maxX, 202);
  assert.equal(safe.minY, 28);
  assert.equal(safe.maxY, 172);
}

{
  const chain = { minX: 0, maxX: 200, minY: 0, maxY: 50, width: 200, height: 50 };
  const safe = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const s = computeFitScale(chain, safe, 1);
  assert.ok(s <= 100 / 200 + 0.001, `fitScale should use scaleX, got ${s}`);
  assert.ok(s < 1, "must shrink when chain is wider than safe felt");
}

{
  const chain = { minX: 0, maxX: 40, minY: 0, maxY: 76, width: 40, height: 76 };
  const safe = { minX: 0, maxX: 800, minY: 0, maxY: 400 };
  assert.equal(computeFitScale(chain, safe, 1), 1);
}

{
  // Short chain 5–10: preferred scale, centered, no overlap, all visible.
  const vp = VIEWPORTS.desktop;
  for (const n of [5, 8, 10]) {
    const { tiles, centerIndex } = mkChain(n);
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      locked,
      { hudRight: 0, hudLeft: 0 }
    );
    assert.equal(placements.length, n, `short ${n} count`);
    assert.ok(tileScale >= 0.99, `short ${n} should stay preferred scale ${tileScale}`);
    assert.ok(!camera?.overflow, `short ${n} overflow`);
    assertNoOverlap(placements, `short ${n}`);
    assertInsideSafe(placements, vp, `short ${n}`);
    assertBboxCentered(placements, vp, `short ${n}`);
  }
}

{
  // Medium chain 15–25.
  const vp = VIEWPORTS.tabletLandscape;
  for (const n of [15, 20, 25]) {
    const { tiles, centerIndex } = mkChain(n, Math.floor((n - 1) / 2));
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      locked,
      { hudRight: 0, hudLeft: 0 }
    );
    assert.equal(placements.length, n, `medium ${n} count`);
    assert.ok(tileScale > 0.05 && tileScale <= 1, `medium ${n} scale ${tileScale}`);
    assert.ok(!camera?.overflow, `medium ${n} overflow`);
    assertNoOverlap(placements, `medium ${n}`);
    assertInsideSafe(placements, vp, `medium ${n}`);
    assertBboxCentered(placements, vp, `medium ${n}`);
  }
}

{
  // Long chain 28: every tile visible; auto-fit if needed; inside safe felt.
  const { tiles, centerIndex } = mkChain(28, 13);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      locked,
      { hudRight: 0, hudLeft: 0 }
    );
    assert.equal(placements.length, 28, `long28 ${name} count`);
    assert.ok(tileScale > 0.05 && tileScale <= 1, `long28 ${name} scale ${tileScale}`);
    assert.ok(!camera?.overflow, `long28 ${name} overflow`);
    assertNoOverlap(placements, `long28 ${name}`);
    assertInsideSafe(placements, vp, `long28 ${name}`);
    assertBboxCentered(placements, vp, `long28 ${name}`);
    const play = computePlayBounds(vp, MARGIN, 0, 0);
    const safe = computeSafeFeltBounds(play);
    const bb = computeChainBounds(placements);
    assert.ok(bb.width <= safe.maxX - safe.minX + 1.5, `long28 ${name} width`);
    assert.ok(bb.height <= safe.maxY - safe.minY + 1.5, `long28 ${name} height`);
  }
}

{
  // Resize: same chain recomputes; no tiles disappear; stays centered.
  const { tiles, centerIndex } = mkChain(18, 8);
  let prevCount = null;
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const { placements, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      locked,
      { hudRight: 0, hudLeft: 0 }
    );
    assert.equal(placements.length, tiles.length, `resize ${name} count`);
    if (prevCount != null) {
      assert.equal(placements.length, prevCount, `resize ${name} lost tiles`);
    }
    prevCount = placements.length;
    assert.ok(!camera?.overflow, `resize ${name} overflow`);
    assertNoOverlap(placements, `resize ${name}`);
    assertInsideSafe(placements, vp, `resize ${name}`);
    assertBboxCentered(placements, vp, `resize ${name}`);
  }
}

{
  // Regression: rendered count === played state after every move (incl. arms).
  const board = [dbl("6-6")];
  const north = [];
  const south = [];
  const shortFelt = { width: 467, height: 260 };
  let open = 6;
  for (let i = 1; i <= 20; i += 1) {
    const next = (open + 1) % 7;
    board.push(tile(`t${i}`, open, next));
    open = next;
    if (i === 4) north.push(tile("n1", 6, 1));
    if (i === 8) south.push(tile("s1", 6, 4));
    if (i === 12) north.push(tile("n2", 1, 0));
    const layout = calculateBoardLayout(board, shortFelt, {
      centerIndex: 0,
      tileWidth: locked.w,
      tileHeight: locked.h,
      hudRight: 0,
      spinnerId: "6-6",
      spinnerNorth: north,
      spinnerSouth: south,
    });
    const rendered = layout.tiles.length + (layout.armTiles || []).length;
    const stateCount = board.length + north.length + south.length;
    assert.equal(
      rendered,
      stateCount,
      `move ${i}: rendered ${rendered} !== state ${stateCount}`
    );
    assert.equal(layout.tiles.length, board.length, `move ${i} main chain dropped`);
  }
}

{
  // Spinner branches share the global logical system / one auto-fit.
  const west = tile("5-6", 5, 6);
  const spinner = dbl("6-6");
  const east = tile("6-3", 6, 3);
  const north = [tile("n1", 6, 1), tile("n2", 1, 0)];
  const south = [tile("s1", 6, 4)];
  const vp = VIEWPORTS.desktop;
  const layout = calculateBoardLayout([west, spinner, east], vp, {
    centerIndex: 1,
    tileWidth: locked.w,
    tileHeight: locked.h,
    hudRight: 0,
    spinnerId: "6-6",
    spinnerNorth: north,
    spinnerSouth: south,
  });
  assert.equal(layout.tiles.length, 3, "main chain present with spinner arms");
  assert.equal(layout.armTiles.length, 3, "N/S arms laid out in-engine");
  const all = [...layout.tiles, ...layout.armTiles].map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
  }));
  assertNoOverlap(all, "spinner-cross");
  assertInsideSafe(all, vp, "spinner-cross");
  const spin = layout.tiles.find((t) => t.tileId === "6-6");
  const n1 = layout.armTiles.find((t) => t.tileId === "n1");
  const s1 = layout.armTiles.find((t) => t.tileId === "s1");
  assert.ok(spin && n1 && s1, "spinner and first arms");
  assert.ok(n1.y + n1.h <= spin.y + 1, "north arm sits above spinner");
  assert.ok(s1.y >= spin.y + spin.h - 1, "south arm sits below spinner");
  assert.equal(layout.camera?.focusMode, "bbox");
}

{
  // Doubles stay vertical and do not overlap the next bone.
  const tiles = [
    dbl("c"),
    tile("a", 6, 3),
    dbl("d1", 3),
    tile("b", 3, 2),
  ];
  const { placements } = layoutBoard(tiles, 0, VIEWPORTS.desktop, locked, {
    hudRight: 0,
    hudLeft: 0,
  });
  assert.equal(placements.length, 4);
  assertNoOverlap(placements, "doubles");
  for (const p of placements) {
    if (p.double) assert.ok(p.h > p.w, `double ${p.id} must be vertical`);
  }
}

{
  // Same state → same layout (determinism).
  const { tiles, centerIndex } = mkChain(16, 7);
  const a = layoutBoard(tiles, centerIndex, VIEWPORTS.desktop, locked, {
    hudRight: 0,
  });
  const b = layoutBoard(tiles, centerIndex, VIEWPORTS.desktop, locked, {
    hudRight: 0,
  });
  assert.equal(a.placements.length, b.placements.length);
  assert.ok(Math.abs(a.tileScale - b.tileScale) < 1e-9);
  for (let i = 0; i < a.placements.length; i += 1) {
    assert.equal(a.placements[i].id, b.placements[i].id);
    assert.ok(Math.abs(a.placements[i].x - b.placements[i].x) < 1e-6);
    assert.ok(Math.abs(a.placements[i].y - b.placements[i].y) < 1e-6);
  }
}

console.log("Board layout auto-fit / bbox-center tests passed.");
