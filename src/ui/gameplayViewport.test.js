/**
 * Universal landscape gameplay fill — occupy the environment's available
 * viewport. Capability-based (svh/dvh + safe-area), never a device name.
 * Run: node src/ui/gameplayViewport.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX,
  FELT_HAND_GAP_MIN_PX,
  FELT_HAND_GAP_MAX_PX,
  gameplayComposition,
  gameplayDensityClass,
  rectsOverlap,
  resolveGameplayLayout,
  usableGameplayViewport,
} from "./gameplayLayout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const LANDSCAPE = [
  { name: "iphone-class", width: 852, height: 393 },
  { name: "iphone-pro-max-class", width: 932, height: 430 },
  { name: "tall-phone-landscape", width: 956, height: 440 },
  { name: "a37-class", width: 832, height: 384 },
  { name: "small-android", width: 740, height: 360 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-reference", width: 1280, height: 800 },
  { name: "tablet-a9-class", width: 1340, height: 800 },
];

function firstRule(css, selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  assert.ok(m, `${selector} rule must exist`);
  return m[1];
}

{
  const html = read("../index.html");
  const reset = read("styles/reset.css");
  const app = read("App.css");
  const global = read("styles/global.css");
  const page = read("pages/GamePage.css");
  const layout = read("ui/gameplayLayout.js");

  assert.match(html, /viewport-fit=cover/, "notches use viewport-fit=cover");
  assert.match(reset, /height:\s*100svh/, "html uses small viewport height fallback");
  assert.match(reset, /height:\s*100dvh/, "html uses dynamic viewport height");
  assert.match(reset, /overscroll-behavior:\s*none/, "root does not rubber-band scroll");

  const gamePageRule = firstRule(page, ".game-page");
  assert.match(gamePageRule, /width:\s*100%/);
  assert.match(gamePageRule, /height:\s*100%/);
  assert.doesNotMatch(gamePageRule, /max-height:\s*100(?:d|s|l)?vh/, "game-page is not capped below the available viewport");
  assert.match(gamePageRule, /align-items:\s*stretch/, "shell is not vertically centered in leftover space");
  assert.match(
    gamePageRule,
    /padding-top:\s*env\(safe-area-inset-top/,
    "top inset is CSS safe-area only"
  );
  assert.match(gamePageRule, /padding-right:\s*env\(safe-area-inset-right/);
  assert.match(gamePageRule, /padding-bottom:\s*var\(--game-safe-bottom/);
  assert.match(gamePageRule, /padding-left:\s*env\(safe-area-inset-left/);
  assert.doesNotMatch(
    gamePageRule,
    /max\([^)]*rem[^)]*safe-area/,
    "game-page must not keep rem gutters outside the safe area"
  );

  const appGame = firstRule(app, ".app--game");
  assert.match(appGame, /width:\s*100%/);
  assert.match(appGame, /height:\s*100%/);
  assert.doesNotMatch(appGame, /max-height:\s*100(?:d|s|l)?vh/);

  assert.doesNotMatch(global, /\.app--game \{[^}]*max-height:\s*100dvh/);
  assert.doesNotMatch(page, /\.game-page__table-stage \{[^}]*width:\s*99%/);
  assert.doesNotMatch(page, /@media \(min-width: 1100px\) \{[^}]*width:\s*97%/);
  assert.match(page, /\.game-page__table-stage \{[^}]*width:\s*100%/);

  assert.doesNotMatch(layout, /Galaxy|SM_A376|iPhone|Samsung|A37/);
  assert.match(layout, /usableGameplayViewport/);
}

{
  const raw = { width: 852, height: 393 };
  const none = usableGameplayViewport(raw);
  assert.equal(none.width, 852);
  assert.equal(none.height, 393);
  const inset = usableGameplayViewport(raw, {
    top: 0,
    bottom: 21,
    left: 47,
    right: 47,
  });
  assert.equal(inset.width, 758);
  assert.equal(inset.height, 372);
  assert.ok(inset.width < raw.width, "notch insets reduce usable width");
  assert.ok(inset.height < raw.height, "home-indicator inset reduces usable height");
}

function assertFill(label, vp, options = {}) {
  const box = usableGameplayViewport(vp, vp.insets);
  const L = resolveGameplayLayout(box, options);
  const C = gameplayComposition(L);
  const stack =
    L.chromeHeight + L.chromeFeltGap + L.feltHeight + L.feltDockGap + L.dockHeight;

  assert.equal(L.feltWidth, L.safeW, `${label} felt uses full usable width`);
  assert.ok(
    Math.abs(stack - L.safeH) < 1.5,
    `${label} chrome+felt+dock fill usable height (${stack} vs ${L.safeH})`
  );
  assert.equal(L.safeW, box.width, `${label} layout width is the usable viewport`);
  assert.equal(L.safeH, box.height, `${label} layout height is the usable viewport`);
  assert.ok(C.hand.top >= C.felt.bottom - 0.01, `${label} Player 1 hand stays below felt`);
  const feltHandGap = C.hand.top - C.felt.bottom;
  assert.ok(
    feltHandGap >= FELT_HAND_GAP_MIN_PX - 0.5 &&
      feltHandGap <= FELT_HAND_GAP_MAX_PX + 0.5,
    `${label} felt-to-hand gap ${feltHandGap}`
  );
  assert.ok(!rectsOverlap(C.felt, C.hand, 0.5), `${label} hand does not clip felt`);
  assert.ok(!rectsOverlap(C.score, C.felt, 0.5), `${label} scoreboard stays in HUD`);
  assert.ok(!rectsOverlap(C.menu, C.felt, 0.5), `${label} menu stays in HUD`);
  assert.ok(!rectsOverlap(C.felt, C.pass, 0.5), `${label} Pase stays visible outside felt`);
  assert.ok(!rectsOverlap(C.felt, C.newMatch, 0.5), `${label} New Match stays visible`);
  assert.ok(C.score.top >= 0, `${label} HUD is not clipped at the top`);
  assert.ok(C.pass.bottom <= L.safeH + 0.5, `${label} buttons stay inside the usable box`);
  assert.ok(C.hand.bottom <= L.safeH + 0.5, `${label} hand stays inside the usable box`);
  assert.ok(C.felt.left >= 0 && C.felt.right <= L.safeW + 0.5, `${label} felt is not clipped horizontally`);
  assert.ok(L.actionHeight >= 36, `${label} HUD buttons remain tappable`);
  assert.ok(L.feltHeight > L.dockHeight, `${label} felt still dominates the dock`);
  return { L, C, box };
}

for (const vp of LANDSCAPE) {
  assertFill(vp.name, vp);
  assertFill(`${vp.name} standalone insets`, {
    ...vp,
    insets: { top: 0, right: 24, bottom: 21, left: 24 },
  });
}

{
  const a37 = { width: 832, height: 384 };
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const base = resolveGameplayLayout(a37);
  const grown = resolveGameplayLayout(a37, am4);
  const { L, C } = assertFill("a37-class American 4p", a37, am4);

  assert.equal(gameplayDensityClass(grown), "short");
  assert.equal(grown.feltBottom, base.feltBottom, "A37 felt bottom stays put");
  assert.equal(grown.dockHeight, base.dockHeight, "A37 dock stays put");
  assert.equal(grown.handTop, base.handTop, "A37 Player 1 hand stays put");
  assert.equal(grown.chromeFeltGap, AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX);
  assert.ok(grown.feltTop < base.feltTop - 8, "A37 felt grows upward under Rival 1");
  assert.ok(grown.feltHeight > base.feltHeight + 8, "A37 felt height grows up, not by stretching tiles");
  assert.ok(C.menu.bottom <= C.felt.top + 0.01, "A37 menu stays above expanded felt");
  assert.ok(C.score.bottom <= C.felt.top + 0.01, "A37 score stays above expanded felt");
  assert.ok(C.hand.top >= C.felt.bottom - 0.01, "A37 hand remains below felt");
  assert.equal(L.feltBottom, grown.feltBottom);

  const tablet = { width: 1280, height: 800 };
  const tabBase = resolveGameplayLayout(tablet);
  const tabAm4 = resolveGameplayLayout(tablet, am4);
  assert.equal(tabAm4.feltTop, tabBase.feltTop, "tablet American 4p felt top unchanged");
  assert.equal(tabAm4.feltHeight, tabBase.feltHeight, "tablet American 4p felt height unchanged");
  assert.equal(tabAm4.dockHeight, tabBase.dockHeight, "tablet dock unchanged");

  const phone2p = resolveGameplayLayout(a37, { playerCount: 2, rulesetId: "allFives" });
  assert.equal(phone2p.feltTop, base.feltTop, "non-4p phone felt is unchanged");

  const classic2p = resolveGameplayLayout(a37, { playerCount: 2, rulesetId: "legacy" });
  assert.equal(classic2p.feltTop, grown.feltTop, "A37 Classic 2p table top uses the Rival 1 hug");
  assert.equal(classic2p.chromeFeltGap, AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX);
  assert.equal(classic2p.feltBottom, base.feltBottom, "A37 Classic 2p table bottom stays put");
  assert.equal(classic2p.handTop, base.handTop, "A37 Classic 2p Player 1 hand stays put");
  assert.equal(classic2p.dockTop, base.dockTop, "A37 Classic 2p dock stays put");
  assert.equal(classic2p.playedShort, base.playedShort, "A37 Classic 2p tile short unchanged");
  assert.equal(classic2p.playedLong, base.playedLong, "A37 Classic 2p tile long unchanged");
  const { C: classic2C } = assertFill("a37-class Classic 2p", a37, {
    playerCount: 2,
    rulesetId: "legacy",
  });
  assert.ok(classic2C.score.bottom <= classic2C.felt.top + 0.01, "A37 Classic 2p score stays above table");
  assert.ok(classic2C.menu.bottom <= classic2C.felt.top + 0.01, "A37 Classic 2p menu stays above table");
  assert.ok(classic2C.hand.top >= classic2C.felt.bottom - 0.01, "A37 Classic 2p hand stays below table");

  const classic3p = resolveGameplayLayout(a37, { playerCount: 3, rulesetId: "legacy" });
  assert.equal(classic3p.feltTop, grown.feltTop, "A37 Classic 3p table top uses the Rival 1 hug");
  assert.equal(classic3p.chromeFeltGap, AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX);
  assert.equal(classic3p.feltBottom, base.feltBottom, "A37 Classic 3p table bottom stays put");
  assert.equal(classic3p.handTop, base.handTop, "A37 Classic 3p Player 1 hand stays put");
  assert.equal(classic3p.dockTop, base.dockTop, "A37 Classic 3p dock stays put");
  assert.equal(classic3p.feltWidth, base.feltWidth, "A37 Classic 3p table width unchanged");
  assert.equal(classic3p.playedShort, base.playedShort, "A37 Classic 3p tile short unchanged");
  assert.equal(classic3p.playedLong, base.playedLong, "A37 Classic 3p tile long unchanged");
  const am3p = resolveGameplayLayout(a37, { playerCount: 3, rulesetId: "allFives" });
  assert.equal(am3p.feltTop, base.feltTop, "A37 American 3p table top stays on the shared chrome");

  assert.equal(grown.chromeHeight, 75, "A37 chrome hug stays at 75");
  assert.equal(grown.feltTop, 77, "A37 table top stays at 77");
  assert.equal(grown.feltBottom, 328, "A37 table bottom stays at 328");
  assert.equal(grown.feltHeight, 251, "A37 felt height stays at 251");
  assert.equal(grown.handTop, 332, "A37 hand top stays at 332");
  assert.equal(grown.dockTop, 332, "A37 dock top stays at 332");

  const classicA37 = resolveGameplayLayout(a37, { playerCount: 4, rulesetId: "legacy" });
  assert.equal(classicA37.chromeHeight, grown.chromeHeight, "A37 Classic 4p chrome matches American");
  assert.equal(classicA37.feltTop, grown.feltTop, "A37 Classic 4p table top matches American");
  assert.equal(classicA37.feltBottom, grown.feltBottom, "A37 Classic 4p table bottom matches American");
  assert.equal(classicA37.feltHeight, grown.feltHeight, "A37 Classic 4p felt height matches American");
  assert.equal(classicA37.handTop, grown.handTop, "A37 Classic 4p hand matches American");
  assert.equal(classicA37.dockTop, grown.dockTop, "A37 Classic 4p dock matches American");
}

{
  const iphone = assertFill("iphone-class American 4p", { width: 852, height: 393 }, {
    playerCount: 4,
    rulesetId: "allFives",
  });
  assert.equal(gameplayDensityClass(iphone.L), "short");
  assert.ok(iphone.L.chromeHeight >= 64, "iPhone-class HUD remains after chrome hug");
  assert.ok(iphone.C.hand.bottom <= iphone.L.safeH + 0.5);

  const withIsland = assertFill(
    "iphone-class PWA/Capacitor insets",
    {
      width: 852,
      height: 393,
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
    },
    { playerCount: 4, rulesetId: "allFives" }
  );
  assert.ok(withIsland.box.width < 852, "Dynamic Island insets shrink the usable width");
  assert.ok(withIsland.L.safeW === withIsland.box.width);
  assert.ok(withIsland.C.pass.left <= 1, "Pase remains on the usable left edge");
  assert.ok(withIsland.C.newMatch.right >= withIsland.L.safeW - 1, "New Match remains on the usable right edge");
}

{
  const am4 = { playerCount: 4, rulesetId: "allFives" };
  const tallPhone = { width: 956, height: 440 };
  const islandInsets = { top: 0, right: 21, bottom: 0, left: 59 };
  const box = usableGameplayViewport(tallPhone, islandInsets);
  assert.equal(box.width, 876);
  assert.equal(box.height, 440);
  const base = resolveGameplayLayout(box);
  const grown = resolveGameplayLayout(box, am4);
  const { C } = assertFill("tall-phone-landscape American 4p", {
    ...tallPhone,
    insets: islandInsets,
  }, am4);

  assert.equal(gameplayDensityClass(grown), "short", "440px phone safes stay phone-landscape after insets");
  assert.equal(grown.feltBottom, base.feltBottom, "tall-phone table bottom stays anchored");
  assert.equal(grown.handTop, base.handTop, "tall-phone Player 1 hand stays put");
  assert.equal(grown.dockTop, base.dockTop, "tall-phone dock stays put");
  assert.equal(grown.dockHeight, base.dockHeight, "tall-phone dock height stays put");
  assert.equal(grown.chromeFeltGap, AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX);
  assert.ok(
    grown.feltTop < base.feltTop - 8,
    `tall-phone table grows upward only (${grown.feltTop} vs ${base.feltTop})`
  );
  assert.ok(
    grown.feltHeight > base.feltHeight + 8,
    `tall-phone felt height grows (${grown.feltHeight} vs ${base.feltHeight})`
  );
  assert.ok(C.score.bottom <= C.felt.top + 0.01, "tall-phone score stays above table");
  assert.ok(C.menu.bottom <= C.felt.top + 0.01, "tall-phone menu stays above table");
  assert.ok(C.hand.top >= C.felt.bottom - 0.01, "tall-phone hand stays below table");

  const classic = resolveGameplayLayout(box, { playerCount: 4, rulesetId: "legacy" });
  assert.equal(classic.feltTop, grown.feltTop, "Classic 4p uses the same 4p phone upward hug");
  assert.equal(classic.feltBottom, grown.feltBottom, "Classic 4p table bottom stays anchored");
  assert.equal(classic.handTop, grown.handTop, "Classic 4p Player 1 hand stays put");
  assert.equal(classic.dockTop, grown.dockTop, "Classic 4p dock stays put");
  assert.equal(classic.feltHeight, grown.feltHeight, "Classic 4p felt grows the same amount");
  const twoP = resolveGameplayLayout(box, { playerCount: 2, rulesetId: "allFives" });
  assert.equal(twoP.feltTop, base.feltTop, "American 2p does not use the 4p phone hug");
  const classic2 = resolveGameplayLayout(box, { playerCount: 2, rulesetId: "legacy" });
  assert.equal(classic2.feltTop, grown.feltTop, "Classic 2p phone uses the Rival 1 upward hug");
  assert.equal(classic2.feltBottom, base.feltBottom, "Classic 2p table bottom stays anchored");
  assert.equal(classic2.handTop, base.handTop, "Classic 2p Player 1 hand stays put");
  assert.equal(classic2.dockTop, base.dockTop, "Classic 2p dock stays put");
  assert.equal(classic2.playedShort, base.playedShort, "Classic 2p tile short unchanged");
  assert.equal(classic2.playedLong, base.playedLong, "Classic 2p tile long unchanged");
  const { C: classic2C } = assertFill("tall-phone-landscape Classic 2p", {
    ...tallPhone,
    insets: islandInsets,
  }, { playerCount: 2, rulesetId: "legacy" });
  assert.ok(classic2C.score.bottom <= classic2C.felt.top + 0.01, "Classic 2p score stays above table");
  assert.ok(classic2C.menu.bottom <= classic2C.felt.top + 0.01, "Classic 2p menu stays above table");
  assert.ok(classic2C.hand.top >= classic2C.felt.bottom - 0.01, "Classic 2p hand stays below table");

  const classic3 = resolveGameplayLayout(box, { playerCount: 3, rulesetId: "legacy" });
  assert.equal(classic3.feltTop, grown.feltTop, "Classic 3p phone uses the Rival 1 upward hug");
  assert.equal(classic3.chromeFeltGap, AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX);
  assert.equal(classic3.feltBottom, base.feltBottom, "Classic 3p table bottom stays anchored");
  assert.equal(classic3.handTop, base.handTop, "Classic 3p Player 1 hand stays put");
  assert.equal(classic3.dockTop, base.dockTop, "Classic 3p dock stays put");
  assert.equal(classic3.feltWidth, base.feltWidth, "Classic 3p table width unchanged");
  assert.equal(classic3.playedShort, base.playedShort, "Classic 3p tile short unchanged");
  assert.equal(classic3.playedLong, base.playedLong, "Classic 3p tile long unchanged");
  const am3 = resolveGameplayLayout(box, { playerCount: 3, rulesetId: "allFives" });
  assert.equal(am3.feltTop, base.feltTop, "American 3p does not use the Classic 3p phone hug");
  const { C: classic3C } = assertFill("tall-phone-landscape Classic 3p", {
    ...tallPhone,
    insets: islandInsets,
  }, { playerCount: 3, rulesetId: "legacy" });
  assert.ok(classic3C.score.bottom <= classic3C.felt.top + 0.01, "Classic 3p score stays above table");
  assert.ok(classic3C.menu.bottom <= classic3C.felt.top + 0.01, "Classic 3p menu stays above table");
  assert.ok(classic3C.hand.top >= classic3C.felt.bottom - 0.01, "Classic 3p hand stays below table");

  const tabA9 = resolveGameplayLayout({ width: 1340, height: 800 }, am4);
  const tabA9Base = resolveGameplayLayout({ width: 1340, height: 800 });
  const tabA9Classic = resolveGameplayLayout(
    { width: 1340, height: 800 },
    { playerCount: 4, rulesetId: "legacy" }
  );
  assert.equal(tabA9.feltTop, tabA9Base.feltTop, "Tab A9+ felt top unchanged");
  assert.equal(tabA9.feltBottom, tabA9Base.feltBottom, "Tab A9+ felt bottom unchanged");
  assert.equal(tabA9.feltHeight, 578, "Tab A9+ felt height stays on the 1280×800 reference");
  assert.equal(tabA9.handTop, tabA9Base.handTop, "Tab A9+ hand unchanged");
  assert.equal(tabA9Classic.feltTop, tabA9Base.feltTop, "Tab A9+ Classic 4p felt top unchanged");
  assert.equal(tabA9Classic.feltBottom, tabA9Base.feltBottom, "Tab A9+ Classic 4p felt bottom unchanged");
  assert.equal(tabA9Classic.feltHeight, tabA9Base.feltHeight, "Tab A9+ Classic 4p felt height unchanged");
  const tabA9Classic3 = resolveGameplayLayout(
    { width: 1340, height: 800 },
    { playerCount: 3, rulesetId: "legacy" }
  );
  assert.equal(tabA9Classic3.feltTop, tabA9Base.feltTop, "Tab A9+ Classic 3p felt top unchanged");
  assert.equal(tabA9Classic3.feltBottom, tabA9Base.feltBottom, "Tab A9+ Classic 3p felt bottom unchanged");
}

console.log("Gameplay landscape viewport fill tests passed.");
