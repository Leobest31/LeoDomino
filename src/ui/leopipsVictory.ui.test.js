/**
 * Live LeoPips winner celebration + loser result UI contract.
 * Run: node src/ui/leopipsVictory.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const overlay = read("components/LeoPipsVictoryOverlay.jsx");
const overlayCss = read("components/LeoPipsVictoryOverlay.css");
const online = read("pages/OnlineGamePage.jsx");
const modal = read("components/MatchOverModal.jsx");
const gamePage = read("pages/GamePage.jsx");
const findMatch = read("pages/FindMatchPage.jsx");
const matchmaking = read("online/matchmaking.js");
const en = read("i18n/locales/en.js");

assert.match(overlay, /matchOver\.congratulations/);
assert.match(overlay, /matchOver\.youWonTheMatch/);
assert.match(overlay, /matchOver\.leopipsWon/);
assert.match(overlay, /matchOver\.yourTotalBalance/);
assert.match(overlay, /matchOver\.greatPlay/);
assert.match(overlay, /data-leopips-victory="winner"/);
assert.match(overlay, /data-leopips-coin-rain="true"/);
assert.match(overlay, /data-leopips-coin-layer="foreground"/);
assert.match(overlay, /createPortal/);
assert.match(overlay, /from "react-dom"/);
assert.match(overlay, /document\.body/);
assert.match(overlay, /data-leopips-coin-portal="document.body"/);
assert.match(overlay, /LEOPIPS_VICTORY_FOREGROUND_Z = 2147483000/);
assert.match(overlay, /LEOPIPS_VICTORY_CARD_PATHS/);
assert.match(overlay, /ul-center-bottom/);
assert.match(overlay, /uc-center-br/);
assert.match(overlay, /ur-center-bl/);
assert.match(overlay, /cl-payout-bottom/);
assert.match(overlay, /cr-across-bottom/);
assert.match(overlay, /data-leopips-cross-card="true"/);
assert.match(overlay, /LEOPIPS_VICTORY_COIN_COUNT = 60/);
assert.match(overlay, /LEOPIPS_VICTORY_DURATION_S = 6/);
assert.match(overlay, /LEOPIPS_VICTORY_COIN_DURATION_MIN = 1\.6/);
assert.match(overlay, /LEOPIPS_VICTORY_COIN_DURATION_MAX = 2\.2/);
assert.match(overlay, /\[0\.0,\s*0\.2\]/);
assert.match(overlay, /\[1\.0,\s*1\.2\]/);
assert.match(overlay, /\[2\.0,\s*2\.2\]/);
assert.match(overlay, /\[3\.0,\s*3\.2\]/);
assert.match(overlay, /\[4\.0,\s*4\.2\]/);
assert.match(overlay, /Math\.floor\(index \/ 12\)/);
assert.doesNotMatch(overlay, /const duration = LEOPIPS_VICTORY_DURATION_S - delay/);
assert.match(overlay, /Math\.min\(rawDuration, LEOPIPS_VICTORY_DURATION_S - delay\)/);
assert.match(overlay, /startTop/);
assert.match(overlay, /rotateX|spinX/);
assert.match(overlay, /z0|translateZ|--z1/);
assert.match(overlay, /data-leopips-victory-home="true"/);
assert.match(overlay, /data-leopips-victory-menu="true"/);
assert.match(overlay, /data-leopips-payout/);
assert.match(overlay, /data-leopips-balance/);
assert.match(overlay, /data-leopips-victory-xp="no"/);
assert.match(overlay, /data-leopips-victory-level="no"/);
assert.match(overlay, /leoPipsCoinSrc/);
assert.match(overlay, /formatLeoPipsPayout/);
assert.match(overlay, /formatSignedLeoPips/);
assert.doesNotMatch(overlay, /1040|1,040|1250|1,250|5240|5,240/);
assert.doesNotMatch(overlay, /clampLeoPipsBalance|formatLeoPipsAmount/);
assert.doesNotMatch(overlay, /globalRp|matchOver\.globalRp|RP unchanged|rpUnchanged/);
assert.doesNotMatch(overlay, /leoPipsMayAwardXp|leoPipsMayProgressLevel|awardXp|grantXp/);

assert.match(overlayCss, /leopips-victory-burst-fall/);
assert.match(overlayCss, /12%/);
assert.match(overlayCss, /25%/);
assert.match(overlayCss, /85%/);
assert.match(overlayCss, /animation-iteration-count:\s*1/);
assert.match(overlayCss, /perspective:\s*920px/);
assert.match(overlayCss, /transform-style:\s*preserve-3d/);
assert.match(overlayCss, /rotateX\(/);
assert.match(overlayCss, /rotateY\(/);
assert.match(overlayCss, /rotateZ\(/);
assert.match(overlayCss, /translate3d\(/);
assert.match(overlayCss, /var\(--z1/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*pointer-events:\s*none/);
assert.match(overlayCss, /\.leopips-victory__coin[\s\S]*pointer-events:\s*none/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*position:\s*fixed/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*inset:\s*0/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*width:\s*100vw/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*height:\s*100dvh/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*overflow:\s*hidden/);
assert.match(overlayCss, /\.leopips-victory__rain[\s\S]*z-index:\s*2147483000/);
assert.match(overlayCss, /\.leopips-victory\s*\{[\s\S]*z-index:\s*130/);
assert.doesNotMatch(overlayCss, /animation-iteration-count:\s*infinite/);
assert.match(overlayCss, /prefers-reduced-motion/);
assert.match(overlayCss, /prefers-reduced-motion: reduce[\s\S]*display:\s*none/);

{
  const rainZ = overlayCss.match(/\.leopips-victory__rain\s*\{[^}]*z-index:\s*(\d+)/);
  const overlayZ = overlayCss.match(/\.leopips-victory\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(rainZ && overlayZ, "portal and victory overlay z-index exist");
  assert.ok(
    Number(rainZ[1]) > Number(overlayZ[1]),
    "body portal stacking context is above the entire victory overlay",
  );
  assert.equal(Number(rainZ[1]), 2147483000);
}

{
  const overlayTree = overlay.slice(
    overlay.indexOf("const overlay ="),
    overlay.indexOf("const celebration ="),
  );
  const celebrationTree = overlay.slice(overlay.indexOf("const celebration ="));
  assert.doesNotMatch(overlayTree, /leopips-victory__rain|createPortal/);
  assert.match(celebrationTree, /createPortal\([\s\S]*leopips-victory__rain[\s\S]*document\.body/);
  assert.match(celebrationTree, /data-leopips-coin-portal="document.body"/);
}

{
  const waves = [
    [0.0, 0.2],
    [1.0, 1.2],
    [2.0, 2.2],
    [3.0, 3.2],
    [4.0, 4.2],
  ];
  const minD = 1.6;
  const maxD = 2.2;
  const cap = 6;
  const coins = Array.from({ length: 60 }, (_, index) => {
    const wave = Math.floor(index / 12);
    const inWave = index % 12;
    const [start, end] = waves[wave];
    const delay = start + (inWave / 11) * (end - start);
    const raw = minD + ((index * 3 + wave) % 7) * ((maxD - minD) / 6);
    const duration = Math.min(raw, cap - delay);
    return { wave, delay, duration, end: delay + duration };
  });
  assert.equal(coins.length, 60);
  assert.ok(coins.every((c) => c.duration >= 1.6 - 1e-9 && c.duration <= 2.2 + 1e-9));
  assert.ok(coins.every((c) => c.duration < 3), "no coin uses a ~6s individual fall");
  assert.ok(coins.filter((c) => c.wave === 0).every((c) => c.delay <= 0.2));
  assert.ok(coins.filter((c) => c.wave === 4).every((c) => c.delay >= 4 && c.delay <= 4.2));
  const wave5 = coins.filter((c) => c.wave === 4);
  const lastEnd = Math.max(...wave5.map((c) => c.end));
  assert.ok(lastEnd >= 5.8, `wave 5 final activity ${lastEnd} reaches ~5.8s`);
  assert.ok(lastEnd <= 6.0 + 1e-9, `wave 5 does not continue past ~6s (${lastEnd})`);
  assert.ok(Math.max(...coins.map((c) => c.end)) <= 6.0 + 1e-9);
  const avg = coins.reduce((sum, c) => sum + c.duration, 0) / coins.length;
  assert.ok(avg >= 1.7 && avg <= 2.05, `average coin duration ${avg} is ~1.9s`);
}

assert.match(online, /LeoPipsVictoryOverlay/);
assert.match(online, /loadLeoPipsMatchResult/);
assert.match(online, /from "\.\.\/online\/matchPipsResult\.js"/);
assert.match(online, /from "\.\.\/online\/leopipsWalletEvents\.js"/, "settlement notifies wallet refresh");
assert.doesNotMatch(online, /from ["']\.\.\/leopips\//, "OnlineGamePage must not import LeoPips preview package modules");
assert.match(online, /leopipsVictory/);
assert.match(online, /humanWonMatch && leopipsResult\?\.kind === "staked"/);
assert.match(online, /showGenericMatchOver/);
assert.doesNotMatch(online, /hideGlobalRp/, "Global RP has been removed");
assert.match(online, /leopipsBalance=\{leopipsResult\?\.kind === "staked" \? leopipsResult\.balance : null\}/);
assert.doesNotMatch(online, /LeoPipsWinOverlay/);
assert.doesNotMatch(online, /awardXp|grantXp|leoPipsMayAwardXp|levelProgress/);

assert.doesNotMatch(modal, /hideGlobalRp|globalRp/, "Global RP has been removed");
assert.match(modal, /leopipsBalance/);
assert.match(modal, /data-leopips-result-balance/);
assert.doesNotMatch(modal, /congratulations|youWonTheMatch|leopips-victory|data-leopips-coin-rain/);
assert.match(modal, /leopipsBalance != null \? \(/);

assert.doesNotMatch(gamePage, /LeoPipsVictoryOverlay|loadLeoPipsMatchResult|leopips-victory/);
assert.match(gamePage, /<MatchOverModal/);

{
  const modalMount = gamePage.slice(
    gamePage.indexOf("<MatchOverModal"),
    gamePage.indexOf("/>", gamePage.indexOf("<MatchOverModal")) + 2,
  );
  assert.doesNotMatch(modalMount, /hideGlobalRp|leopipsBalance|LeoPipsVictory/);
}

assert.match(en, /congratulations: "CONGRATULATIONS!"/);
assert.match(en, /youWonTheMatch: "YOU WON THE MATCH!"/);
assert.match(en, /leopipsWon: "LEOPIPS WON"/);
assert.match(en, /yourTotalBalance: "YOUR TOTAL BALANCE"/);

assert.match(findMatch, /lockedStakePips/);
assert.match(matchmaking, /visibleFindMatchLobbyRequests/);
assert.doesNotMatch(findMatch, /LeoPipsVictoryOverlay/);
assert.doesNotMatch(matchmaking, /LeoPipsVictoryOverlay|loadLeoPipsMatchResult/);

console.log("  ✓ LeoPips victory / loser result UI contract");
