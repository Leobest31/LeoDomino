/**
 * 27-tile board-layout stress audit — Classic + American fixtures.
 * Layout measurement only. Does not change gameplay rules or production packing.
 *
 * Run: node src/board/board27Stress.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  countTurns,
  MARGIN,
  resolveBoardTileBase,
} from "./layoutEngine.js";
import {
  assertLogicalConnections,
  assertVisualConnections,
} from "./connectionDisplay.js";
import { resolveGameplayLayout } from "../ui/gameplayLayout.js";

const SPIN = "3-3";

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

/**
 * Legal connected arms from spinner pip `spinPip`.
 * Synthetic ids; pip-cycle connections (same approach as other layout fixtures).
 */
function growArm(prefix, count, spinPip, step) {
  const out = [];
  let pip = spinPip;
  for (let i = 1; i <= count; i += 1) {
    const next = (pip + step) % 7;
    out.push(tile(`${prefix}${i}`, pip, next));
    pip = next;
  }
  return out;
}

function packMain(leftCount, rightCount, spinPip = 3, extraDoubles = false) {
  const board = [dbl(SPIN, spinPip)];
  let leftPip = spinPip;
  for (let i = 1; i <= leftCount; i += 1) {
    if (extraDoubles && i % 4 === 0 && leftPip !== spinPip) {
      board.unshift(dbl(`Ld${i}`, leftPip));
    } else {
      const next = (leftPip + 1) % 7;
      board.unshift(tile(`L${i}`, next, leftPip));
      leftPip = next;
    }
  }
  let rightPip = spinPip;
  for (let i = 1; i <= rightCount; i += 1) {
    if (extraDoubles && i % 3 === 0) {
      board.push(dbl(`Rd${i}`, rightPip));
    } else {
      const next = (rightPip + 2) % 7;
      board.push(tile(`R${i}`, rightPip, next));
      rightPip = next;
    }
  }
  return board;
}

function classicCase(id, name, left, right, extraDoubles = false) {
  const board = packMain(left, right, 3, extraDoubles);
  const n = board.length;
  assert.equal(n, 27, `classic ${id} count ${n}`);
  return {
    id,
    name,
    ruleset: "classic",
    board,
    north: [],
    south: [],
    left,
    right,
    northN: 0,
    southN: 0,
  };
}

function americanCase(id, name, left, right, north, south) {
  const spinPip = 3;
  const board = packMain(left, right, spinPip, false);
  const northTiles = growArm("N", north, spinPip, 3);
  const southTiles = growArm("S", south, spinPip, 4);
  const n = board.length + northTiles.length + southTiles.length;
  assert.equal(n, 27, `american ${id} count ${n} (L${left} R${right} N${north} S${south})`);
  return {
    id,
    name,
    ruleset: "american",
    board,
    north: northTiles,
    south: southTiles,
    left,
    right,
    northN: north,
    southN: south,
  };
}

const CLASSIC = [
  classicCase(1, "Long horizontal / heavy RIGHT before folds", 5, 21),
  classicCase(2, "Early folds — 10/16 split", 10, 16),
  classicCase(3, "Strong LEFT-side growth", 20, 6),
  classicCase(4, "Strong RIGHT-side growth", 6, 20),
  classicCase(5, "Balanced LEFT/RIGHT", 13, 13),
  classicCase(6, "Width-heavy (few doubles)", 12, 14, false),
  classicCase(7, "Height-heavy snake (many doubles)", 13, 13, true),
  classicCase(8, "Dense multi-turn 8/18 split", 8, 18),
  classicCase(9, "Many doubles through the chain", 12, 14, true),
  classicCase(10, "Difficult one-sided 1/25 + doubles", 1, 25, true),
];

const AMERICAN = [
  americanCase(1, "Mostly LEFT/RIGHT main chain", 13, 13, 0, 0),
  americanCase(2, "Long LEFT, shorter others", 16, 4, 3, 3),
  americanCase(3, "Long RIGHT, shorter others", 4, 16, 3, 3),
  americanCase(4, "Long TOP branch", 5, 5, 12, 4),
  americanCase(5, "Long BOTTOM branch", 5, 5, 4, 12),
  americanCase(6, "Balanced four-way Spinner", 7, 7, 6, 6),
  americanCase(7, "Width-heavy four-way", 10, 10, 3, 3),
  americanCase(8, "Height-heavy four-way", 4, 4, 9, 9),
  americanCase(9, "Dense asymmetric four-way", 11, 3, 8, 4),
  americanCase(10, "Hardest N/S pressure 2/2/11/11", 2, 2, 11, 11),
];

