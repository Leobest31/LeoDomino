/**
 * Preferred played-domino size: +20% vs the previous 99×186 reference.
 * Auto-fit still shrinks the complete chain only when the AABB cannot fit.
 * Run: node src/board/playedPreferredScale.layout.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAMEPLAY_REF,
  PLAYED_PREFERRED_SCALE,
  PHONE_PLAYED_SIZE_BOOST,
  PLAYED_LONG_MAX_OF_FELT_H,
  PLAYED_LONG_MAX_OF_FELT_H_SHORT,
  PLAYED_SHORT_MAX_PX,
  resolveGameplayLayout,
  gameplayComposition,
  rectsOverlap,
} from "../ui/gameplayLayout.js";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  FIRST_FOLD_BOTTOM,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
} from "./layoutEngine.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

const TILE_RATIO = GAMEPLAY_REF.playedLong / GAMEPLAY_REF.playedShort;
const OLD_SHORT = 99;
const OLD_LONG = 186;
const OLD_RATIO = OLD_LONG / OLD_SHORT;
const OLD_OCC = 0.42;
const OLD_SHORT_MAX = 114;
const OLD_SHORT_OF_W = OLD_SHORT / 1151;

const VIEWPORTS = [
  { name: "phone-740", width: 740, height: 360 },
  { name: "phone-844", width: 844, height: 390 },
  { name: "phone-852", width: 852, height: 393 },
  { name: "phone-915", width: 915, height: 412 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "tablet-1151", width: 1151, height: 644 },
  { name: "tablet-1280", width: 1280, height: 800 },
  { name: "desktop-1366", width: 1366, height: 768 },
];

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Previous preferred-size formula (99×186, occupancy 0.42, short cap 114). */
function oldPlayedSize(layout) {
  const heightScale = clamp(layout.safeH / GAMEPLAY_REF.height, 0.42, 1.12);
  let playedLong = OLD_LONG * heightScale;
  let playedShort = playedLong / OLD_RATIO;
  const maxLongUsable = layout.usableBoardHeight * OLD_OCC;
  if (playedLong > maxLongUsable) {
    playedLong = maxLongUsable;
    playedShort = playedLong / OLD_RATIO;
  }
  const maxOneTile = layout.usableBoardHeight * 0.92;
  if (playedLong > maxOneTile) {
    playedLong = maxOneTile;
    playedShort = playedLong / OLD_RATIO;
  }
  const maxShort = layout.feltWidth * OLD_SHORT_OF_W;
  if (playedShort > maxShort) {
    playedShort = maxShort;
    playedLong = playedShort * OLD_RATIO;
  }
  playedShort = clamp(playedShort, 28, OLD_SHORT_MAX);
  playedLong = playedShort * OLD_RATIO;
  return { playedShort, playedLong };
}

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function chainOf(n) {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  const leftN = Math.floor((n - 1) / 2);
  const rightN = n - 1 - leftN;
  for (let i = 1; i <= leftN; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= rightN; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return board;
}

function spinnerPacked(left, right, north, south) {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= left; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= right; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  const northTiles = [];
  let nPip = 3;
  for (let i = 1; i <= north; i += 1) {
    const next = (nPip + 3) % 7;
    northTiles.push(tile(`N${i}`, nPip, next));
    nPip = next;
  }
  const southTiles = [];
  let sPip = 3;
  for (let i = 1; i <= south; i += 1) {
    const next = (sPip + 4) % 7;
    southTiles.push(tile(`S${i}`, sPip, next));
    sPip = next;
  }
  return { board, north: northTiles, south: southTiles };
}

function stageOf(L) {
  return {
    width: Math.round(L.feltWidth * 0.97),
    height: Math.round(L.feltHeight),
  };
}

function layoutChain(L, board, extra = {}) {
  return calculateBoardLayout(board, stageOf(L), {
    centerTileId: board.find((t) => t.id === "3-3") ? "3-3" : board[0].id,
    tileWidth: L.playedShort,
    tileHeight: L.playedLong,
    hudRight: 0,
    hudLeft: 0,
    hudBottom: 0,
    spinnerId: extra.spinnerId ?? (board.some((t) => t.id === "3-3") ? "3-3" : null),
    spinnerNorth: extra.north ?? [],
    spinnerSouth: extra.south ?? [],
  });
}

function assertContained(layout, L, label) {
  const stage = stageOf(L);
  const play = computePlayBounds(stage, 14, 0, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  assert.ok(boxes.length > 0, `${label} has tiles`);
  for (const t of boxes) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), `${label} ${t.tileId} finite`);
    assert.ok(t.x >= safe.minX - 0.75, `${label} ${t.tileId} left`);
    assert.ok(t.y >= safe.minY - 0.75, `${label} ${t.tileId} top`);
    assert.ok(t.x + t.w <= safe.maxX + 0.75, `${label} ${t.tileId} right`);
    assert.ok(t.y + t.h <= safe.maxY + 0.75, `${label} ${t.tileId} bottom`);
  }
  const C = gameplayComposition(L);
  assert.ok(C.felt.bottom <= C.hand.top + 0.01, `${label} feltBottom <= handTop`);
  assert.ok(!rectsOverlap(C.felt, C.hand, 0.5), `${label} felt vs hand`);
  return { play, safe, boxes };
}

