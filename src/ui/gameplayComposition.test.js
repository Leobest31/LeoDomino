/**
 * Gameplay composition contract — exclusive felt, no HUD/hand overlap.
 * Run: node src/ui/gameplayComposition.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAMEPLAY_REF,
  COMPOSITION_GAP_PX,
  FELT_HAND_GAP_MIN_PX,
  FELT_HAND_GAP_MAX_PX,
  AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX,
  PLAYED_PREFERRED_SCALE,
  PHONE_PLAYED_SIZE_BOOST,
  gameplayComposition,
  rectsOverlap,
  resolveGameplayLayout,
} from "./gameplayLayout.js";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  packRunLimit,
  resolveBoardTileBase,
  FIRST_FOLD_BOTTOM,
} from "../board/layoutEngine.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

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

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function longSpinner() {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= 5; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= 5; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return {
    board,
    north: [tile("N1", 3, 6), tile("N2", 6, 1), tile("N3", 1, 4)],
    south: [tile("S1", 3, 0), tile("S2", 0, 5), tile("S3", 5, 2), tile("S4", 2, 6)],
  };
}

{
  const page = read("pages/GamePage.jsx");
  const css = read("pages/GamePage.css");
  const bottom = read("components/BottomBar.jsx");
  const bottomCss = read("components/BottomBar.css");
  const headerCss = read("components/Header.css");
  assert.match(page, /game-page__dock/, "dock remains");
  assert.match(page, /<BottomBar[\s\S]*<PlayerPanel/, "hand lives in the bottom dock");
  assert.doesNotMatch(
    css,
    /grid-area:\s*1\s*\/\s*1[\s\S]*game-page__dock/,
    "dock must not overlay the felt grid"
  );
  assert.match(css, /flex: 0 0 auto/, "dock is a real row");
  assert.match(css, /--game-felt-dock-gap/, "felt-dock gap is its own CSS var");
  assert.doesNotMatch(
    css,
    /\.game-page__shell \{[^}]*gap:\s*var\(--game-region-gap/,
    "shell must not use one region gap for both chrome-felt and felt-dock"
  );
  assert.match(bottom, /bottom-bar__center/, "Pase | hand | New Match");
  assert.match(bottomCss, /grid-template-columns/, "dock is three columns");
  assert.match(headerCss, /justify-content:\s*flex-start/, "Meni Prensipal attaches under the tool row");
  assert.doesNotMatch(
    headerCss,
    /\.header--stacked \.header__menu-btn\s*\{[^}]*margin-top:\s*auto/,
    "Meni Prensipal is not stretched to the felt edge"
  );
  const scoreCss = read("components/ScoreBoard.css");
  const scoreJsx = read("components/ScoreBoard.jsx");
  assert.match(scoreCss, /flex-direction:\s*row/, "score HUD is a single horizontal strip");
  assert.match(scoreJsx, /scoreboard--inline/, "scoreboard uses the inline HUD class");
  assert.doesNotMatch(bottom, /t\("game\.play"\)/, "Jwe stays gone");
  assert.doesNotMatch(bottom, /t\("game\.draw"\)/, "Tire stays gone");
  assert.match(page, /playerCount: state\.players\.length/, "layout receives live player count");
  assert.match(page, /rulesetId: state\.rulesetId/, "layout receives live ruleset");
  assert.match(
    css,
    /game-page--players-4\[data-layout-density="short"\]\[data-ruleset="allFives"\]/,
    "American 4-player phone chrome hugs Rival 1"
  );
}

const results = [];

for (const vp of VIEWPORTS) {
  const L = resolveGameplayLayout(vp);
  const C = gameplayComposition(L);
  const label = vp.name;

  assert.ok(
    Math.abs(L.chromeHeight + L.chromeFeltGap + L.feltHeight + L.feltDockGap + L.dockHeight - L.safeH) < 1.5,
    `${label} chrome+gaps+felt+dock must fill safe height`
  );
  assert.ok(L.feltHeight > L.chromeHeight, `${label} felt dominates chrome`);
  assert.ok(L.feltHeight > L.dockHeight, `${label} felt dominates dock`);
  assert.equal(L.handExclusion, 0, `${label} board playable bounds exclude the dock by geometry`);

  assert.ok(C.score.bottom <= C.felt.top + 0.01, `${label} scoreBottom <= feltTop`);
  assert.ok(C.score.top >= 0, `${label} score is not clipped by the top safe edge`);
  assert.ok(!rectsOverlap(C.score, C.felt, 0.5), `${label} score must not intersect felt`);
  assert.ok(C.score.right <= L.safeW * 0.5, `${label} score stays on the left`);

  assert.ok(C.menu.bottom <= C.felt.top + 0.01, `${label} menuBottom <= feltTop`);
  assert.ok(C.menu.top >= 0, `${label} menu is not clipped by the top safe edge`);
  assert.ok(
    C.menu.top <= L.headerHeight + 8,
    `${label} menu attaches under the tool row (top ${C.menu.top} vs tools ${L.headerHeight})`
  );
  assert.ok(!rectsOverlap(C.menu, C.felt, 0.5), `${label} menu must not intersect felt`);
  assert.ok(!rectsOverlap(C.score, C.menu, 0.5), `${label} score vs menu`);
  assert.ok(C.menu.left > L.safeW * 0.5, `${label} menu stays on the right`);

  assert.ok(C.felt.bottom <= C.hand.top + 0.01, `${label} feltBottom <= handTop`);
  const feltHandGap = C.hand.top - C.felt.bottom;
  assert.ok(
    feltHandGap >= FELT_HAND_GAP_MIN_PX - 0.5 &&
      feltHandGap <= FELT_HAND_GAP_MAX_PX + 0.5,
    `${label} felt-to-hand gap ${feltHandGap.toFixed(1)}px must stay ${FELT_HAND_GAP_MIN_PX}–${FELT_HAND_GAP_MAX_PX}`
  );
  assert.ok(!rectsOverlap(C.felt, C.hand, 0.5), `${label} no hand tile may intersect felt`);
  assert.ok(!rectsOverlap(C.felt, C.pass, 0.5), `${label} Pase stays outside felt`);
  assert.ok(!rectsOverlap(C.felt, C.newMatch, 0.5), `${label} New Match stays outside felt`);

  assert.ok(C.pass.left <= 1, `${label} Pase is bottom-left`);
  assert.ok(C.newMatch.right >= L.safeW - 1, `${label} New Match is bottom-right`);
  assert.ok(
    C.hand.left >= C.pass.right + COMPOSITION_GAP_PX - 0.5,
    `${label} handLeft >= PaseRight + gap`
  );
  assert.ok(
    C.hand.right <= C.newMatch.left - COMPOSITION_GAP_PX + 0.5,
    `${label} handRight <= NewMatchLeft - gap`
  );
  assert.ok(!rectsOverlap(C.hand, C.pass, 0.5), `${label} hand vs Pase`);
  assert.ok(!rectsOverlap(C.hand, C.newMatch, 0.5), `${label} hand vs New Match`);

  const stage = {
    width: Math.round(L.feltWidth * 0.97),
    height: Math.round(L.feltHeight),
  };
  const play = computePlayBounds(stage, 14, 0, 0, L.handExclusion);
  const safe = computeSafeFeltBounds(play);
  assert.ok(
    play.maxY >= stage.height - 14 - 1,
    `${label} playable bottom is the felt, not a hand overlay (${play.maxY} vs ${stage.height})`
  );
  assert.ok(play.hudBottom === 0, `${label} hudBottom is 0 when dock is outside felt`);

  const packed = longSpinner();
  const layout = calculateBoardLayout(packed.board, stage, {
    spinnerId: "3-3",
    centerTileId: "3-3",
    tileWidth: L.playedShort,
    tileHeight: L.playedLong,
    hudRight: 0,
    hudLeft: 0,
    hudBottom: 0,
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
  const played = packed.board.length + packed.north.length + packed.south.length;
  assert.equal(layout.tiles.length + layout.armTiles.length, played, `${label} keep every tile`);
  for (const t of [...layout.tiles, ...layout.armTiles]) {
    assert.ok(t.y + t.h <= safe.maxY + 0.75, `${label} ${t.tileId} inside felt y`);
    assert.ok(t.x >= safe.minX - 0.75, `${label} ${t.tileId} inside felt x`);
    assert.ok(t.x + t.w <= safe.maxX + 0.75, `${label} ${t.tileId} inside felt x2`);
  }
  const s3 = layout.armTiles.find((t) => t.tileId === "S3");
  if (s3) {
    assert.equal(s3.travelDir, FIRST_FOLD_BOTTOM, `${label} south tile 3 still turns LEFT`);
  }

  const laterRun = packRunLimit(play.maxX - play.minX, L.playedLong, 2);
  assert.ok(laterRun >= 2 && laterRun <= 6, `${label} later-run ${laterRun}`);
  const naiveWide = 6 * L.playedLong + 5 * 2;
  const packedWide = laterRun * L.playedLong + Math.max(0, laterRun - 1) * 2;
  assert.ok(
    packedWide <= naiveWide + 0.5,
    `${label} later runs must not exceed the width ceiling`
  );
  if (naiveWide > play.maxX - play.minX) {
    assert.ok(
      packedWide <= play.maxX - play.minX + L.playedLong,
      `${label} packed width uses folds instead of a 6-tile rail (${packedWide} vs usable ${play.maxX - play.minX})`
    );
  }

  results.push({
    vp: label,
    chrome: Math.round(L.chromeHeight),
    feltTop: Math.round(L.feltTop),
    felt: Math.round(L.feltHeight),
    feltBottom: Math.round(L.feltBottom),
    dock: Math.round(L.dockHeight),
    handTop: Math.round(L.handTop),
    gap: Number((C.hand.top - C.felt.bottom).toFixed(1)),
    played: `${Math.round(L.playedShort)}×${Math.round(L.playedLong)}`,
    scale: Number(layout.scale.toFixed(3)),
    laterRun,
  });
}

{
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
  assert.ok(
    Math.abs(ref.feltHeight - GAMEPLAY_REF.felt) < 8,
    `ref exclusive felt ${ref.feltHeight}`
  );
  assert.equal(PLAYED_PREFERRED_SCALE, 1.2, "+20% played preferred size remains");
  assert.equal(PHONE_PLAYED_SIZE_BOOST, 1.15, "phone landscape +15% preferred boost");
  assert.equal(ref.feltTop, ref.chromeHeight + ref.chromeFeltGap);
}

function legacyBottomReservation(L) {
  const oldDock = Math.min(
    136,
    Math.max(84, Math.max(L.handLong + L.statusBand + 10, L.actionHeight + 12, 84 * L.uiScale))
  );
  const oldFeltDockGap = L.chromeFeltGap;
  const oldFeltHeight = Math.max(
    160,
    L.safeH - L.chromeHeight - oldDock - L.chromeFeltGap - oldFeltDockGap
  );
  const oldFeltTop = L.chromeHeight + L.chromeFeltGap;
  return {
    dock: oldDock,
    feltHeight: oldFeltHeight,
    feltTop: oldFeltTop,
    feltBottom: oldFeltTop + oldFeltHeight,
  };
}

{
  const compare = VIEWPORTS.map((vp) => {
    const L = resolveGameplayLayout(vp);
    const old = legacyBottomReservation(L);
    assert.equal(L.feltTop, old.feltTop, `${vp.name} feltTop stays put`);
    assert.ok(L.feltHeight > old.feltHeight + 0.5, `${vp.name} feltHeight must grow`);
    assert.ok(L.feltBottom > old.feltBottom + 0.5, `${vp.name} feltBottom moves down`);
    assert.ok(L.dockHeight < old.dock - 0.5, `${vp.name} unused dock height is recovered`);
    return {
      vp: vp.name,
      safeH: L.safeH,
      chrome: Math.round(L.chromeHeight),
      feltTop: Math.round(L.feltTop),
      oldFelt: Math.round(old.feltHeight),
      newFelt: Math.round(L.feltHeight),
      oldFeltBottom: Math.round(old.feltBottom),
      newFeltBottom: Math.round(L.feltBottom),
      oldDock: Math.round(old.dock),
      newDock: Math.round(L.dockHeight),
      handTop: Math.round(L.handTop),
      gap: Number((L.handTop - L.feltBottom).toFixed(1)),
    };
  });
  console.log("Felt-to-hand recovery:\n", compare);
}

{
  const usable = 760;
  const bigTile = 186;
  const run = packRunLimit(usable, bigTile, 2);
  assert.equal(run, 4, `phone-width felt must fold a 186px rail, run=${run}`);
  assert.ok(run * bigTile + (run - 1) * 2 <= usable + 8);
  assert.ok(packRunLimit(1100, 186, 2) >= 5, "wide felt may keep longer later runs");
}

{
  const phone = { width: 832, height: 384 };
  const tablet = { width: 1280, height: 800 };
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const basePhone = resolveGameplayLayout(phone);
  const am4Phone = resolveGameplayLayout(phone, am4);
  const classic4Phone = resolveGameplayLayout(phone, {
    playerCount: 4,
    rulesetId: "legacy",
  });
  const am2Phone = resolveGameplayLayout(phone, {
    playerCount: 2,
    rulesetId: "allFives",
  });
  const am4Tablet = resolveGameplayLayout(tablet, am4);
  const baseTablet = resolveGameplayLayout(tablet);

  assert.equal(am4Phone.feltBottom, basePhone.feltBottom, "American 4p phone felt bottom stays put");
  assert.equal(am4Phone.dockHeight, basePhone.dockHeight, "American 4p phone dock stays put");
  assert.equal(am4Phone.handTop, basePhone.handTop, "American 4p phone hand stays put");
  assert.equal(
    am4Phone.chromeFeltGap,
    AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX,
    "American 4p phone keeps a small Rival 1 gap"
  );
  assert.ok(
    am4Phone.feltTop < basePhone.feltTop - 8,
    `American 4p phone felt top moves up (${am4Phone.feltTop} vs ${basePhone.feltTop})`
  );
  assert.ok(
    am4Phone.feltHeight > basePhone.feltHeight + 8,
    `American 4p phone felt grows up (${am4Phone.feltHeight} vs ${basePhone.feltHeight})`
  );
  assert.ok(
    Math.abs(am4Phone.feltBottom - (am4Phone.feltTop + am4Phone.feltHeight)) < 0.01
  );
  const C = gameplayComposition(am4Phone);
  assert.ok(C.menu.bottom <= C.felt.top + 0.01, "menu stays above expanded felt");
  assert.ok(C.score.bottom <= C.felt.top + 0.01, "score stays above expanded felt");
  assert.equal(classic4Phone.feltTop, basePhone.feltTop, "Classic 4p phone felt is unchanged");
  assert.equal(am2Phone.feltTop, basePhone.feltTop, "American 2p phone felt is unchanged");
  assert.equal(am4Tablet.feltTop, baseTablet.feltTop, "American 4p tablet felt top is unchanged");
  assert.equal(
    am4Tablet.feltHeight,
    baseTablet.feltHeight,
    "American 4p tablet felt height is unchanged"
  );

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

  const delta = Math.round(am4Phone.feltHeight - basePhone.feltHeight);
  const oldStage = { width: 617, height: 181 };
  const newStage = { width: 617, height: 181 + delta };
  const pref = resolveBoardTileBase(newStage, {
    w: am4Phone.playedShort,
    h: am4Phone.playedLong,
  });
  const shortPacked = fourWay(1, 1, 1, 1);
  const longPacked = fourWay(2, 2, 11, 11);
  const layoutOf = (stage, packed) =>
    calculateBoardLayout(packed.board, stage, {
      centerTileId: "3-3",
      spinnerId: "3-3",
      tileWidth: pref.w,
      tileHeight: pref.h,
      hudRight: 0,
      hudLeft: 0,
      spinnerNorth: packed.north,
      spinnerSouth: packed.south,
    });
  const shortOld = layoutOf(oldStage, shortPacked);
  const shortNew = layoutOf(newStage, shortPacked);
  const longOld = layoutOf(oldStage, longPacked);
  const longNew = layoutOf(newStage, longPacked);
  const sample = (layout) => {
    const t = layout.tiles[0];
    return { short: Math.min(t.w, t.h), long: Math.max(t.w, t.h), scale: layout.scale };
  };
  const shortOldM = sample(shortOld);
  const shortNewM = sample(shortNew);
  const longOldM = sample(longOld);
  const longNewM = sample(longNew);
  assert.ok(
    shortNewM.short + 0.05 >= shortOldM.short,
    `short American chain must not shrink (${shortNewM.short.toFixed(1)} vs ${shortOldM.short.toFixed(1)})`
  );
  assert.ok(
    longNewM.short > longOldM.short + 0.4,
    `longer Spinner chain must use extra height (${longNewM.short.toFixed(1)} vs ${longOldM.short.toFixed(1)})`
  );
  console.log("American 4p phone felt expand:", {
    feltTop: { old: basePhone.feltTop, new: am4Phone.feltTop },
    feltBottom: { old: basePhone.feltBottom, new: am4Phone.feltBottom },
    feltHeight: { old: basePhone.feltHeight, new: am4Phone.feltHeight },
    chromeFeltGap: am4Phone.chromeFeltGap,
    shortChain: `${shortNewM.short.toFixed(1)}×${shortNewM.long.toFixed(1)}`,
    longSpinner: `${longNewM.short.toFixed(1)}×${longNewM.long.toFixed(1)}`,
  });
}

console.log("Gameplay composition fixtures:\n", results);
console.log("Gameplay composition contract tests passed.");