function tabletStage() {
  const L = resolveGameplayLayout({ width: 1280, height: 800 });
  return {
    name: "tablet-A9+",
    width: Math.round(L.feltWidth * 0.97),
    height: Math.round(L.feltHeight),
    feltCss: { w: L.feltWidth, h: L.feltHeight },
    preferred: { w: L.playedShort, h: L.playedLong },
  };
}

function a37Stage() {
  // Real Galaxy A37 4p felt measured 2026-08-17: 617×181 CSS.
  const L = resolveGameplayLayout({ width: 832, height: 384 });
  return {
    name: "phone-A37",
    width: 617,
    height: 181,
    feltCss: { w: 617, h: 181 },
    preferred: { w: L.playedShort, h: L.playedLong },
  };
}

function extraStages() {
  const vps = [
    { name: "vp-1280x800", width: 1280, height: 800 },
    { name: "vp-1024x768", width: 1024, height: 768 },
    { name: "vp-844x390", width: 844, height: 390 },
    { name: "vp-740x360", width: 740, height: 360 },
  ];
  return vps.map((vp) => {
    const L = resolveGameplayLayout(vp);
    return {
      name: vp.name,
      width: Math.round(L.feltWidth * 0.97),
      height: Math.round(L.feltHeight),
      feltCss: { w: L.feltWidth, h: L.feltHeight },
      preferred: { w: L.playedShort, h: L.playedLong },
    };
  });
}

function layoutOf(stage, tileSize, packed) {
  return calculateBoardLayout(packed.board, stage, {
    centerTileId: SPIN,
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
    hudRight: 0,
    hudLeft: 0,
    spinnerId: SPIN,
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

function boxesOf(layout) {
  return [...layout.tiles, ...(layout.armTiles || [])].map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    travelDir: t.travelDir,
    branch: t.branch,
  }));
}

function overlapCount(boxes) {
  let n = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        a.x < b.x + b.w - 0.5 &&
        a.x + a.w > b.x + 0.5 &&
        a.y < b.y + b.h - 0.5 &&
        a.y + a.h > b.y + 0.5
      ) {
        n += 1;
      }
    }
  }
  return n;
}

function clipCount(boxes, safe) {
  let n = 0;
  for (const b of boxes) {
    if (
      b.x < safe.minX - 0.75 ||
      b.y < safe.minY - 0.75 ||
      b.x + b.w > safe.maxX + 0.75 ||
      b.y + b.h > safe.maxY + 0.75
    ) {
      n += 1;
    }
  }
  return n;
}

function readability(shortPx) {
  if (shortPx >= 40) return "comfortable";
  if (shortPx >= 28) return "acceptable";
  if (shortPx >= 18) return "tight";
  return "poor";
}

function utilizationNote(scale, slackFracW, slackFracH) {
  if (scale >= 0.85) return "efficient (near preferred)";
  if (slackFracW < 0.12 || slackFracH < 0.12) return "efficient (axis-bound)";
  if (scale < 0.5 && slackFracW > 0.28 && slackFracH > 0.28) {
    return "WASTED — tiny tiles with unused felt on both axes";
  }
  if (scale < 0.55 && Math.max(slackFracW, slackFracH) > 0.4) {
    return "uneven — scaled down with large slack on one axis";
  }
  return "mixed";
}

function bindingAxis(slackW, slackH) {
  if (Math.abs(slackW - slackH) < 4) return "both";
  return slackW < slackH ? "width" : "height";
}

