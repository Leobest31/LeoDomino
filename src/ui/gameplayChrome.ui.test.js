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
const avatar = read("components/Avatar.jsx");
const avatars = read("auth/avatars.js");

assert.doesNotMatch(bottomBar, /t\("game\.play"\)/, "Jwe/Play control must be gone");
assert.doesNotMatch(bottomBar, /t\("game\.draw"\)/, "Tire/Draw control must be gone");
assert.match(bottomBar, /t\("game\.pass"\)/, "Pase must remain localized");
assert.match(bottomBar, /t\("game\.newMatch"\)/, "New Match must remain");
assert.equal((bottomBar.match(/<button/g) || []).length, 2, "only Pase + New Match");
assert.doesNotMatch(bottomBar, /endAbove/, "old reserve slot must be gone");
assert.doesNotMatch(bottomBar, /IconPlay|IconDraw|canPlay|canDraw|onPlay|onDraw/, "play/draw props gone");
assert.doesNotMatch(bottomCss, /grid-template-columns:\s*1\.15fr 1fr 1fr/, "3-button grid gone");

assert.match(header, /endBefore/, "Header accepts the trailing identity slot");
assert.match(header, /header__end-tools/, "Reserve shares the tools row");
const toolsBlock = header.slice(
  header.indexOf("header__end-tools"),
  header.indexOf("</div>", header.indexOf("header__end-tools"))
);
assert.doesNotMatch(header, /IconMute|IconUnmute/, "Sound is gone from gameplay");
assert.doesNotMatch(toolsBlock, /IconSettings/, "Settings is gone from gameplay");
assert.doesNotMatch(header, /SettingsPanel/, "gameplay does not mount Settings");
assert.match(header, /header__home-btn/, "compact Home control remains");
assert.match(header, /t\("common\.home"\)/, "Home control is labeled Home");
assert.doesNotMatch(header, /header__menu-btn/, "long Main Menu control is gone");
assert.match(headerCss, /header__end-tools/, "tools row is CSS flex row");
assert.match(headerCss, /flex-direction:\s*row/, "Reserve and Home share one row");
assert.match(
  headerCss,
  /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
  "portrait HUD columns cannot overlap"
);

assert.doesNotMatch(gamePage, /game-page__hud-reserve/, "Reserve is not permanently mounted in the HUD");
assert.match(gamePage, /game-page__hud-name/, "player name sits in the HUD identity cluster");
assert.match(gamePage, /game-page__opponent-rail/, "LeoBest hidden tiles sit between HUD and the felt");
assert.match(gamePage, /<OpponentPanel/, "opponent face-down tray is mounted");
assert.match(gamePage, /tilesOnly/, "opponent rail does not duplicate HUD identity");
assert.doesNotMatch(header, /OpponentPanel/, "opponent tiles are not inside the HUD header");
assert.match(gamePage, /game-page__seat-avatar/, "header shows compact seat avatars");
assert.match(gamePage, /<SeatScore/, "seat scores sit beside the two HUD avatars");
assert.match(gamePage, /data-hud-zone="human"/, "human score is its own HUD zone");
assert.match(gamePage, /data-hud-zone="match-points"/, "MATCH POINTS is the center HUD zone");
assert.match(gamePage, /data-hud-zone="rival"/, "LeoBest score is its own HUD zone");
assert.match(gamePage, /status=\{humanStatus\}/, "status pill lives on the felt");
assert.match(gamePage, /openingTurnStatus/, "forced opening replaces Your turn");
assert.match(gamePage, /mustPlayTileId=\{mustPlayTileId\}/, "only the required opener is marked");
assert.doesNotMatch(gamePage, /playerLabel=/, "name is not a full-width table banner");
assert.match(gamePage, /hideSeatNames/, "scoreboard does not repeat the full player name");
assert.match(gamePage, /<PlayerAvatar/, "HUD uses the selected player avatar");
assert.match(gamePage, /session\?\.displayName/, "HUD uses the account player name");
assert.doesNotMatch(gamePage, /t\("game\.you"\)/, "HUD does not hard-code You");
assert.match(bottomBar, /bottom-bar__center/, "hand occupies the dock center");
assert.match(gamePage, /<BottomBar[\s\S]*<PlayerPanel/, "Player 1 hand is in the Player 1 dock");
assert.doesNotMatch(gamePage, /endAbove/, "dock no longer hosts reserve");
assert.doesNotMatch(gamePage, /onPlay=\{handlePlay\}/, "Jwe handler not wired");
assert.doesNotMatch(gamePage, /onDraw=\{handleDraw\}/, "Tire handler not wired");
assert.match(gamePage, /handleReservePick/, "human reserve pick is wired");
assert.match(gamePage, /<ReservePicker/, "centered reserve picker mounts on the felt");
assert.match(gamePage, /pendingAiDraw/, "AI draws pause for a visible reserve presentation");
assert.match(gamePage, /confirmAiDraw/, "AI draw commits the engine's real tile");
assert.match(gamePage, /faceDown: true/, "AI draw flight stays face-down");
assert.match(gamePage, /left: 0/, "AI draw flight does not pass pip values");
assert.match(gamePage, /canDraw/, "reserve picker follows legal draw/pass rules");
assert.match(read("components/ReservePicker.jsx"), /watch/, "reserve picker has an AI watch mode");
assert.match(read("components/ReservePicker.jsx"), /data-reserve-draw-source/, "the actual AI draw tile is marked");
assert.match(read("components/ReservePicker.jsx"), /leoBestDrawing/, "AI draw copy is localized");
assert.doesNotMatch(read("components/ReservePicker.jsx"), /size="sm"/, "temporary reserve tiles are larger than HUD sm");
assert.doesNotMatch(gamePage, /runDrawSequence/, "automatic human draw sequence removed");
assert.match(gamePage, /canPass=\{isHumanTurn && actions\.canPass\}/, "Pase eligibility unchanged");

