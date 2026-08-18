/**
 * Universal gameplay composition — same relative layout across devices.
 * Run: node src/ui/gameplayLayout.test.js
 */

import assert from "node:assert/strict";
import {
  GAMEPLAY_REF,
  gameplayDensityClass,
  resolveGameplayLayout,
  capPlayedShortPx,
  gameplayLayoutCssVars,
  PLAYER_HAND_SCALE,
  PLAYED_LONG_OF_FELT_H,
  PLAYED_LONG_MAX_OF_FELT_H_SHORT,
  PLAYED_SHORT_MAX_PX,
  PHONE_PLAYED_SIZE_BOOST,
  PHONE_PLAYED_SIZE_SAFE_H,
  PHONE_LANDSCAPE_MAX_H,
} from "./gameplayLayout.js";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  FIRST_FOLD_BOTTOM,
  resolveBoardTileBase,
} from "../board/layoutEngine.js";

const VIEWPORTS = [
  { name: "tablet-1280", width: 1280, height: 800 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "tablet-wide", width: 1366, height: 768 },
  { name: "phone-915", width: 915, height: 412 },
  { name: "phone-844", width: 844, height: 390 },
  { name: "phone-narrow", width: 740, height: 360 },
  { name: "iphone-class", width: 852, height: 393 },
];

const ref = resolveGameplayLayout({
  width: GAMEPLAY_REF.width,
  height: GAMEPLAY_REF.height,
});

assert.ok(Math.abs(ref.uiScale - 1) < 0.02, `ref uiScale ${ref.uiScale}`);
assert.ok(
  Math.abs(ref.playedShort - GAMEPLAY_REF.playedShort) < 3,
  `ref played short ${ref.playedShort}`
);
assert.ok(
  Math.abs(ref.playedLong - GAMEPLAY_REF.playedLong) < 6,
  `ref played long ${ref.playedLong}`
);

const refTileOverFelt = ref.playedLong / ref.feltHeight;
const refChromeOverH = ref.chromeHeight / ref.safeH;
const refHandOverH = ref.handLong / ref.safeH;
const refActionOverH = ref.actionHeight / ref.safeH;

for (const vp of VIEWPORTS) {
  const L = resolveGameplayLayout(vp);
  assert.ok(L.uiScale >= 0.42 && L.uiScale <= 1.12, `${vp.name} scale ${L.uiScale}`);
  assert.ok(L.feltHeight > L.chromeHeight, `${vp.name} felt must dominate`);
  assert.ok(L.feltHeight > L.dockHeight, `${vp.name} felt taller than dock`);
  assert.ok(L.feltWidth === L.safeW, `${vp.name} felt uses full safe width`);
  assert.ok(L.playedLong / L.playedShort > 1.7, `${vp.name} tile aspect`);
  assert.ok(L.handLong >= 36, `${vp.name} hand touch floor`);
  assert.ok(L.actionHeight >= 36, `${vp.name} action touch floor`);

  const tileOverFelt = L.playedLong / L.feltHeight;
  const density = gameplayDensityClass(L);
  if (density === "short") {
    assert.ok(
      tileOverFelt <= PLAYED_LONG_MAX_OF_FELT_H_SHORT + 0.02,
      `${vp.name} phone occupancy ${tileOverFelt.toFixed(3)}`
    );
  } else {
    assert.ok(
      Math.abs(tileOverFelt - refTileOverFelt) < 0.12,
      `${vp.name} played/felt ${tileOverFelt.toFixed(3)} vs ref ${refTileOverFelt.toFixed(3)}`
    );
  }
  const chromeOverH = L.chromeHeight / L.safeH;
  assert.ok(
    Math.abs(chromeOverH - refChromeOverH) < 0.12,
    `${vp.name} chrome/screen ${chromeOverH.toFixed(3)} vs ref ${refChromeOverH.toFixed(3)}`
  );
  const handOverH = L.handLong / L.safeH;
  assert.ok(
    handOverH < 0.14,
    `${vp.name} hand must not dominate screen ${handOverH.toFixed(3)}`
  );
  void refHandOverH;
  void refActionOverH;

  const vars = gameplayLayoutCssVars(L);
  assert.match(vars["--played-tile-w"], /px$/);
  assert.match(vars["--game-chrome-height"], /px$/);
  assert.match(vars["--felt-height"], /px$/);
  assert.ok(
    Math.abs(L.playerHandLong / L.handLong - 1.2) < 0.06,
    `${vp.name} Player 1 hand is ~20% larger (${L.playerHandLong.toFixed(1)} vs ${L.handLong.toFixed(1)})`
  );
  assert.ok(
    L.playerHandLong + 6 <= L.dockHeight + 0.5,
    `${vp.name} scaled hand stays inside the existing dock (${L.playerHandLong} vs dock ${L.dockHeight})`
  );
  assert.ok(
    Math.abs(
      L.chromeHeight + L.chromeFeltGap + L.feltHeight + L.feltDockGap + L.dockHeight - L.safeH
    ) < 1.5,
    `${vp.name} chrome+felt+dock must fill safe height`
  );
  assert.equal(L.handExclusion, 0, `${vp.name} dock is outside felt`);
  if (vp.height <= PHONE_LANDSCAPE_MAX_H) assert.equal(density, "short", `${vp.name} density`);
}

