/**
 * Felt utilization: auto-fit may shrink only when the REAL played AABB
 * cannot fit. A medium/long chain must not go tiny while both axes still
 * have large unused felt.
 *
 * Run: node src/board/boardUtilization.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  packFirstRunLimit,
  packRunLimit,
  packLaterRunSearchLimit,
  packSpinnerArmLimit,
  LEO_MAIN_STRAIGHT,
  FIRST_FOLD_BOTTOM,
  FIRST_FOLD_TOP,
  MARGIN,
  CHAIN_GAP,
  resolveBoardTileBase,
} from "./layoutEngine.js";
import {
  GAMEPLAY_REF,
  PLAYED_PREFERRED_SCALE,
  resolveGameplayLayout,
} from "../ui/gameplayLayout.js";

assert.equal(PLAYED_PREFERRED_SCALE, 1.2);
assert.equal(LEO_MAIN_STRAIGHT, 5);

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

const COUNTS = [1, 3, 8, 14, 20, 24, 28];

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
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

function splitCount(n) {
  if (n <= 1) return { left: 0, right: 0, north: 0, south: 0 };
  const arms = n - 1;
  const left = Math.ceil(arms / 2);
  const right = Math.floor(arms / 2);
  return { left, right, north: 0, south: 0 };
}

function foldedSpinner(n) {
  if (n <= 1) return fourWay(0, 0, 0, 0);
  const arms = n - 1;
  const left = Math.ceil(arms * 0.35);
  const right = Math.ceil(arms * 0.35);
  let rest = arms - left - right;
  const north = Math.ceil(rest / 2);
  const south = rest - north;
  return fourWay(left, right, north, south);
}

function stageOf(L) {
  return {
    width: Math.round(L.feltWidth * 0.97),
    height: Math.round(L.feltHeight),
  };
}

function layoutOf(stage, tileSize, packed) {
  return calculateBoardLayout(packed.board, stage, {
    centerTileId: "3-3",
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
    hudRight: 0,
    hudLeft: 0,
    spinnerId: "3-3",
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

function measure(layout, stage) {
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  const play = computePlayBounds(stage, MARGIN, 0, 0);
  const safe = computeSafeFeltBounds(play);
  const aabb = computeChainBounds(
    boxes.map((t) => ({ id: t.tileId, x: t.x, y: t.y, w: t.w, h: t.h }))
  );
  const safeW = safe.maxX - safe.minX;
  const safeH = safe.maxY - safe.minY;
  const slackW = safeW - aabb.width;
  const slackH = safeH - aabb.height;
  const sample = boxes[0];
  return {
    boxes,
    play,
    safe,
    aabb,
    safeW,
    safeH,
    slackW,
    slackH,
    slackFracW: slackW / safeW,
    slackFracH: slackH / safeH,
    short: Math.min(sample.w, sample.h),
    long: Math.max(sample.w, sample.h),
  };
}

{
  assert.equal(packFirstRunLimit(3000, 223.2, 118.8, 2), 5);
  assert.equal(packFirstRunLimit(1190, 223.2, 118.8, 2), 2);
  assert.equal(packFirstRunLimit(767, 223.2, 118.8, 2), 1);
  assert.equal(packFirstRunLimit(200, 223.2, 118.8, 2), 1);
  assert.equal(packFirstRunLimit(1228, 76, 40, 2), 5);
  assert.ok(packRunLimit(1190, 223.2, 2) >= 2);
  assert.equal(packLaterRunSearchLimit(5, 21), 18);
  assert.equal(packLaterRunSearchLimit(5, 3), 5);
  console.log("✓ packFirstRunLimit is felt-width aware; 5-straight is the ceiling");
}

{
  assert.equal(packSpinnerArmLimit(578, 223.2, 118.8, 2), 2);
  assert.equal(packSpinnerArmLimit(400, 223.2, 118.8, 2), 2);
  assert.equal(packSpinnerArmLimit(179, 107, 57, 2), 1);
  assert.equal(packSpinnerArmLimit(228, 107, 57, 2), 1);
  assert.equal(packSpinnerArmLimit(179, 25, 13, 2), 2);
  console.log("✓ packSpinnerArmLimit keeps 2-straight on tablet felt; 1-fold on short phone felt");
}

{
  const tabletStage = { width: 1151, height: 578 };
  const tabletSize = { w: 118.8, h: 223.2 };
  const tabletPacked = fourWay(2, 2, 2, 2);
  const tabletLayout = layoutOf(tabletStage, tabletSize, tabletPacked);
  const tabletNorth = tabletLayout.armTiles.filter(
    (t) => t.branch === "SPINNER_TOP" || t.branch === "north"
  );
  const tabletSouth = tabletLayout.armTiles.filter(
    (t) => t.branch === "SPINNER_BOTTOM" || t.branch === "south"
  );
  assert.equal(tabletNorth[0].travelDir, "N");
  assert.equal(tabletNorth[1].travelDir, "N", "tablet TOP stays 2-straight");
  assert.equal(tabletSouth[0].travelDir, "S");
  assert.equal(tabletSouth[1].travelDir, "S", "tablet BOTTOM stays 2-straight");

  const phoneStage = { width: 576, height: 179 };
  const phoneSize = { w: 57, h: 107 };
  const phonePacked = fourWay(2, 2, 2, 2);
  const phoneLayout = layoutOf(phoneStage, phoneSize, phonePacked);
  const phoneNorth = phoneLayout.armTiles.filter(
    (t) => t.branch === "SPINNER_TOP" || t.branch === "north"
  );
  const phoneSouth = phoneLayout.armTiles.filter(
    (t) => t.branch === "SPINNER_BOTTOM" || t.branch === "south"
  );
  assert.equal(phoneNorth[0].travelDir, "N");
  assert.equal(phoneNorth[1].travelDir, FIRST_FOLD_TOP, "short felt TOP tile 2 turns RIGHT");
  assert.equal(phoneSouth[0].travelDir, "S");
  assert.equal(phoneSouth[1].travelDir, FIRST_FOLD_BOTTOM, "short felt BOTTOM tile 2 turns LEFT");
  assert.ok(
    phoneLayout.scale > 0.35,
    `A37-like 2N+2S must beat the old 0.23 height-bound column, got ${phoneLayout.scale}`
  );
  const phoneM = measure(phoneLayout, phoneStage);
  assertUtilization(phoneM, phoneLayout.scale, "a37 2N2S");
  console.log("✓ short-felt spinner folds after 1 N/S tile; tablet 2-straight unchanged");
}

function assertUtilization(m, scale, label) {
  if (scale >= 0.97) return;
  assert.ok(
    m.slackFracW < 0.28 || m.slackFracH < 0.28,
    `${label}: scale ${scale.toFixed(3)} shrunk while both axes have slack ` +
      `${(m.slackFracW * 100).toFixed(0)}% × ${(m.slackFracH * 100).toFixed(0)}% ` +
      `(aabb ${m.aabb.width.toFixed(0)}×${m.aabb.height.toFixed(0)} in safe ${m.safeW.toFixed(0)}×${m.safeH.toFixed(0)})`
  );
}

{
  for (const vp of VIEWPORTS) {
    const L = resolveGameplayLayout(vp);
    const stage = stageOf(L);
    const tileSize = resolveBoardTileBase(stage, {
      w: L.playedShort,
      h: L.playedLong,
    });
    for (const n of COUNTS) {
      const packs = {
        bilateral: (() => {
          const s = splitCount(n);
          return fourWay(s.left, s.right, 0, 0);
        })(),
        "folded-spinner": foldedSpinner(n),
      };
      for (const [kind, packed] of Object.entries(packs)) {
        const layout = layoutOf(stage, tileSize, packed);
        const played = packed.board.length + packed.north.length + packed.south.length;
        assert.equal(
          layout.tiles.length + layout.armTiles.length,
          played,
          `${vp.name} ${kind} n=${n} count`
        );
        const m = measure(layout, stage);
        assert.equal(layout.camera?.overflow, false, `${vp.name} ${kind} n=${n} overflow`);
        for (const t of m.boxes) {
          assert.ok(t.x >= m.safe.minX - 0.75, `${vp.name} ${kind} n=${n} ${t.tileId} x`);
          assert.ok(t.y >= m.safe.minY - 0.75, `${vp.name} ${kind} n=${n} ${t.tileId} y`);
          assert.ok(t.x + t.w <= m.safe.maxX + 0.75, `${vp.name} ${kind} n=${n} ${t.tileId} r`);
          assert.ok(t.y + t.h <= m.safe.maxY + 0.75, `${vp.name} ${kind} n=${n} ${t.tileId} b`);
        }
        if (n <= 3) {
          assert.ok(
            layout.scale >= 0.99,
            `${vp.name} ${kind} n=${n} should keep preferred scale, got ${layout.scale}`
          );
        }
        assertUtilization(m, layout.scale, `${vp.name} ${kind} n=${n}`);
        const s3 = layout.armTiles.find((t) => t.tileId === "S3");
        if (s3) {
          assert.equal(
            s3.travelDir,
            FIRST_FOLD_BOTTOM,
            `${vp.name} ${kind} n=${n} south tile 3 still turns LEFT`
          );
        }
      }
    }
  }
  console.log("✓ viewports × counts: real AABB utilization; 28-tile containment; spinner fold dir");
}

{
  const vp = { width: 1280, height: 800 };
  const L = resolveGameplayLayout(vp);
  const stage = stageOf(L);
  const tileSize = {
    w: GAMEPLAY_REF.playedShort,
    h: GAMEPLAY_REF.playedLong,
  };
  const packed = fourWay(4, 4, 0, 0);
  const layout = layoutOf(stage, tileSize, packed);
  const m = measure(layout, stage);
  const step = tileSize.h + CHAIN_GAP;
  const naiveW = tileSize.w + 2 * 4 * step;
  const naiveScale = Math.min(1, m.safeW / naiveW, m.safeH / tileSize.h);
  assert.ok(
    layout.scale > naiveScale + 0.05,
    `tablet 8-tile bilateral must fold instead of 4-straight shrink: ` +
      `got ${layout.scale.toFixed(3)} vs naive ${naiveScale.toFixed(3)}`
  );
  assertUtilization(m, layout.scale, "tablet-1280 8-tile bilateral");

  const longPacked = fourWay(7, 7, 0, 0);
  const longLayout = layoutOf(stage, tileSize, longPacked);
  const longM = measure(longLayout, stage);
  const naiveLongW = tileSize.w + 2 * Math.min(5, 7) * step;
  const naiveLongScale = Math.min(1, longM.safeW / naiveLongW, longM.safeH / tileSize.h);
  assert.ok(
    longLayout.scale > naiveLongScale + 0.08,
    `tablet 14-tile bilateral must use 2D felt instead of a 5-straight shrink: ` +
      `got ${longLayout.scale.toFixed(3)} vs naive ${naiveLongScale.toFixed(3)}`
  );
  assertUtilization(longM, longLayout.scale, "tablet-1280 14-tile bilateral");
  console.log("✓ medium/long bilateral chains fold to use felt instead of a tiny first rail");
}

{
  const packed = fourWay(10, 10, 4, 4);
  for (const vp of VIEWPORTS) {
    const L = resolveGameplayLayout(vp);
    const stage = stageOf(L);
    const tileSize = resolveBoardTileBase(stage, {
      w: L.playedShort,
      h: L.playedLong,
    });
    const layout = layoutOf(stage, tileSize, packed);
    const played = packed.board.length + packed.north.length + packed.south.length;
    assert.equal(layout.tiles.length + layout.armTiles.length, played, `${vp.name} 28-ish count`);
    const m = measure(layout, stage);
    assert.equal(layout.camera?.overflow, false, `${vp.name} 28 overflow`);
    assertUtilization(m, layout.scale, `${vp.name} 28-tile spinner`);
  }
  console.log("✓ 28-tile four-way spinner stays contained and uses felt");
}

{
  // Priority 1: long Classic snake on short/wide felt must use leftover width
  // instead of shrinking to ~13 CSS while half the felt is empty.
  const a37 = { width: 617, height: 181 };
  const L = resolveGameplayLayout({ width: 832, height: 384 });
  const tileSize = resolveBoardTileBase(a37, { w: L.playedShort, h: L.playedLong });
  const packed = fourWay(5, 21, 0, 0);
  const layout = layoutOf(a37, tileSize, packed);
  const m = measure(layout, a37);
  assert.equal(layout.tiles.length, 27, "a37 classic 5/21 count");
  assert.equal(layout.camera?.overflow, false, "a37 classic 5/21 overflow");
  assert.ok(
    m.short >= 18,
    `a37 classic 5/21 short ${m.short.toFixed(1)} must beat the old 13.2 CSS packing`
  );
  assert.ok(
    m.slackFracW < 0.28 || layout.scale >= 0.38,
    `a37 classic 5/21 still wasting width: slack ${(m.slackFracW * 100).toFixed(0)}% scale ${layout.scale.toFixed(3)}`
  );
  console.log(
    `✓ a37 classic 5/21: ${m.short.toFixed(1)}×${m.long.toFixed(1)} scale=${layout.scale.toFixed(3)} slackW=${(m.slackFracW * 100).toFixed(0)}%`
  );

  const tabletL = resolveGameplayLayout({ width: 1280, height: 800 });
  const tabletStage = {
    width: Math.round(tabletL.feltWidth * 0.97),
    height: Math.round(tabletL.feltHeight),
  };
  const tabletSize = resolveBoardTileBase(tabletStage, {
    w: tabletL.playedShort,
    h: tabletL.playedLong,
  });
  const tabletLayout = layoutOf(tabletStage, tabletSize, packed);
  const tabletM = measure(tabletLayout, tabletStage);
  assert.ok(
    tabletM.short >= 53,
    `tablet classic 5/21 must not regress below ~54 CSS, got ${tabletM.short.toFixed(1)}`
  );
  assert.ok(
    tabletLayout.scale + 0.01 >= 0.454,
    `tablet classic 5/21 scale ${tabletLayout.scale.toFixed(3)} must stay ≥ 0.454`
  );
  console.log(
    `✓ tablet classic 5/21 unchanged-or-better: ${tabletM.short.toFixed(1)}×${tabletM.long.toFixed(1)} scale=${tabletLayout.scale.toFixed(3)}`
  );
}

{
  // Priority 2: long Spinner N/S arms on short/wide felt must spend leftover
  // height instead of shrinking to ~14.4 CSS while ~36% of height is empty.
  const a37 = { width: 617, height: 181 };
  const L = resolveGameplayLayout({ width: 832, height: 384 });
  const tileSize = resolveBoardTileBase(a37, { w: L.playedShort, h: L.playedLong });
  const packed = fourWay(2, 2, 11, 11);
  const layout = layoutOf(a37, tileSize, packed);
  const m = measure(layout, a37);
  assert.equal(layout.tiles.length + layout.armTiles.length, 27, "a37 american 2/2/11/11 count");
  assert.equal(layout.camera?.overflow, false, "a37 american 2/2/11/11 overflow");
  assert.ok(
    m.short >= 16,
    `a37 american 2/2/11/11 short ${m.short.toFixed(1)} must beat the old 14.4 CSS packing`
  );
  assert.ok(
    m.slackFracH < 0.12 || layout.scale >= 0.28,
    `a37 american 2/2/11/11 still wasting height: slack ${(m.slackFracH * 100).toFixed(0)}% scale ${layout.scale.toFixed(3)}`
  );
  const north = layout.armTiles.filter(
    (t) => t.branch === "SPINNER_TOP" || t.branch === "north"
  );
  const south = layout.armTiles.filter(
    (t) => t.branch === "SPINNER_BOTTOM" || t.branch === "south"
  );
  assert.equal(north[0].travelDir, "N", "first NORTH tile stays on the spinner face");
  assert.equal(south[0].travelDir, "S", "first SOUTH tile stays on the spinner face");
  console.log(
    `✓ a37 american 2/2/11/11: ${m.short.toFixed(1)}×${m.long.toFixed(1)} scale=${layout.scale.toFixed(3)} slackH=${(m.slackFracH * 100).toFixed(0)}%`
  );

  const tabletL = resolveGameplayLayout({ width: 1280, height: 800 });
  const tabletStage = {
    width: Math.round(tabletL.feltWidth * 0.97),
    height: Math.round(tabletL.feltHeight),
  };
  const tabletSize = resolveBoardTileBase(tabletStage, {
    w: tabletL.playedShort,
    h: tabletL.playedLong,
  });
  const tabletLayout = layoutOf(tabletStage, tabletSize, packed);
  const tabletM = measure(tabletLayout, tabletStage);
  assert.ok(
    tabletM.short + 0.05 >= 34,
    `tablet american 2/2/11/11 must not shrink below 34 CSS, got ${tabletM.short.toFixed(1)}`
  );
  console.log(
    `✓ tablet american 2/2/11/11 unchanged-or-better: ${tabletM.short.toFixed(1)}×${tabletM.long.toFixed(1)} scale=${tabletLayout.scale.toFixed(3)}`
  );
}

console.log("Board utilization layout tests passed.");
