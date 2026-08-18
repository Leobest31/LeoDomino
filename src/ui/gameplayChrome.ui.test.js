/**
 * Gameplay chrome contract — Pase only; Sound left of Reserve left of Settings.
 * Run: node src/ui/gameplayChrome.ui.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGameplayLayout } from "./gameplayLayout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const bottomBar = read("components/BottomBar.jsx");
const header = read("components/Header.jsx");
const gamePage = read("pages/GamePage.jsx");
const bottomCss = read("components/BottomBar.css");
const headerCss = read("components/Header.css");

assert.doesNotMatch(bottomBar, /t\("game\.play"\)/, "Jwe/Play control must be gone");
assert.doesNotMatch(bottomBar, /t\("game\.draw"\)/, "Tire/Draw control must be gone");
assert.match(bottomBar, /t\("game\.pass"\)/, "Pase must remain localized");
assert.match(bottomBar, /t\("game\.newMatch"\)/, "New Match must remain");
assert.equal((bottomBar.match(/<button/g) || []).length, 2, "only Pase + New Match");
assert.doesNotMatch(bottomBar, /endAbove/, "old reserve slot must be gone");
assert.doesNotMatch(bottomBar, /IconPlay|IconDraw|canPlay|canDraw|onPlay|onDraw/, "play/draw props gone");
assert.doesNotMatch(bottomCss, /grid-template-columns:\s*1\.15fr 1fr 1fr/, "3-button grid gone");

assert.match(header, /endBefore/, "Header accepts reserve slot");
assert.match(header, /header__end-tools/, "Reserve+Settings share a row");
const toolsBlock = header.slice(
  header.indexOf("header__end-tools"),
  header.indexOf("header__menu-btn")
);
assert.match(toolsBlock, /IconMute/, "Sound stays in the tools row");
assert.match(toolsBlock, /IconUnmute/, "Sound icon is unchanged");
assert.match(toolsBlock, /endBefore/, "Rezèv renders in the tools row");
assert.match(toolsBlock, /IconSettings/, "Settings stays in the tools row");
assert.ok(
  toolsBlock.indexOf("IconMute") < toolsBlock.indexOf("endBefore"),
  "Sound is immediately left of Reserve"
);
assert.ok(
  toolsBlock.indexOf("endBefore") < toolsBlock.indexOf("IconSettings"),
  "Reserve is immediately left of Settings"
);
const startBlock = header.slice(
  header.indexOf("header__side--start"),
  header.indexOf("header__brand")
);
assert.doesNotMatch(startBlock, /IconMute|IconUnmute/, "Sound is no longer on the left");
assert.match(startBlock, /startBelow/, "score remains in the left chrome");
assert.match(header, /header__menu-btn/, "Meni Prensipal remains in the header");
assert.ok(
  header.indexOf("header__end-tools") < header.indexOf("header__menu-btn"),
  "Meni Prensipal stays below the Settings row"
);
assert.match(headerCss, /header__end-tools/, "tools row is CSS flex row");
assert.match(headerCss, /flex-direction:\s*row/, "Sound, Reserve, and Settings share one row");
assert.match(headerCss, /justify-content:\s*flex-start/, "Meni Prensipal attaches under the tool row");
assert.doesNotMatch(
  headerCss,
  /\.header--stacked \.header__menu-btn\s*\{[^}]*margin-top:\s*auto/,
  "Meni Prensipal is not pushed to the felt edge"
);

assert.match(gamePage, /endBefore=\{/, "GamePage mounts reserve in chrome");
assert.match(gamePage, /game-page__hud-reserve/, "Reserve wrapper still used");
assert.match(gamePage, /game-page__hud-score/, "score remains in left chrome");
assert.match(gamePage, /<ScoreBoard/, "live ScoreBoard still mounts");
assert.match(bottomBar, /bottom-bar__center/, "hand occupies the dock center");
assert.match(gamePage, /<BottomBar[\s\S]*<PlayerPanel/, "Player 1 hand is in the bottom dock");
assert.doesNotMatch(gamePage, /endAbove/, "dock no longer hosts reserve");
assert.doesNotMatch(gamePage, /onPlay=\{handlePlay\}/, "Jwe handler not wired");
assert.doesNotMatch(gamePage, /onDraw=\{handleDraw\}/, "Tire handler not wired");
assert.match(gamePage, /handleReservePick/, "human reserve pick is wired");
assert.match(gamePage, /<ReservePicker/, "centered reserve picker mounts on the felt");
assert.doesNotMatch(gamePage, /runDrawSequence/, "automatic human draw sequence removed");
assert.match(gamePage, /canPass=\{isHumanTurn && actions\.canPass\}/, "Pase eligibility unchanged");

assert.match(gamePage, /playerCount: state\.players\.length/, "layout sees 4-player matches");
assert.match(gamePage, /rulesetId: state\.rulesetId/, "layout sees American ruleset");
assert.match(
  read("pages/GamePage.css"),
  /\.game-page--players-4\[data-layout-density="short"\] \.game-page__chrome/,
  "4-player phone chrome is not locked to the 96px band"
);

const phone = resolveGameplayLayout({ width: 844, height: 390 });
const tablet = resolveGameplayLayout({ width: 1280, height: 800 });
const narrow = resolveGameplayLayout({ width: 740, height: 360 });
const iphone = resolveGameplayLayout({ width: 852, height: 393 });
const pixel = resolveGameplayLayout({ width: 915, height: 412 });
const ipad = resolveGameplayLayout({ width: 1024, height: 768 });
const wide = resolveGameplayLayout({ width: 1366, height: 768 });
for (const [name, L] of [
  ["phone", phone],
  ["tablet", tablet],
  ["narrow", narrow],
  ["iphone", iphone],
  ["pixel", pixel],
  ["ipad", ipad],
  ["wide", wide],
]) {
  assert.ok(L.feltHeight > L.chromeHeight, `${name} felt still dominates`);
  assert.ok(L.actionHeight >= 36, `${name} Pase touch floor`);
  assert.ok(L.chromeHeight >= 96, `${name} HUD chrome remains`);
}

console.log("Gameplay chrome UI contract tests passed.");