const comparison = VIEWPORTS.map((vp) => {
  const L = resolveGameplayLayout(vp);
  return {
    vp: vp.name,
    played_felt: (L.playedLong / L.feltHeight).toFixed(3),
    felt_h: (L.feltHeight / L.safeH).toFixed(3),
    chrome_h: (L.chromeHeight / L.safeH).toFixed(3),
    hand_h: (L.handLong / L.safeH).toFixed(3),
    action_h: (L.actionHeight / L.safeH).toFixed(3),
    played: `${Math.round(L.playedShort)}×${Math.round(L.playedLong)}`,
  };
});
console.log("Gameplay composition ratios:\n", comparison);

{
  const tablet = resolveGameplayLayout({ width: 1280, height: 800 });
  const phone = resolveGameplayLayout({ width: 844, height: 390 });
  const portrait = resolveGameplayLayout({ width: 800, height: 1280 });
  assert.equal(PLAYER_HAND_SCALE, 1.2);
  for (const [name, L] of [
    ["tablet", tablet],
    ["phone", phone],
  ]) {
    assert.ok(
      Math.abs(L.playerHandLong / L.handLong - PLAYER_HAND_SCALE) < 0.08,
      `${name} player hand scale ${L.playerHandLong / L.handLong}`
    );
    const row = 7 * L.playerHandShort + 6 * (L.playerHandGap + L.playerHandOverlap);
    assert.ok(row <= L.handBudget + 1, `${name} 7-tile row ${row} vs budget ${L.handBudget}`);
    assert.ok(L.playerHandOverlap >= -8, `${name} overlap is controlled`);
  }
  assert.equal(portrait.orientation, "portrait");
  assert.ok(
    portrait.playerHandLong >= portrait.handLong,
    `portrait hand stays at least as large as the chrome tile (${portrait.playerHandLong} vs ${portrait.handLong})`
  );
  assert.ok(portrait.playerHandShort >= 26, "portrait hand remains touchable");
  assert.equal(portrait.playerHandOverlap, 0, "portrait uses scroll instead of overlap");
  const vars = gameplayLayoutCssVars(tablet);
  assert.match(vars["--player-hand-h"], /px$/);
  assert.match(vars["--player-hand-gap"], /px$/);

  const tabRel = tablet.playedLong / tablet.feltHeight;
  const phoneRel = phone.playedLong / phone.feltHeight;
  assert.ok(
    phoneRel < PLAYED_LONG_MAX_OF_FELT_H_SHORT + 0.02,
    `phone tiles must stay inside the short occupancy ceiling (${phoneRel.toFixed(3)})`
  );
  assert.ok(
    Math.abs(tabRel - PLAYED_LONG_OF_FELT_H) < 0.02,
    `tablet occupancy tracks the reference felt (${tabRel.toFixed(3)})`
  );
  assert.ok(
    phone.playedLong < tablet.playedLong * 0.75,
    `phone absolute played size must shrink with the canvas (${phone.playedLong} vs ${tablet.playedLong})`
  );
  assert.ok(
    Math.abs(tablet.playedShort - GAMEPLAY_REF.playedShort) < 3,
    `tablet preferred short stays on the reference (${tablet.playedShort} vs ${GAMEPLAY_REF.playedShort})`
  );
  assert.ok(
    Math.abs(tablet.playedLong - GAMEPLAY_REF.playedLong) < 6,
    `tablet preferred long stays on the reference (${tablet.playedLong} vs ${GAMEPLAY_REF.playedLong})`
  );
  const phoneHeightScale = Math.min(
    1.12,
    Math.max(0.42, phone.safeH / GAMEPLAY_REF.height)
  );
  const phoneUnboosted = GAMEPLAY_REF.playedLong * phoneHeightScale;
  assert.ok(
    Math.abs(phone.playedLong / phoneUnboosted - PHONE_PLAYED_SIZE_BOOST) < 0.04,
    `phone preferred is +15% vs the shared formula (${phone.playedLong.toFixed(1)} vs unboosted ${phoneUnboosted.toFixed(1)})`
  );

  const androidPhone = resolveGameplayLayout({ width: 915, height: 412 });
  const tallPhone = resolveGameplayLayout({ width: 876, height: 440 });
  assert.equal(PHONE_PLAYED_SIZE_SAFE_H, 412);
  assert.ok(
    Math.abs(tallPhone.playedShort - androidPhone.playedShort) < 0.6,
    `taller phone safes keep the approved phone preferred size (${tallPhone.playedShort.toFixed(1)} vs ${androidPhone.playedShort.toFixed(1)})`
  );
  assert.ok(
    Math.abs(phone.playedShort - 66.6) < 1.2,
    `390-class phone preferred stays ${phone.playedShort.toFixed(1)}`
  );
}