function section(title) {
  console.log(`✓ ${title}`);
}

assert.equal(PLAYED_PREFERRED_SCALE, 1.2);
assert.equal(PHONE_PLAYED_SIZE_BOOST, 1.15);
assert.equal(GAMEPLAY_REF.playedShort, OLD_SHORT * PLAYED_PREFERRED_SCALE);
assert.equal(GAMEPLAY_REF.playedLong, OLD_LONG * PLAYED_PREFERRED_SCALE);
assert.equal(LOCKED_BOARD_TILE_SHORT_PX, GAMEPLAY_REF.playedShort);
assert.equal(LOCKED_BOARD_TILE_LONG_PX, GAMEPLAY_REF.playedLong);
assert.ok(Math.abs(TILE_RATIO - OLD_RATIO) < 1e-9, "aspect ratio unchanged");
assert.equal(GAMEPLAY_REF.handShort, 33);
assert.equal(GAMEPLAY_REF.handLong, 60);
assert.equal(GAMEPLAY_REF.felt, 578);
section("one +20% source of truth; hand size unchanged");

const reports = [];

for (const vp of VIEWPORTS) {
  const L = resolveGameplayLayout(vp);
  const old = oldPlayedSize(L);
  const shortPct = (L.playedShort / old.playedShort) * 100;
  const longPct = (L.playedLong / old.playedLong) * 100;
  assert.ok(
    Math.abs(L.playedLong / L.playedShort - OLD_RATIO) < 0.002,
    `${vp.name} aspect`
  );
  const phoneCanvas = L.density === "short";
  const lo = phoneCanvas ? 136 : 118;
  const hi = phoneCanvas ? 141 : 122;
  assert.ok(
    shortPct > lo && shortPct < hi && longPct > lo && longPct < hi,
    `${vp.name} preferred ${phoneCanvas ? "+38% phone" : "+20%"} got ${shortPct.toFixed(1)}% × ${longPct.toFixed(1)}% (${Math.round(old.playedShort)}×${Math.round(old.playedLong)} → ${Math.round(L.playedShort)}×${Math.round(L.playedLong)})`
  );
  assert.ok(L.playedShort <= PLAYED_SHORT_MAX_PX + 0.01, `${vp.name} short cap`);
  const occCap =
    L.density === "short" ? PLAYED_LONG_MAX_OF_FELT_H_SHORT : PLAYED_LONG_MAX_OF_FELT_H;
  assert.ok(
    L.playedLong / L.feltHeight <= occCap + 0.01,
    `${vp.name} occupancy`
  );

  reports.push({
    vp: vp.name,
    feltW: Math.round(L.feltWidth),
    feltH: Math.round(L.feltHeight),
    oldW: Number(old.playedShort.toFixed(1)),
    oldH: Number(old.playedLong.toFixed(1)),
    newW: Number(L.playedShort.toFixed(1)),
    newH: Number(L.playedLong.toFixed(1)),
    pct: Number(longPct.toFixed(1)),
    oldRel: Number((old.playedLong / L.feltHeight).toFixed(3)),
    newRel: Number((L.playedLong / L.feltHeight).toFixed(3)),
  });
}
section("preferred dimensions +20% on every required viewport");
console.log("Preferred size by viewport:\n", reports);

{
  const phone = resolveGameplayLayout({ width: 844, height: 390 });
  const tablet = resolveGameplayLayout({ width: 1280, height: 800 });
  assert.ok(
    phone.playedLong < tablet.playedLong * 0.75,
    "phone absolute size still shrinks with the canvas"
  );
  const layoutSrc = read("../ui/gameplayLayout.js");
  assert.equal(
    (layoutSrc.match(/PLAYED_PREFERRED_SCALE/g) || []).length > 0,
    true
  );
  assert.doesNotMatch(layoutSrc, /Galaxy|SM_A376|iPhone|Samsung/);
  section("phone/tablet share one responsive formula");
}

const chainClasses = [
  { name: "short-1", n: 1 },
  { name: "short-3", n: 3 },
  { name: "short-6", n: 6 },
  { name: "short-10", n: 10 },
  { name: "medium-14", n: 14 },
  { name: "medium-18", n: 18 },
  { name: "long-24", n: 24 },
  { name: "long-28", n: 28 },
];

