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

{
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const a37 = resolveGameplayLayout({ width: 832, height: 384 }, am4);
  const tall = resolveGameplayLayout({ width: 876, height: 440 }, am4);
  const android412 = resolveGameplayLayout({ width: 915, height: 412 }, am4);
  assert.ok(
    Math.abs(tall.playedShort - android412.playedShort) < 0.6,
    `tall-phone preferred must match the approved phone band (${tall.playedShort.toFixed(1)} vs ${android412.playedShort.toFixed(1)})`
  );
  assert.ok(
    Math.abs(a37.playedShort - 65.6) < 0.6,
    `A37 preferred short stays ${a37.playedShort.toFixed(1)}`
  );
  const a37Stage = {
    width: Math.max(220, Math.round(a37.feltWidth - 154)),
    height: Math.round(a37.feltHeight),
  };
  const tallStage = {
    width: Math.max(220, Math.round(tall.feltWidth - 154)),
    height: Math.round(tall.feltHeight),
  };
  const a37Size = resolveBoardTileBase(a37Stage, {
    w: a37.playedShort,
    h: a37.playedLong,
  });
  const tallSize = resolveBoardTileBase(tallStage, {
    w: tall.playedShort,
    h: tall.playedLong,
  });
  const a37n10 = layoutOf(a37Stage, a37Size, foldedSpinner(10));
  const talln5 = layoutOf(tallStage, tallSize, foldedSpinner(5));
  const talln10 = layoutOf(tallStage, tallSize, foldedSpinner(10));
  const a37n10m = measure(a37n10, a37Stage);
  const talln5m = measure(talln5, tallStage);
  const talln10m = measure(talln10, tallStage);
  assert.ok(talln5.scale >= 0.99, `tall-phone n=5 keeps preferred, got ${talln5.scale}`);
  assert.ok(
    Math.abs(talln5m.short - a37Size.w) < 8 || Math.abs(talln5m.short - a37n10m.short) < 24,
    `tall-phone short-chain size stays in the Android phone band (${talln5m.short.toFixed(1)})`
  );
  assert.ok(
    talln10.scale + 0.02 >= a37n10.scale,
    `tall-phone must not shrink earlier than A37 (${talln10.scale.toFixed(3)} vs ${a37n10.scale.toFixed(3)})`
  );
  if (talln10.scale < 0.97) {
    assert.ok(
      talln10m.slackFracW < 0.28 || talln10m.slackFracH < 0.28,
      `tall-phone n=10 must use leftover felt before shrinking (${(talln10m.slackFracW * 100).toFixed(0)}% × ${(talln10m.slackFracH * 100).toFixed(0)}%)`
    );
  }
  assert.equal(a37n10.camera?.overflow, false);
  assert.equal(talln10.camera?.overflow, false);
  console.log(
    `✓ tall-phone vs A37 preferred ${tall.playedShort.toFixed(1)}×${tall.playedLong.toFixed(1)} vs ${a37.playedShort.toFixed(1)}×${a37.playedLong.toFixed(1)}; n10 scale ${talln10.scale.toFixed(3)} vs ${a37n10.scale.toFixed(3)}`
  );
}