function measure(packed, stage) {
  const tileSize = resolveBoardTileBase(stage, {
    w: stage.preferred.w,
    h: stage.preferred.h,
  });
  const layout = layoutOf(stage, tileSize, packed);
  const boxes = boxesOf(layout);
  const play = computePlayBounds(stage, MARGIN, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const aabb = computeChainBounds(boxes);
  const safeW = safe.maxX - safe.minX;
  const safeH = safe.maxY - safe.minY;
  const slackW = safeW - aabb.width;
  const slackH = safeH - aabb.height;
  const sample = boxes[0];
  const short = sample ? Math.min(sample.w, sample.h) : 0;
  const long = sample ? Math.max(sample.w, sample.h) : 0;
  const overlaps = overlapCount(boxes);
  const clips = clipCount(boxes, safe);
  const played = packed.board.length + packed.north.length + packed.south.length;
  const logical = assertLogicalConnections(packed.board);
  const visual = assertVisualConnections(
    packed.board,
    layout.tiles.map((t) => ({
      id: t.tileId,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      orientation: t.orientation,
      rotation: t.rotation,
    }))
  );
  let armLogical = { ok: true };
  if (packed.north.length) {
    armLogical = assertLogicalConnections([
      { id: SPIN, left: 3, right: 3 },
      ...packed.north,
    ]);
  }
  if (armLogical.ok && packed.south.length) {
    armLogical = assertLogicalConnections([
      { id: SPIN, left: 3, right: 3 },
      ...packed.south,
    ]);
  }
  const safeCx = (safe.minX + safe.maxX) / 2;
  const safeCy = (safe.minY + safe.maxY) / 2;
  const centered =
    Math.abs(aabb.cx - safeCx) < 8 && Math.abs(aabb.cy - safeCy) < 8;
  const slackFracW = slackW / safeW;
  const slackFracH = slackH / safeH;
  const scale = Number(layout.scale);
  return {
    played,
    boxes: boxes.length,
    missing: played - boxes.length,
    felt: { w: stage.width, h: stage.height },
    safe: { w: +safeW.toFixed(1), h: +safeH.toFixed(1) },
    aabb: {
      w: +aabb.width.toFixed(1),
      h: +aabb.height.toFixed(1),
      cx: +aabb.cx.toFixed(1),
      cy: +aabb.cy.toFixed(1),
    },
    scale: +scale.toFixed(3),
    short: +short.toFixed(1),
    long: +long.toFixed(1),
    slackW: +slackW.toFixed(1),
    slackH: +slackH.toFixed(1),
    slackFracW: +slackFracW.toFixed(3),
    slackFracH: +slackFracH.toFixed(3),
    turns: countTurns([...layout.tiles, ...(layout.armTiles || [])]),
    overlaps,
    clips,
    overflow: Boolean(layout.camera?.overflow),
    centered,
    logicalOk: logical.ok,
    visualOk: visual.ok,
    armLogicalOk: armLogical.ok,
    spinner: boxes.find((b) => b.id === SPIN) || null,
    readability: readability(short),
    utilization: utilizationNote(scale, slackFracW, slackFracH),
    binding: bindingAxis(slackW, slackH),
    preferred: tileSize,
  };
}

function runCase(packed, stage) {
  const m = measure(packed, stage);
  assert.equal(m.played, 27, `${packed.ruleset} ${packed.id} ${stage.name} played`);
  assert.equal(
    m.boxes,
    27,
    `${packed.ruleset} ${packed.id} ${stage.name} rendered ${m.boxes}`
  );
  assert.equal(m.missing, 0, `${packed.ruleset} ${packed.id} ${stage.name} missing`);
  assert.equal(m.overlaps, 0, `${packed.ruleset} ${packed.id} ${stage.name} overlap`);
  assert.equal(m.clips, 0, `${packed.ruleset} ${packed.id} ${stage.name} clip`);
  assert.equal(m.overflow, false, `${packed.ruleset} ${packed.id} ${stage.name} overflow`);
  assert.equal(m.logicalOk, true, `${packed.ruleset} ${packed.id} ${stage.name} logical`);
  assert.equal(m.armLogicalOk, true, `${packed.ruleset} ${packed.id} ${stage.name} arm logical`);
  return m;
}

function fmt(m) {
  return {
    felt: `${m.felt.w}×${m.felt.h}`,
    safe: `${m.safe.w}×${m.safe.h}`,
    aabb: `${m.aabb.w}×${m.aabb.h}`,
    scale: m.scale,
    tile: `${m.short}×${m.long}`,
    slack: `${m.slackW}×${m.slackH}`,
    turns: m.turns,
    contain: m.clips === 0 && !m.overflow ? "IN" : "CLIP",
    overlap: m.overlaps === 0 ? "none" : m.overlaps,
    missing: m.missing,
    centered: m.centered,
    util: m.utilization,
    read: m.readability,
    bind: m.binding,
    visual: m.visualOk ? "ok" : "FAIL",
  };
}

const primary = [a37Stage(), tabletStage()];
const extras = extraStages();

const classicPrimary = [];
const americanPrimary = [];
const allRows = [];

for (const stage of primary) {
  for (const c of CLASSIC) {
    const m = runCase(c, stage);
    const row = { stage: stage.name, ...c, ...m, view: fmt(m) };
    classicPrimary.push(row);
    allRows.push(row);
  }
  for (const a of AMERICAN) {
    const m = runCase(a, stage);
    const row = { stage: stage.name, ...a, ...m, view: fmt(m) };
    americanPrimary.push(row);
    allRows.push(row);
  }
}

let extraMin = null;
for (const stage of extras) {
  for (const c of [...CLASSIC, ...AMERICAN]) {
    const m = runCase(c, stage);
    if (!extraMin || m.short < extraMin.short) {
      extraMin = { stage: stage.name, id: c.id, ruleset: c.ruleset, name: c.name, ...m };
    }
  }
}

const smallest = allRows.reduce((s, r) => (!s || r.short < s.short ? r : s), null);

console.log("\n=== 27-tile stress — CLASSIC (primary devices) ===");
console.log(
  [
    "dev",
    "t",
    "name",
    "felt",
    "safe",
    "aabb",
    "scale",
    "tile",
    "slackWH",
    "turns",
    "in",
    "ov",
    "miss",
    "ctr",
    "util",
    "read",
    "bind",
  ].join("\t")
);
for (const r of classicPrimary) {
  const v = r.view;
  console.log(
    [
      r.stage,
      r.id,
      r.name.slice(0, 36),
      v.felt,
      v.safe,
      v.aabb,
      v.scale,
      v.tile,
      v.slack,
      v.turns,
      v.contain,
      v.overlap,
      v.missing,
      v.centered,
      v.util,
      v.read,
      v.bind,
    ].join("\t")
  );
}

console.log("\n=== 27-tile stress — AMERICAN (primary devices) ===");
console.log(
  [
    "dev",
    "t",
    "name",
    "L/R/N/S",
    "felt",
    "safe",
    "aabb",
    "scale",
    "tile",
    "slackWH",
    "turns",
    "in",
    "ov",
    "vis",
    "util",
    "read",
    "bind",
  ].join("\t")
);
for (const r of americanPrimary) {
  const v = r.view;
  console.log(
    [
      r.stage,
      r.id,
      r.name.slice(0, 32),
      `${r.left}/${r.right}/${r.northN}/${r.southN}`,
      v.felt,
      v.safe,
      v.aabb,
      v.scale,
      v.tile,
      v.slack,
      v.turns,
      v.contain,
      v.overlap,
      v.visual,
      v.util,
      v.read,
      v.bind,
    ].join("\t")
  );
}

console.log("\n=== smallest primary ===");
console.log({
  ruleset: smallest.ruleset,
  test: smallest.id,
  name: smallest.name,
  device: smallest.stage,
  scale: smallest.scale,
  tile: `${smallest.short}×${smallest.long}`,
  binding: smallest.binding,
  slackW: smallest.slackW,
  slackH: smallest.slackH,
  slackFracW: smallest.slackFracW,
  slackFracH: smallest.slackFracH,
  LRNS: `${smallest.left}/${smallest.right}/${smallest.northN}/${smallest.southN}`,
});

if (extraMin) {
  console.log("\n=== smallest extra viewport class ===");
  console.log({
    stage: extraMin.stage,
    ruleset: extraMin.ruleset,
    test: extraMin.id,
    name: extraMin.name,
    scale: extraMin.scale,
    tile: `${extraMin.short}×${extraMin.long}`,
    binding: extraMin.binding,
  });
}

const wasted = allRows.filter((r) => r.utilization.startsWith("WASTED") || r.utilization.startsWith("uneven"));
console.log("\n=== wasted / uneven utilization (primary) ===");
for (const r of wasted) {
  console.log(
    r.stage,
    r.ruleset,
    r.id,
    r.utilization,
    `scale=${r.scale}`,
    `tile=${r.short}×${r.long}`,
    `slack%=${(r.slackFracW * 100).toFixed(0)}×${(r.slackFracH * 100).toFixed(0)}`
  );
}

console.log("\nBoard 27-tile stress layout tests passed.");