const chainReport = [];
for (const vp of VIEWPORTS) {
  const L = resolveGameplayLayout(vp);
  const scales = [];
  for (const cls of chainClasses) {
    const board = chainOf(cls.n);
    const layout = layoutChain(L, board);
    assert.equal(layout.tiles.length, cls.n, `${vp.name} ${cls.name} count`);
    const { safe, boxes } = assertContained(layout, L, `${vp.name} ${cls.name}`);
    const bb = computeChainBounds(
      boxes.map((t) => ({ id: t.tileId, x: t.x, y: t.y, w: t.w, h: t.h }))
    );
    const slackX = safe.maxX - safe.minX - bb.width;
    const slackY = safe.maxY - safe.minY - bb.height;
    if (cls.n <= 3) {
      assert.ok(
        layout.scale >= 0.99,
        `${vp.name} ${cls.name} should keep preferred scale, got ${layout.scale}`
      );
    } else if (cls.n <= 6) {
      assert.ok(
        layout.scale >= 0.78,
        `${vp.name} ${cls.name} should use felt before a deep shrink, got ${layout.scale}`
      );
    }
    assert.ok(layout.scale > 0.05 && layout.scale <= 1);
    const sample = boxes[0];
    scales.push(layout.scale);
    chainReport.push({
      vp: vp.name,
      cls: cls.name,
      n: cls.n,
      preferred: `${Math.round(L.playedShort)}×${Math.round(L.playedLong)}`,
      scale: Number(layout.scale.toFixed(3)),
      rendered: `${Math.round(sample.w)}×${Math.round(sample.h)}`,
      bb: `${Math.round(bb.width)}×${Math.round(bb.height)}`,
      slack: `${Math.round(slackX)}×${Math.round(slackY)}`,
    });
  }
  for (let i = 1; i < scales.length; i += 1) {
    assert.ok(
      scales[i] <= scales[i - 1] + 0.02,
      `${vp.name} scale cliff ${chainClasses[i - 1].name}=${scales[i - 1]} → ${chainClasses[i].name}=${scales[i]}`
    );
    if (chainClasses[i].n >= 10 && chainClasses[i - 1].n >= 10) {
      assert.ok(
        scales[i - 1] - scales[i] < 0.28,
        `${vp.name} adjacent shrink ${chainClasses[i - 1].name}→${chainClasses[i].name} ${scales[i - 1]}→${scales[i]}`
      );
    }
  }
}
section("short/medium/long chains: preferred when it fits; uniform auto-fit; no scale cliff");

{
  for (const vp of VIEWPORTS) {
    const L = resolveGameplayLayout(vp);
    const packed = spinnerPacked(4, 4, 3, 3);
    const layout = layoutChain(L, packed.board, packed);
    const played =
      packed.board.length + packed.north.length + packed.south.length;
    assert.equal(
      layout.tiles.length + layout.armTiles.length,
      played,
      `${vp.name} spinner keeps every tile`
    );
    assertContained(layout, L, `${vp.name} spinner`);
    const s3 = layout.armTiles.find((t) => t.tileId === "S3");
    assert.ok(s3, `${vp.name} S3 exists`);
    assert.equal(
      s3.travelDir,
      FIRST_FOLD_BOTTOM,
      `${vp.name} south tile 3 still turns LEFT`
    );
  }
  section("spinner containment + south 3rd-tile LEFT routing unchanged");
}

{
  const page = read("../pages/GamePage.jsx");
  const dest = read("../game/destinationTarget.js");
  const board = read("BoardContainer.jsx");
  const down = page.slice(
    page.indexOf("handleTilePointerDown"),
    page.indexOf("runDrawSequence")
  );
  assert.match(down, /if \(!ends\.length\) return/);
  assert.doesNotMatch(down, /ends\.length < 2/);
  assert.match(page, /DESTINATION_TAP_SLOP_PX/);
  assert.match(page, /data-travel-dir/);
  assert.match(dest, /resolveDestinationOutward/);
  assert.match(dest, /target\.outward/);
  assert.match(board, /data-travel-dir=\{pos\.travelDir/);
  assert.match(page, /toSelector: `\[data-board-tile="\$\{tileId\}"\]`/);
  section("zero-end, tap/drag, folded-face, and flight contracts unchanged");
}

console.log("Chain class samples:\n", chainReport.filter((r) =>
  (r.vp === "phone-844" || r.vp === "tablet-1280") &&
  ["short-1", "short-10", "medium-14", "long-28"].includes(r.cls)
));
console.log("Played preferred-scale layout tests passed.");
