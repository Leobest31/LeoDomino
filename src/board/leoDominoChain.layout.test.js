/**
 * Universal LeoDomino chain layout — first-double anchor, felt-aware first
 * run (5-straight ceiling), preferred size until overflow, uniform auto-fit,
 * ruleset smoke.
 *
 * Run: node src/board/leoDominoChain.layout.test.js
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  LEO_MAIN_STRAIGHT,
  LEO_ARM_STRAIGHT,
  FIRST_FOLD_LEFT,
  FIRST_FOLD_RIGHT,
  FIRST_FOLD_TOP,
  FIRST_FOLD_BOTTOM,
  TURN_EVERY,
  packFirstRunLimit,
} from "./layoutEngine.js";
import {
  applyPlace,
  createMatch,
  END,
  startMatch,
  getAvailableActions,
  playTile,
  listRulesetIds,
  resolveRuleset,
} from "../game/index.js";

const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  phone: { width: 390, height: 700 },
};

assert.equal(TURN_EVERY, 5);
assert.equal(LEO_MAIN_STRAIGHT, 5);
assert.equal(LEO_ARM_STRAIGHT, 2);
assert.equal(FIRST_FOLD_LEFT, "N");
assert.equal(FIRST_FOLD_RIGHT, "S");
assert.equal(FIRST_FOLD_TOP, "E");
assert.equal(FIRST_FOLD_BOTTOM, "W");

function tile(id, left, right) {
  return { id, left, right };
}

function dbl(id, pip = 3) {
  return { id, left: pip, right: pip };
}

function centerOf(t) {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 };
}

function layoutBoardChain(board, vp, extra = {}) {
  return calculateBoardLayout(board, vp, {
    tileWidth: locked.w,
    tileHeight: locked.h,
    hudRight: 0,
    hudLeft: 0,
    ...extra,
  });
}

function byTileId(layout) {
  return Object.fromEntries(
    [...layout.tiles, ...(layout.armTiles || [])].map((t) => [t.tileId, t])
  );
}

function branches(layout, board, centerId) {
  const idx = board.findIndex((t) => t.id === centerId);
  const map = byTileId(layout);
  const left = [];
  for (let i = idx - 1; i >= 0; i -= 1) left.push(map[board[i].id]);
  const right = [];
  for (let i = idx + 1; i < board.length; i += 1) right.push(map[board[i].id]);
  const arms = layout.armTiles || [];
  return {
    center: map[centerId],
    left,
    right,
    north: arms.filter((t) => t.branch === "SPINNER_TOP" || t.branch === "north"),
    south: arms.filter((t) => t.branch === "SPINNER_BOTTOM" || t.branch === "south"),
  };
}

function assertConnected(a, b, label) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  assert.ok(xOv || yOv, `${label}: ${a.tileId || a.id} disconnected from ${b.tileId || b.id}`);
  assert.ok(!(xOv && yOv), `${label}: overlap ${a.tileId || a.id}/${b.tileId || b.id}`);
}

function assertNoOverlap(layout, label) {
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const hit =
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(hit, false, `${label}: ${a.tileId} overlaps ${b.tileId}`);
    }
  }
}

function assertInsideSafe(layout, vp, label) {
  const play = computePlayBounds(vp, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const box of [...layout.tiles, ...(layout.armTiles || [])]) {
    assert.ok(
      box.x >= safe.minX - 0.75 &&
        box.y >= safe.minY - 0.75 &&
        box.x + box.w <= safe.maxX + 0.75 &&
        box.y + box.h <= safe.maxY + 0.75,
      `${label}: ${box.tileId} left the safe felt`
    );
  }
}

function assertChainBboxCentered(layout, vp, label) {
  const play = computePlayBounds(vp, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const midX = (safe.minX + safe.maxX) / 2;
  const midY = (safe.minY + safe.maxY) / 2;
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  const minX = Math.min(...boxes.map((t) => t.x));
  const maxX = Math.max(...boxes.map((t) => t.x + t.w));
  const minY = Math.min(...boxes.map((t) => t.y));
  const maxY = Math.max(...boxes.map((t) => t.y + t.h));
  assert.ok(
    Math.abs((minX + maxX) / 2 - midX) < 1.5,
    `${label}: chain cx ${(minX + maxX) / 2} vs ${midX}`
  );
  assert.ok(
    Math.abs((minY + maxY) / 2 - midY) < 1.5,
    `${label}: chain cy ${(minY + maxY) / 2} vs ${midY}`
  );
}

function assertHorizontalMainLine(layout, board, vp, label) {
  assert.equal(layout.armTiles.length, 0, `${label}: invented spinner arms`);
  const map = byTileId(layout);
  for (const t of board) {
    const p = map[t.id];
    assert.ok(p, `${label}: missing ${t.id}`);
    if (Number(t.left) === Number(t.right)) continue;
    assert.equal(p.orientation, "horizontal", `${label}: ${t.id} must be horizontal`);
    assert.ok(p.w > p.h + 0.5, `${label}: ${t.id} wide footprint, got ${p.w}x${p.h}`);
    assert.ok(
      p.rotation === 0 || p.rotation === 180,
      `${label}: ${t.id} rotation ${p.rotation}`
    );
  }
  for (let i = 0; i < board.length - 1; i += 1) {
    const a = map[board[i].id];
    const b = map[board[i + 1].id];
    assertConnected(a, b, label);
    assert.ok(
      Math.abs(centerOf(a).y - centerOf(b).y) < 2,
      `${label}: ${board[i].id}/${board[i + 1].id} not on one horizontal rail`
    );
    assert.ok(
      centerOf(b).x > centerOf(a).x,
      `${label}: visual order must follow board left→right`
    );
  }
  assertNoOverlap(layout, label);
  assertInsideSafe(layout, vp, label);
  assertChainBboxCentered(layout, vp, label);
  if (board.length <= 3) {
    assert.ok(layout.scale >= 0.99, `${label}: preferred size, scale=${layout.scale}`);
  }
}

function assertAnchorPinned(layout, centerId, vp, label) {
  const c = layout.tiles.find((t) => t.tileId === centerId);
  assert.ok(c, `${label}: missing center ${centerId}`);
  assertInsideSafe(layout, vp, label);
  assertChainBboxCentered(layout, vp, `${label}-bbox`);
}

function mkCross(leftCount, rightCount, northCount = 0, southCount = 0) {
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

function layoutCross(vp, packed) {
  return layoutBoardChain(packed.board, vp, {
    centerTileId: "3-3",
    spinnerId: "3-3",
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

function toSvg(layout, vp, title) {
  const play = computePlayBounds(vp, 14, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  const rects = boxes
    .map((t) => {
      const fill = t.double ? "#f4d35e" : "#f7f3e8";
      const stroke = t.tileId === layout.tiles.find((x) => x.double)?.tileId ? "#c0392b" : "#2c3e50";
      return `<rect x="${t.x.toFixed(1)}" y="${t.y.toFixed(1)}" width="${t.w.toFixed(1)}" height="${t.h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" rx="4"/>
      <text x="${(t.x + t.w / 2).toFixed(1)}" y="${(t.y + t.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-family="sans-serif">${t.tileId}</text>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vp.width}" height="${vp.height}" viewBox="0 0 ${vp.width} ${vp.height}">
  <rect width="100%" height="100%" fill="#1b4332"/>
  <rect x="${play.minX}" y="${play.minY}" width="${play.maxX - play.minX}" height="${play.maxY - play.minY}" fill="#2d6a4f" stroke="#d4af37" stroke-width="4"/>
  <rect x="${safe.minX}" y="${safe.minY}" width="${safe.maxX - safe.minX}" height="${safe.maxY - safe.minY}" fill="none" stroke="#95d5b2" stroke-dasharray="6 4"/>
  <text x="16" y="22" fill="#fff" font-size="14" font-family="sans-serif">${title} scale=${layout.scale.toFixed(3)}</text>
  ${rects}
</svg>`;
}

{
  // Case A — one non-double opener: horizontal, felt-centered, preferred size.
  const board = [tile("5-6", 5, 6)];
  const layout = layoutBoardChain(board, VIEWPORTS.desktop, {
    centerTileId: "5-6",
    spinnerId: null,
  });
  assert.equal(layout.tiles.length, 1);
  assertHorizontalMainLine(layout, board, VIEWPORTS.desktop, "A");
  console.log("✓ Case A: one non-double opener is horizontal and centered");
}

{
  // Case B — two non-doubles before any double: one horizontal line, not a stack.
  const board = [tile("2-5", 2, 5), tile("5-6", 5, 6)];
  const layout = layoutBoardChain(board, VIEWPORTS.desktop, {
    centerTileId: "2-5",
    spinnerId: null,
  });
  assert.equal(layout.tiles.length, 2);
  assertHorizontalMainLine(layout, board, VIEWPORTS.desktop, "B");
  const map = byTileId(layout);
  assert.ok(
    Math.abs(centerOf(map["2-5"]).x - centerOf(map["5-6"]).x) > 8,
    "B must not stack two non-doubles on the same x"
  );
  console.log("✓ Case B: two non-doubles stay on one horizontal line");
}

{
  // Case C — several non-doubles before first double.
  const board = [
    tile("6-3", 6, 3),
    tile("3-1", 3, 1),
    tile("1-4", 1, 4),
  ];
  const layout = layoutBoardChain(board, VIEWPORTS.desktop, {
    centerIndex: 0,
    spinnerId: null,
  });
  assert.equal(layout.tiles.length, 3);
  assertHorizontalMainLine(layout, board, VIEWPORTS.desktop, "C");
  console.log("✓ Case C: several non-doubles remain one horizontal chain");
}

{
  // Case D — first double appears later: re-anchor, keep connections, routing on.
  const before = [
    tile("6-3", 6, 3),
    tile("3-1", 3, 1),
    tile("1-4", 1, 4),
  ];
  const after = [...before, dbl("4-4", 4)];
  const pre = layoutBoardChain(before, VIEWPORTS.desktop, { centerIndex: 0 });
  const post = layoutBoardChain(after, VIEWPORTS.desktop, {
    spinnerId: "4-4",
    centerTileId: "4-4",
  });
  assertHorizontalMainLine(pre, before, VIEWPORTS.desktop, "D-pre");
  assert.equal(post.tiles.length, 4, "D all previous tiles remain");
  const ids = new Set(post.tiles.map((t) => t.tileId));
  for (const t of before) assert.ok(ids.has(t.id), `D kept ${t.id}`);
  assert.ok(ids.has("4-4"));
  assertAnchorPinned(post, "4-4", VIEWPORTS.desktop, "D");
  const map = byTileId(post);
  assertConnected(map["6-3"], map["3-1"], "D");
  assertConnected(map["3-1"], map["1-4"], "D");
  assertConnected(map["1-4"], map["4-4"], "D");
  const opener = centerOf(map["6-3"]);
  const spin = centerOf(map["4-4"]);
  assert.ok(Math.abs(opener.x - spin.x) > 8, "D opener is no longer the board center");
  assert.ok(map["4-4"].h > map["4-4"].w, "D spinner is vertical");
  assertNoOverlap(post, "D");
  assertInsideSafe(post, VIEWPORTS.desktop, "D");
  console.log("✓ Case D: first double re-anchors; pre-spinner chain was horizontal");
}

{
  // Case E — no double for the entire short round: never invent a spinner.
  const board = [
    tile("6-3", 6, 3),
    tile("3-2", 3, 2),
    tile("2-1", 2, 1),
    tile("1-0", 1, 0),
  ];
  const layout = layoutBoardChain(board, VIEWPORTS.desktop, {
    centerTileId: "6-3",
    spinnerId: null,
  });
  assert.equal(layout.tiles.some((t) => t.double), false, "E no double tiles");
  assertHorizontalMainLine(layout, board, VIEWPORTS.desktop, "E");
  console.log("✓ Case E: no double → no spinner, chain stays horizontal");
}

{
  // applyPlace adapter: first double stamps spinnerId; later double does not.
  let match = createMatch({ seed: 11, playerCount: 2 });
  match = {
    ...match,
    players: [
      { ...match.players[0], hand: ["3-6", "2-3", "1-2", "1-1", "6-6"] },
      match.players[1],
    ],
  };
  match = applyPlace(match, 0, "3-6", END.RIGHT);
  assert.equal(match.spinnerId, null, "opener non-double is not an anchor");
  match = applyPlace(match, 0, "2-3", END.LEFT);
  match = applyPlace(match, 0, "1-2", END.LEFT);
  assert.equal(match.spinnerId, null);
  match = applyPlace(match, 0, "1-1", END.LEFT);
  assert.equal(match.spinnerId, "1-1");
  assert.equal(match.board.length, 4);
  match = applyPlace(match, 0, "6-6", END.RIGHT);
  assert.equal(match.spinnerId, "1-1", "later double must not steal the anchor");
  assert.equal(match.board.length, 5);
  console.log("✓ first double is detected in play order; later doubles stay chain tiles");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const match = (pip + 1) % 7;
    const spinTile = dbl(id, pip);
    const leftTile = tile(`L-${pip}`, match, pip);
    const rightTile = tile(`R-${pip}`, pip, match);
    const northTile = tile(`N-${pip}`, pip, match);
    const southTile = tile(`S-${pip}`, pip, (pip + 2) % 7);

    const leftLayout = layoutBoardChain([leftTile, spinTile], VIEWPORTS.desktop, {
      spinnerId: id,
      centerTileId: id,
    });
    const leftMap = byTileId(leftLayout);
    assert.ok(leftMap[id].h > leftMap[id].w, `${id} spinner is vertical`);
    assert.equal(leftMap[`L-${pip}`].orientation, "horizontal");
    assert.equal(leftMap[`L-${pip}`].branch, "MAIN_LEFT");
    assert.equal(leftMap[`L-${pip}`].travelDir, "W");
    assert.ok(centerOf(leftMap[`L-${pip}`]).x < centerOf(leftMap[id]).x, `${id} LEFT is west`);
    assert.ok(Math.abs(centerOf(leftMap[`L-${pip}`]).y - centerOf(leftMap[id]).y) <= 6);
    assert.equal(leftLayout.armTiles.length, 0);

    const rightLayout = layoutBoardChain([spinTile, rightTile], VIEWPORTS.desktop, {
      spinnerId: id,
      centerTileId: id,
    });
    const rightMap = byTileId(rightLayout);
    assert.equal(rightMap[`R-${pip}`].branch, "MAIN_RIGHT");
    assert.equal(rightMap[`R-${pip}`].travelDir, "E");
    assert.ok(centerOf(rightMap[`R-${pip}`]).x > centerOf(rightMap[id]).x, `${id} RIGHT is east`);
    assert.ok(Math.abs(centerOf(rightMap[`R-${pip}`]).y - centerOf(rightMap[id]).y) <= 6);
    assert.equal(rightLayout.armTiles.length, 0);

    const northLayout = layoutBoardChain([spinTile], VIEWPORTS.desktop, {
      spinnerId: id,
      spinnerNorth: [northTile],
    });
    const n = byTileId(northLayout)[`N-${pip}`];
    assert.equal(n.branch, "SPINNER_TOP");
    assert.equal(n.travelDir, "N");
    assert.ok(n.y + n.h <= byTileId(northLayout)[id].y + 1, `${id} TOP is above`);

    const southLayout = layoutBoardChain([spinTile], VIEWPORTS.desktop, {
      spinnerId: id,
      spinnerSouth: [southTile],
    });
    const s = byTileId(southLayout)[`S-${pip}`];
    assert.equal(s.branch, "SPINNER_BOTTOM");
    assert.equal(s.travelDir, "S");
    assert.ok(s.y >= byTileId(southLayout)[id].y + byTileId(southLayout)[id].h - 1, `${id} BOTTOM is below`);

    const prev = [
      tile(`P2-${pip}`, (pip + 2) % 7, (pip + 1) % 7),
      tile(`P1-${pip}`, (pip + 1) % 7, pip),
      spinTile,
    ];
    const reflow = layoutBoardChain(prev, VIEWPORTS.desktop, {
      spinnerId: id,
      centerTileId: id,
    });
    const { center, left, north, south } = branches(reflow, prev, id);
    assert.ok(center.h > center.w, `${id} reflow spinner vertical`);
    assert.equal(north.length, 0);
    assert.equal(south.length, 0);
    for (const t of left) {
      assert.equal(t.orientation, "horizontal", `${id} ${t.tileId} stays horizontal`);
      assert.equal(t.travelDir, "W");
      assert.ok(centerOf(t).x < centerOf(center).x);
      assert.ok(Math.abs(centerOf(t).y - centerOf(center).y) <= 6);
    }
  }
  console.log("✓ A–F parameterized: spinner 0-0…6-6 LEFT/RIGHT/TOP/BOTTOM + horizontal reflow");
}

{
  // Scenario C/D — first fold is UP on LEFT and DOWN on RIGHT.
  // 5-straight remains the ceiling when it fits; shorter first runs are
  // used when that rail cannot fit at preferred size.
  const compact = { w: 40, h: 76 };
  const packed = mkCross(6, 6);
  const compactLayout = layoutBoardChain(packed.board, VIEWPORTS.desktop, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: compact.w,
    tileHeight: compact.h,
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
  const compactBranches = branches(compactLayout, packed.board, "3-3");
  for (let i = 0; i < 5; i += 1) {
    assert.equal(compactBranches.left[i].travelDir, "W", `compact left[${i}] W`);
    assert.equal(compactBranches.right[i].travelDir, "E", `compact right[${i}] E`);
  }
  assert.equal(compactBranches.left[5].travelDir, FIRST_FOLD_LEFT, "compact left[5] UP");
  assert.equal(compactBranches.right[5].travelDir, FIRST_FOLD_RIGHT, "compact right[5] DOWN");
  assert.ok(compactBranches.left[5].isCorner, "compact left tile 6 is the first fold");
  assert.ok(compactBranches.right[5].isCorner, "compact right tile 6 is the first fold");

  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed);
    const { left, right } = branches(layout, packed.board, "3-3");
    const play = computePlayBounds(vp, 14, 0, 0);
    const safe = computeSafeFeltBounds(play);
    const firstRun = packFirstRunLimit(
      safe.maxX - safe.minX,
      locked.h,
      locked.w,
      2
    );
    const foldAt = Math.min(firstRun, 5);
    for (let i = 0; i < Math.min(foldAt, left.length); i += 1) {
      assert.equal(left[i].travelDir, "W", `${name} left[${i}] W`);
      assert.equal(right[i].travelDir, "E", `${name} right[${i}] E`);
    }
    if (left.length > foldAt) {
      const idx = left.findIndex((t) => t.travelDir !== "W");
      assert.ok(idx >= 1 && idx <= 5, `${name} left fold index ${idx}`);
      assert.equal(left[idx].travelDir, FIRST_FOLD_LEFT, `${name} left first fold UP`);
      assert.ok(left[idx].isCorner, `${name} left first fold is a corner`);
    }
    if (right.length > foldAt) {
      const idx = right.findIndex((t) => t.travelDir !== "E");
      assert.ok(idx >= 1 && idx <= 5, `${name} right fold index ${idx}`);
      assert.equal(right[idx].travelDir, FIRST_FOLD_RIGHT, `${name} right first fold DOWN`);
      assert.ok(right[idx].isCorner, `${name} right first fold is a corner`);
    }
    assertAnchorPinned(layout, "3-3", vp, `${name} CD`);
    assertNoOverlap(layout, `${name} CD`);
    assertInsideSafe(layout, vp, `${name} CD`);
  }
  console.log("✓ Scenario C/D: LEFT→UP and RIGHT→DOWN (5-straight when it fits)");
}

{
  // Scenario E/F — TOP 2 → RIGHT, BOTTOM 2 → LEFT.
  const packed = mkCross(1, 1, 3, 3);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed);
    const { north, south } = branches(layout, packed.board, "3-3");
    assert.equal(north.length, 3);
    assert.equal(south.length, 3);
    assert.equal(north[0].travelDir, "N");
    assert.equal(north[1].travelDir, "N");
    assert.equal(north[2].travelDir, FIRST_FOLD_TOP, `${name} top tile 3 RIGHT`);
    assert.equal(south[0].travelDir, "S");
    assert.equal(south[1].travelDir, "S");
    assert.equal(south[2].travelDir, FIRST_FOLD_BOTTOM, `${name} bottom tile 3 LEFT`);
    assertNoOverlap(layout, `${name} EF`);
    assertInsideSafe(layout, vp, `${name} EF`);
    assert.equal(layout.armTiles.length, 6, `${name} only real N/S arms`);
  }
  console.log("✓ Scenario E/F: TOP 2→RIGHT and BOTTOM 2→LEFT");
}

{
  // No fake N/S branches when the ruleset has none.
  const packed = mkCross(3, 3, 0, 0);
  const layout = layoutCross(VIEWPORTS.desktop, packed);
  assert.equal(layout.armTiles.length, 0);
  assert.equal(layout.tiles.length, 7);
  console.log("✓ four-way arms render only when they exist in board state");
}

{
  // Preferred size for a short balanced chain; uniform scale always.
  const short = mkCross(2, 2);
  const desktopShort = layoutCross(VIEWPORTS.desktop, short);
  assert.ok(desktopShort.scale >= 0.99, `short chain scale ${desktopShort.scale}`);
  const scales = new Set(
    [...desktopShort.tiles, ...desktopShort.armTiles].map(() => desktopShort.scale)
  );
  assert.equal(scales.size, 1);

  const medium = mkCross(4, 4);
  const desktopMed = layoutCross(VIEWPORTS.desktop, medium);
  assert.ok(desktopMed.scale > 0.05 && desktopMed.scale <= 1);
  assertInsideSafe(desktopMed, VIEWPORTS.desktop, "medium");
  console.log("✓ short chain keeps preferred size; medium stays uniform");
}

{
  // Scenario G — long chain: uniform auto-fit, no overflow, anchor stays.
  const packed = mkCross(10, 10, 4, 4);
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const layout = layoutCross(vp, packed);
    const expected =
      packed.board.length + packed.north.length + packed.south.length;
    assert.equal(
      layout.tiles.length + layout.armTiles.length,
      expected,
      `${name} long: no missing tiles`
    );
    const tileScales = new Set(
      [...layout.tiles, ...layout.armTiles].map(() => layout.scale)
    );
    assert.equal(tileScales.size, 1, `${name} long uniform scale`);
    assert.ok(layout.scale <= 1);
    assertNoOverlap(layout, `${name} long`);
    assertInsideSafe(layout, vp, `${name} long`);
    assertAnchorPinned(layout, "3-3", vp, `${name} long`);
  }
  const phone = layoutCross(VIEWPORTS.phone, packed);
  const desktop = layoutCross(VIEWPORTS.desktop, packed);
  assert.ok(
    desktop.scale + 0.001 >= phone.scale,
    `larger viewport restores scale phone=${phone.scale} desktop=${desktop.scale}`
  );
  console.log("✓ Scenario G: long chain auto-fits uniformly; larger viewport restores scale");
}

{
  // Same state → same geometry (determinism).
  const packed = mkCross(7, 7, 3, 3);
  const a = layoutCross(VIEWPORTS.desktop, packed);
  const b = layoutCross(VIEWPORTS.desktop, packed);
  assert.equal(a.scale, b.scale);
  for (let i = 0; i < a.tiles.length; i += 1) {
    assert.equal(a.tiles[i].x, b.tiles[i].x);
    assert.equal(a.tiles[i].y, b.tiles[i].y);
    assert.equal(a.tiles[i].travelDir, b.tiles[i].travelDir);
  }
  console.log("✓ same board state always generates the same geometry");
}

{
  // Every registered ruleset lays out through the shared engine.
  for (const rulesetId of listRulesetIds()) {
    const ruleset = resolveRuleset(rulesetId);
    const playerCount = Array.isArray(ruleset.supportedPlayerCounts)
      ? ruleset.supportedPlayerCounts[0]
      : ruleset.playerCount?.min ?? 2;
    let state = startMatch({
      rulesetId,
      seed: 20260815,
      playerCount,
      targetScore: ruleset.defaultTargetScore,
    });
    const actions = getAvailableActions(state);
    if (actions.legalMoves.length) {
      const move = actions.legalMoves[0];
      state = playTile(state, move.tileId, move.end);
    }
    const opener = state.board[0];
    assert.ok(opener, `${rulesetId}: opening tile played`);
    if (opener.left === opener.right) {
      assert.equal(state.spinnerId, opener.id, `${rulesetId}: opening double is the layout anchor`);
    }
    const layout = layoutBoardChain(state.board, VIEWPORTS.desktop, {
      spinnerId: state.spinnerId,
      centerTileId: state.spinnerId || opener.id,
      spinnerNorth: state.spinnerNorth,
      spinnerSouth: state.spinnerSouth,
    });
    assert.equal(layout.tiles.length, state.board.length, `${rulesetId} layout count`);
    assertNoOverlap(layout, rulesetId);
    assertInsideSafe(layout, VIEWPORTS.desktop, rulesetId);
    if (opener.left !== opener.right && !state.spinnerId) {
      assert.equal(layout.tiles[0].orientation, "horizontal", `${rulesetId}: non-double opener horizontal`);
      assert.equal(layout.armTiles.length, 0, `${rulesetId}: no fake spinner`);
    }
  }
  console.log("✓ every ruleset renders through the shared LeoDomino layout engine");
}

{
  const packedTwo = {
    board: [tile("2-5", 2, 5), tile("5-6", 5, 6)],
  };
  const packedA = {
    board: [tile("6-3", 6, 3), tile("3-2", 3, 2), tile("2-1", 2, 1)],
  };
  const packedB = {
    board: [tile("6-3", 6, 3), tile("3-2", 3, 2), tile("2-1", 2, 1), dbl("1-1", 1)],
  };
  const packedC = mkCross(6, 0);
  const packedD = mkCross(0, 6);
  const packedE = mkCross(0, 0, 3, 0);
  const packedF = mkCross(0, 0, 0, 3);
  const packedG = mkCross(10, 10, 4, 4);
  const scenes = [
    ["A-one-non-double", [tile("5-6", 5, 6)], { centerTileId: "5-6" }],
    ["B-two-non-doubles", packedTwo.board, { centerTileId: "2-5", spinnerId: null }],
    ["A-no-double", packedA.board, { centerIndex: 0 }],
    ["B-first-double", packedB.board, { spinnerId: "1-1", centerTileId: "1-1" }],
    ["C-left-up", packedC.board, { spinnerId: "3-3", spinnerNorth: packedC.north, spinnerSouth: packedC.south }],
    ["D-right-down", packedD.board, { spinnerId: "3-3" }],
    ["E-top-right", packedE.board, { spinnerId: "3-3", spinnerNorth: packedE.north, spinnerSouth: packedE.south }],
    ["F-bottom-left", packedF.board, { spinnerId: "3-3", spinnerNorth: packedF.north, spinnerSouth: packedF.south }],
    ["G-long-chain", packedG.board, { spinnerId: "3-3", spinnerNorth: packedG.north, spinnerSouth: packedG.south }],
  ];
  for (const [name, board, extra] of scenes) {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      const layout = layoutBoardChain(board, vp, extra);
      writeFileSync(
        `/tmp/leo-layout-${name}-${vpName}.svg`,
        toSvg(layout, vp, `${name} ${vpName}`)
      );
    }
  }
  console.log("✓ wrote visual scenario SVGs to /tmp/leo-layout-*.svg");
}

console.log("\nLeoDomino universal chain layout tests passed.");