{
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const iphone = resolveGameplayLayout({ width: 876, height: 440 }, am4);
  const a37 = resolveGameplayLayout({ width: 832, height: 384 }, am4);
  const tablet = resolveGameplayLayout({ width: 1340, height: 800 }, am4);
  const iphoneStage = {
    width: Math.max(220, Math.round(iphone.feltWidth - 154)),
    height: Math.round(iphone.feltHeight),
  };
  const a37Stage = {
    width: Math.max(220, Math.round(a37.feltWidth - 154)),
    height: Math.round(a37.feltHeight),
  };
  const tabletStage = {
    width: Math.max(220, Math.round(tablet.feltWidth - 154)),
    height: Math.round(tablet.feltHeight),
  };
  const packed23 = fourWay(14, 4, 2, 2);
  const layoutOfSize = (stage, L) => {
    const size = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
    return { layout: layoutOf(stage, size, packed23), size, stage };
  };
  const iphone23 = layoutOfSize(iphoneStage, iphone);
  const a37_23 = layoutOfSize(a37Stage, a37);
  const tablet23 = layoutOfSize(tabletStage, tablet);
  const iphoneM = measure(iphone23.layout, iphoneStage);
  const a37M = measure(a37_23.layout, a37Stage);
  const tabletM = measure(tablet23.layout, tabletStage);
  assert.equal(iphone23.layout.tiles.length + iphone23.layout.armTiles.length, 23);
  assert.equal(iphone23.layout.camera?.overflow, false);
  assert.ok(
    iphone23.layout.scale > 0.47,
    `23-tile American long-left must beat the old 0.407 height-bound shrink, got ${iphone23.layout.scale.toFixed(3)}`
  );
  assert.ok(
    iphoneM.short > 33,
    `23-tile American actual short must beat 28.7 CSS, got ${iphoneM.short.toFixed(1)}`
  );
  const rightDirs = iphone23.layout.tiles
    .filter((t) => String(t.tileId).startsWith("R"))
    .map((t) => t.travelDir)
    .join("");
  assert.ok(
    rightDirs.includes("S") || rightDirs.includes("N"),
    `23-tile long-left must fold the short right arm before shrinking, got ${rightDirs}`
  );
  if (iphone23.layout.scale < 0.97) {
    assert.ok(
      iphoneM.slackFracW < 0.22 || iphoneM.slackFracH < 0.22,
      `23-tile American must spend leftover felt before shrinking (${(iphoneM.slackFracW * 100).toFixed(0)}% × ${(iphoneM.slackFracH * 100).toFixed(0)}%)`
    );
  }
  assert.equal(a37_23.layout.camera?.overflow, false);
  assert.ok(
    a37M.short + 0.05 >= 22.3,
    `A37 23-tile American must not regress below the prior 22.3 CSS, got ${a37M.short.toFixed(1)}`
  );
  assert.equal(tablet23.layout.camera?.overflow, false);
  assert.ok(
    tabletM.short + 0.05 >= 40,
    `Tab A9+ 23-tile American must stay comfortably large, got ${tabletM.short.toFixed(1)}`
  );
  console.log(
    `✓ 23-tile American 14/4/2/2: iphone ${iphoneM.short.toFixed(1)}×${iphoneM.long.toFixed(1)} @${iphone23.layout.scale.toFixed(3)} ` +
      `a37 ${a37M.short.toFixed(1)} @${a37_23.layout.scale.toFixed(3)} ` +
      `tablet ${tabletM.short.toFixed(1)} @${tablet23.layout.scale.toFixed(3)}`
  );
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function neighborsJoin(a, b) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  if (xOv && yOv) return false;
  return xOv || yOv;
}