{
  const tablet = resolveGameplayLayout({ width: 1280, height: 800 });
  const cap = capPlayedShortPx({
    width: 1151,
    height: tablet.feltHeight,
    hudBottom: 0,
  });
  assert.ok(
    cap >= 108 && cap <= PLAYED_SHORT_MAX_PX + 0.5,
    `tablet cap ${cap}`
  );
  const phone = resolveGameplayLayout({ width: 844, height: 390 });
  const phoneCap = capPlayedShortPx({
    width: Math.round(phone.feltWidth * 0.97),
    height: phone.feltHeight,
    hudBottom: 0,
  });
  assert.ok(phoneCap < cap - 10, `phone cap ${phoneCap} must be below tablet ${cap}`);
}

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

{
  const phone = resolveGameplayLayout({ width: 844, height: 390 });
  const stage = {
    width: Math.round(phone.feltWidth * 0.97),
    height: Math.round(phone.feltHeight),
  };
  const hudBottom = 0;
  const size = {
    w: phone.playedShort,
    h: phone.playedLong,
  };
  const board = [
    tile("L1", 5, 3),
    dbl("3-3", 3),
    tile("R1", 3, 1),
  ];
  const south = [tile("S1", 3, 0)];
  const layout = calculateBoardLayout(board, stage, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    hudLeft: 0,
    hudBottom,
    spinnerNorth: [],
    spinnerSouth: south,
  });
  assert.equal(layout.armTiles.length, 1);
  assert.ok(layout.scale <= 1, `phone 1-south scale=${layout.scale}`);
  const play = computePlayBounds(stage, 14, 0, 0, hudBottom);
  const safe = computeSafeFeltBounds(play);
  for (const t of [...layout.tiles, ...layout.armTiles]) {
    assert.ok(t.y + t.h <= safe.maxY + 0.75, `phone ${t.tileId} in exclusion`);
    assert.ok(t.x >= safe.minX - 0.75, `phone ${t.tileId} in felt x`);
  }

  const south3 = [
    tile("S1", 3, 0),
    tile("S2", 0, 5),
    tile("S3", 5, 2),
  ];
  const turn = calculateBoardLayout(board, stage, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    hudLeft: 0,
    hudBottom,
    spinnerNorth: [],
    spinnerSouth: south3,
  });
  const s3 = turn.armTiles.find((t) => t.tileId === "S3");
  assert.equal(s3.travelDir, FIRST_FOLD_BOTTOM);
  const south2 = [tile("S1", 3, 0), tile("S2", 0, 5)];
  const two = calculateBoardLayout(board, stage, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    hudLeft: 0,
    hudBottom,
    spinnerNorth: [],
    spinnerSouth: south2,
  });
  for (const t of [...two.tiles, ...two.armTiles]) {
    assert.ok(t.y + t.h <= safe.maxY + 0.75, `phone 2-south ${t.tileId} in exclusion`);
  }
  assert.equal(two.tiles.length + two.armTiles.length, board.length + 2);

  const longSouth = [
    tile("S1", 3, 0),
    tile("S2", 0, 5),
    tile("S3", 5, 2),
    tile("S4", 2, 6),
    tile("S5", 6, 1),
  ];
  const long = calculateBoardLayout(board, stage, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: size.w,
    tileHeight: size.h,
    hudRight: 0,
    hudLeft: 0,
    hudBottom,
    spinnerNorth: [],
    spinnerSouth: longSouth,
  });
  assert.equal(long.armTiles.length, 5, "long chain must keep every tile");
  assert.ok(long.scale < two.scale || long.scale <= 1);
  for (const t of [...long.tiles, ...long.armTiles]) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
    assert.ok(t.y + t.h <= safe.maxY + 0.75);
  }
}