assert.match(avatar, /leoBestLionHud/, "LeoBest HUD uses the dedicated lion portrait");
assert.doesNotMatch(avatar, /logoIcon/, "LeoBest HUD is not the brand crest");
assert.match(avatars, /LEOBEST_AVATAR_ID/, "LeoBest has a dedicated avatar id");
assert.doesNotMatch(
  avatars.match(/PLAYER_AVATAR_IDS = Object\.freeze\(\[[\s\S]*?\]\)/)[0],
  /leobest-lion/,
  "LeoBest lion is not a selectable human avatar"
);
assert.match(gamePage, /tone="leoBest"/, "gameplay opponent uses the LeoBest avatar tone");
assert.match(gamePage, /t\("game\.leoBest"\)/, "opponent name stays LeoBest");
assert.match(gamePage, /showBrand=\{false\}/, "gameplay HUD does not mount the LeoDomino logo");
assert.match(gamePage, /handleHomeTap/, "Home opens the forfeit warning instead of leaving immediately");
assert.match(gamePage, /requestLeave\("home"\)/, "Home uses the shared abandon request");
assert.match(gamePage, /requestLeave\("new-match"\)/, "New Match uses the shared abandon request");
assert.match(gamePage, /onNewGame=\{handleNewMatchTap\}/, "dock New Match does not restart immediately");
assert.doesNotMatch(gamePage, /onNewGame=\{restart\}/, "dock New Match is not wired straight to restart");
assert.match(gamePage, /isMatchForfeitable/, "abandon warning uses the real forfeitable-match check");
assert.match(gamePage, /<AbandonMatchDialog/, "forfeit confirmation is mounted");
assert.match(gamePage, /abandonMatch\(\)/, "Leave Match records a forfeit then returns Home");
assert.match(read("components/AbandonMatchDialog.jsx"), /game\.leaveMatch/, "Leave Match is localized");
assert.match(read("components/AbandonMatchDialog.jsx"), /game\.abandonStartNewMatch/, "New Match confirm is localized");
assert.match(read("components/AbandonMatchDialog.jsx"), /common\.cancel/, "Cancel is localized");
assert.match(gamePage, /playerCount: state\.players\.length/, "layout sees 4-player matches");
assert.match(gamePage, /rulesetId: state\.rulesetId/, "layout sees American ruleset");
assert.match(
  read("pages/GamePage.css"),
  /\.game-page--players-4\[data-layout-density="short"\] \.game-page__chrome/,
  "4-player phone chrome is not locked to the 96px band"
);
assert.match(
  read("pages/GamePage.css"),
  /--game-hud-avatar/,
  "HUD avatar size is viewport-driven"
);
assert.match(
  read("pages/GamePage.css"),
  /width: var\(--game-hud-avatar/,
  "seat avatars use the layout avatar token"
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