function assertLongBoard(layout, packed, stage, tileSize, label) {
  const played = packed.board.length + packed.north.length + packed.south.length;
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  assert.equal(boxes.length, played, `${label} count`);
  assert.equal(layout.camera?.overflow, false, `${label} overflow`);
  const m = measure(layout, stage);
  for (const t of boxes) {
    assert.ok(t.x >= m.safe.minX - 0.75, `${label} ${t.tileId} x`);
    assert.ok(t.y >= m.safe.minY - 0.75, `${label} ${t.tileId} y`);
    assert.ok(t.x + t.w <= m.safe.maxX + 0.75, `${label} ${t.tileId} r`);
    assert.ok(t.y + t.h <= m.safe.maxY + 0.75, `${label} ${t.tileId} b`);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!boxesOverlap(boxes[i], boxes[j]), `${label} overlap ${boxes[i].tileId}/${boxes[j].tileId}`);
    }
  }
  const byId = Object.fromEntries(boxes.map((t) => [t.tileId, t]));
  const links = [];
  for (let i = 0; i < packed.board.length - 1; i += 1) {
    links.push([packed.board[i].id, packed.board[i + 1].id]);
  }
  if (packed.north[0]) links.push(["3-3", packed.north[0].id]);
  for (let i = 0; i < packed.north.length - 1; i += 1) {
    links.push([packed.north[i].id, packed.north[i + 1].id]);
  }
  if (packed.south[0]) links.push(["3-3", packed.south[0].id]);
  for (let i = 0; i < packed.south.length - 1; i += 1) {
    links.push([packed.south[i].id, packed.south[i + 1].id]);
  }
  for (const [aId, bId] of links) {
    const a = byId[aId];
    const b = byId[bId];
    assert.ok(a && b, `${label} missing ${aId}/${bId}`);
    assert.ok(neighborsJoin(a, b), `${label} fake/disconnected ${aId}→${bId}`);
  }
  if (layout.scale < 0.97) {
    assert.ok(
      m.slackFracW < 0.16 || m.slackFracH < 0.10,
      `${label}: shrunk while leaving unused felt ` +
        `${(m.slackFracW * 100).toFixed(0)}% × ${(m.slackFracH * 100).toFixed(0)}% ` +
        `(aabb ${m.aabb.width.toFixed(0)}×${m.aabb.height.toFixed(0)} in safe ${m.safeW.toFixed(0)}×${m.safeH.toFixed(0)})`
    );
    assert.ok(
      Math.max(1 - m.slackFracW, 1 - m.slackFracH) >= 0.9,
      `${label}: must occupy ≥90% of one felt axis, got ` +
        `${((1 - m.slackFracW) * 100).toFixed(0)}% × ${((1 - m.slackFracH) * 100).toFixed(0)}%`
    );
  }
  assert.ok(
    m.short <= tileSize.w + 0.5,
    `${label} must not exceed preferred short ${tileSize.w.toFixed(1)}, got ${m.short.toFixed(1)}`
  );
  return m;
}