{
  const measured = { w: 134, h: 254 };
  const laptop = resolveBoardTileBase({ width: 1180, height: 520 }, measured);
  assert.ok(laptop.w <= PLAYED_SHORT_MAX_PX, `oversized CSS cap ${laptop.w}`);
  const phoneLayout = resolveGameplayLayout({ width: 844, height: 390 });
  const tabletLayout = resolveGameplayLayout({ width: 1280, height: 800 });
  const phone = resolveBoardTileBase(
    { width: 800, height: phoneLayout.feltHeight, hudBottom: 0 },
    { w: GAMEPLAY_REF.playedShort, h: GAMEPLAY_REF.playedLong }
  );
  const tablet = resolveBoardTileBase(
    { width: 1151, height: tabletLayout.feltHeight, hudBottom: 0 },
    { w: GAMEPLAY_REF.playedShort, h: GAMEPLAY_REF.playedLong }
  );
  assert.ok(
    phone.w < tablet.w - 8,
    `phone preferred short ${phone.w} must be below tablet ${tablet.w}`
  );
}

{
  const phone = { width: 832, height: 384 };
  const tablet = { width: 1280, height: 800 };
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const classic4 = { playerCount: 4, rulesetId: "legacy" };
  const base = resolveGameplayLayout(phone);
  const grown = resolveGameplayLayout(phone, am4);
  const classic = resolveGameplayLayout(phone, classic4);
  assert.equal(grown.feltBottom, base.feltBottom);
  assert.equal(grown.handTop, base.handTop);
  assert.ok(grown.feltTop < base.feltTop - 8);
  assert.ok(grown.feltHeight > base.feltHeight + 8);
  assert.equal(classic.feltTop, grown.feltTop, "Classic 4p phone matches American hug");
  assert.equal(classic.feltBottom, grown.feltBottom);
  assert.equal(classic.handTop, grown.handTop);
  const tabBase = resolveGameplayLayout(tablet);
  const tabAm4 = resolveGameplayLayout(tablet, am4);
  const tabClassic4 = resolveGameplayLayout(tablet, classic4);
  assert.equal(tabAm4.feltHeight, tabBase.feltHeight);
  assert.equal(tabAm4.feltTop, tabBase.feltTop);
  assert.equal(tabClassic4.feltHeight, tabBase.feltHeight);
  assert.equal(tabClassic4.feltTop, tabBase.feltTop);

  const classic2 = { playerCount: 2, rulesetId: "legacy" };
  const classic2Phone = resolveGameplayLayout(phone, classic2);
  assert.equal(classic2Phone.feltTop, grown.feltTop, "Classic 2p phone uses the Rival 1 upward hug");
  assert.equal(classic2Phone.feltBottom, base.feltBottom, "Classic 2p phone table bottom stays put");
  assert.equal(classic2Phone.handTop, base.handTop, "Classic 2p phone Player 1 hand stays put");
  assert.equal(classic2Phone.dockTop, base.dockTop, "Classic 2p phone dock stays put");
  assert.equal(classic2Phone.playedShort, base.playedShort, "Classic 2p phone tile short unchanged");
  assert.equal(classic2Phone.playedLong, base.playedLong, "Classic 2p phone tile long unchanged");
  const classic2Tablet = resolveGameplayLayout(tablet, classic2);
  assert.equal(classic2Tablet.feltTop, tabBase.feltTop, "Classic 2p tablet felt top unchanged");
  assert.equal(classic2Tablet.feltBottom, tabBase.feltBottom, "Classic 2p tablet table bottom unchanged");
  assert.equal(classic2Tablet.handTop, tabBase.handTop, "Classic 2p tablet hand unchanged");

  const classic3 = { playerCount: 3, rulesetId: "legacy" };
  const classic3Phone = resolveGameplayLayout(phone, classic3);
  assert.equal(classic3Phone.feltTop, grown.feltTop, "Classic 3p phone uses the Rival 1 upward hug");
  assert.equal(classic3Phone.chromeFeltGap, grown.chromeFeltGap, "Classic 3p phone keeps the 2px frame gap");
  assert.equal(classic3Phone.feltBottom, base.feltBottom, "Classic 3p phone table bottom stays put");
  assert.equal(classic3Phone.handTop, base.handTop, "Classic 3p phone Player 1 hand stays put");
  assert.equal(classic3Phone.dockTop, base.dockTop, "Classic 3p phone dock stays put");
  assert.equal(classic3Phone.feltWidth, base.feltWidth, "Classic 3p phone table width unchanged");
  assert.equal(classic3Phone.playedShort, base.playedShort, "Classic 3p phone tile short unchanged");
  assert.equal(classic3Phone.playedLong, base.playedLong, "Classic 3p phone tile long unchanged");
  const classic3Tablet = resolveGameplayLayout(tablet, classic3);
  assert.equal(classic3Tablet.feltTop, tabBase.feltTop, "Classic 3p tablet felt top unchanged");
  assert.equal(classic3Tablet.feltBottom, tabBase.feltBottom, "Classic 3p tablet table bottom unchanged");
  assert.equal(classic3Tablet.handTop, tabBase.handTop, "Classic 3p tablet hand unchanged");

  const others = [
    { playerCount: 2, rulesetId: "allFives" },
    { playerCount: 2, rulesetId: "american" },
    { playerCount: 2, rulesetId: "haitian" },
    { playerCount: 2, rulesetId: "dominican" },
    { playerCount: 2, rulesetId: "puertorican" },
    { playerCount: 3, rulesetId: "allFives" },
    { playerCount: 3, rulesetId: "haitian" },
  ];
  for (const opts of others) {
    const L = resolveGameplayLayout(phone, opts);
    assert.equal(
      L.feltTop,
      base.feltTop,
      `${opts.rulesetId} ${opts.playerCount}p phone felt top stays on the shared chrome`
    );
    assert.equal(L.feltBottom, base.feltBottom, `${opts.rulesetId} ${opts.playerCount}p bottom stays put`);
    assert.equal(L.handTop, base.handTop, `${opts.rulesetId} ${opts.playerCount}p hand stays put`);
  }
}

console.log("Gameplay layout composition tests passed.");