{
  const splitOf = (n) => {
    const s = splitCount(n);
    return fourWay(s.left, s.right, 0, 0);
  };
  const stages = [
    {
      name: "iphone-classic-2",
      vp: { width: 876, height: 440 },
      opt: { playerCount: 2, rulesetId: "legacy" },
      inset: false,
    },
    {
      name: "iphone-american-4",
      vp: { width: 876, height: 440 },
      opt: { playerCount: 4, rulesetId: "allFives" },
      inset: true,
    },
    {
      name: "a37-american-4",
      vp: { width: 832, height: 384 },
      opt: { playerCount: 4, rulesetId: "allFives" },
      inset: true,
    },
    {
      name: "tablet-american-4",
      vp: { width: 1340, height: 800 },
      opt: { playerCount: 4, rulesetId: "allFives" },
      inset: true,
    },
  ];
  const longCounts = [20, 23, 25, 27];
  for (const spec of stages) {
    const L = resolveGameplayLayout(spec.vp, spec.opt);
    const stage = {
      width: spec.inset
        ? Math.max(220, Math.round(L.feltWidth - 154))
        : Math.round(L.feltWidth),
      height: Math.round(L.feltHeight),
    };
    const tileSize = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
    for (const n of longCounts) {
      for (const [kind, packed] of [
        ["bilateral", splitOf(n)],
        ["spinner", foldedSpinner(n)],
      ]) {
        const layout = layoutOf(stage, tileSize, packed);
        const m = assertLongBoard(layout, packed, stage, tileSize, `${spec.name} ${kind} n=${n}`);
        if (n === 25 && spec.name === "iphone-classic-2" && kind === "bilateral") {
          assert.ok(
            layout.scale + 0.001 >= 0.54,
            `25-tile Classic 2p scale ${layout.scale.toFixed(3)} must stay readable`
          );
          assert.ok(m.short + 0.05 >= 38, `25-tile Classic 2p short ${m.short.toFixed(1)}`);
          console.log(
            `25-tile Classic 2p phone: felt ${stage.width}×${stage.height} ` +
              `safe ${m.safeW.toFixed(0)}×${m.safeH.toFixed(0)} ` +
              `aabb ${m.aabb.width.toFixed(1)}×${m.aabb.height.toFixed(1)} ` +
              `util ${((1 - m.slackFracW) * 100).toFixed(0)}%×${((1 - m.slackFracH) * 100).toFixed(0)}% ` +
              `tile ${m.short.toFixed(1)}×${m.long.toFixed(1)} (preferred ${tileSize.w.toFixed(1)}×${tileSize.h.toFixed(1)}) ` +
              `scale ${layout.scale.toFixed(3)} (preferred 1.000)`
          );
        }
        if (n === 25 && spec.name === "iphone-american-4" && kind === "spinner") {
          assert.ok(
            layout.scale > 0.47,
            `25-tile American 4p must beat the old 0.407 shrink, got ${layout.scale.toFixed(3)}`
          );
          assert.ok(m.short > 33, `25-tile American 4p short ${m.short.toFixed(1)} must beat 28.7`);
          console.log(
            `25-tile American 4p phone: felt ${stage.width}×${stage.height} ` +
              `safe ${m.safeW.toFixed(0)}×${m.safeH.toFixed(0)} ` +
              `aabb ${m.aabb.width.toFixed(1)}×${m.aabb.height.toFixed(1)} ` +
              `util ${((1 - m.slackFracW) * 100).toFixed(0)}%×${((1 - m.slackFracH) * 100).toFixed(0)}% ` +
              `tile ${m.short.toFixed(1)}×${m.long.toFixed(1)} (preferred ${tileSize.w.toFixed(1)}×${tileSize.h.toFixed(1)}) ` +
              `scale ${layout.scale.toFixed(3)} (preferred 1.000)`
          );
        }
        if (n === 20 && spec.name === "iphone-classic-2" && kind === "bilateral") {
          assert.ok(
            layout.scale + 0.001 >= 0.54,
            `20-tile Classic 2p scale ${layout.scale.toFixed(3)} must stay readable`
          );
        }
        if (n === 25 && spec.name === "tablet-american-4" && kind === "bilateral") {
          assert.ok(
            m.short + 0.05 >= 75,
            `tablet 25-tile must not regress, got ${m.short.toFixed(1)}`
          );
        }
      }
    }
    const packed28 = fourWay(10, 10, 4, 3);
    const layout28 = layoutOf(stage, tileSize, packed28);
    assertLongBoard(layout28, packed28, stage, tileSize, `${spec.name} spinner n=28`);
  }
  console.log("✓ 20/23/25/27–28 long boards: contained, connected, felt-filling, no premature shrink");
}

{
  const rulesets = [
    { id: "legacy", counts: [2, 3, 4] },
    { id: "allFives", counts: [2, 3, 4] },
    { id: "american", counts: [2, 3, 4] },
    { id: "haitian", counts: [2, 4] },
    { id: "dominican", counts: [4] },
    { id: "puertorican", counts: [4] },
  ];
  const packed = fourWay(12, 12, 0, 0);
  const vp = { width: 876, height: 440 };
  for (const ruleset of rulesets) {
    for (const playerCount of ruleset.counts) {
      const L = resolveGameplayLayout(vp, { playerCount, rulesetId: ruleset.id });
      const inset = playerCount >= 3;
      const stage = {
        width: inset
          ? Math.max(220, Math.round(L.feltWidth - 154))
          : Math.round(L.feltWidth),
        height: Math.round(L.feltHeight),
      };
      const tileSize = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
      const layout = layoutOf(stage, tileSize, packed);
      const label = `${ruleset.id} ${playerCount}p 25`;
      const m = assertLongBoard(layout, packed, stage, tileSize, label);
      assert.ok(
        layout.scale + 0.001 >= 0.49,
        `${label} scale ${layout.scale.toFixed(3)} must stay readable on phone felt`
      );
      assert.ok(m.short + 0.05 >= 34, `${label} short ${m.short.toFixed(1)}`);
    }
  }
  console.log("✓ 25-tile phone packing holds across Classic/American/Haitian/Dominican/Puerto Rican");
}

console.log("Board utilization layout tests passed.");
