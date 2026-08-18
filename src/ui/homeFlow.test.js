/**
 * V1 Home + Play vs LeoBest product flow.
 * Run: node src/ui/homeFlow.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOME_PROFILE, loadHomeProfile } from "../persistence/homeProfile.js";
import { listAvailableGameStyles } from "../data/gameStyles.js";
import { V1_PLAYER_COUNT } from "../game/v1Product.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const home = read("pages/HomePage.jsx");
const style = read("pages/GameStylePage.jsx");
const setup = read("pages/GameSetupPage.jsx");
const page = read("pages/GamePage.jsx");

assert.match(app, /"intro" \| "home" \| "gameStyle" \| "game"/, "App phases are Home-first");
assert.doesNotMatch(app, /GameSetupPage/, "obsolete Setup is not the live hub");
assert.match(app, /setPhase\("home"\)/, "splash and Main Menu return to Home");
assert.match(app, /onPlayVsLeoBest=\{\(\) => setPhase\("gameStyle"\)\}/, "Play vs LeoBest opens Game Style");
{
  const styleStart = app.indexOf("<GameStylePage");
  const styleEnd = app.indexOf("/>", styleStart) + 2;
  const styleMount = app.slice(styleStart, styleEnd);
  assert.match(styleMount, /onPlay=\{handlePlay\}/, "Game Style Play starts the match");
  const homeStart = app.indexOf("<HomePage");
  const homeEnd = app.indexOf("/>", homeStart) + 2;
  const homeMount = app.slice(homeStart, homeEnd);
  assert.doesNotMatch(homeMount, /handlePlay/, "Home does not start a match directly");
}

assert.match(home, /data-home="true"/, "Home screen mounts");
assert.match(home, /data-home-card="leoBest"/, "Play vs LeoBest card exists");
assert.match(home, /data-home-cta="playVsLeoBest"/, "LeoBest PLAY CTA exists");
assert.match(home, /data-home-card="league"/, "League hero card remains");
assert.match(home, /data-home-cta="league"/, "League CTA is present but not live");
assert.match(home, /showComingSoon/, "unimplemented actions show Coming Soon");
assert.match(home, /data-home-nav="true"/, "bottom navigation exists");
assert.match(home, /data-home-nav-item="play"/, "center PLAY routes to Game Style");
assert.match(home, /id="online"/, "Play Online card exists");
assert.match(home, /id="friend"/, "Play a Friend card exists");
assert.match(home, /id="private"/, "Private Table card exists");
assert.match(home, /id="tournaments"/, "Tournaments card exists");
assert.match(home, /id="store"/, "Store card exists");
assert.match(home, /loadHomeProfile/, "status strip is profile-ready");
assert.match(home, /home\.leoCoins/, "LeoCoins is architectural, not cash");
assert.doesNotMatch(home, /Add Cash|wager|deposit|withdraw|prize pool/i, "no real-money copy");
assert.doesNotMatch(home, /PLAYER_COUNTS/, "Home has no player-count selector");
assert.doesNotMatch(home, /t\("game\.playersN"/, "Home does not list 3P/4P");

assert.match(style, /V1_PLAYER_COUNT/, "Game Style initializes 1v1");
assert.match(style, /data-game-style-play/, "Game Style has a Play button");
assert.match(style, /onPlay\?\.\(/, "Play starts Human vs LeoBest");
assert.doesNotMatch(style, /PLAYER_COUNTS/, "no player-count selector");
assert.doesNotMatch(style, /t\("game\.playerCount/, "no player-count copy");
assert.doesNotMatch(style, /persistAndReturn/, "selecting a style does not leave the screen");
{
  const selectBlock = style.slice(
    style.indexOf("const handleSelect"),
    style.indexOf("const handlePlay")
  );
  assert.doesNotMatch(selectBlock, /onBack/, "style selection stays on Game Style");
}
assert.match(style, /listAvailableGameStyles/, "keeps current V1 Game Styles");

assert.equal(V1_PLAYER_COUNT, 2, "product player count is 1v1");
const styles = listAvailableGameStyles();
assert.ok(styles.length >= 5, "V1 Game Styles remain listed");
assert.ok(
  styles.every((entry) => entry.id !== "american" || entry.enabled === false),
  "withdrawn American is not a selectable V1 style"
);

assert.match(page, /game\.leoBest/, "table opponent is LeoBest");
assert.match(page, /<ReservePicker/, "reserve interaction remains");
assert.doesNotMatch(setup, /PLAYER_COUNTS/, "legacy Setup still has no 3P/4P chips");

assert.equal(DEFAULT_HOME_PROFILE.leoCoins, 250);
assert.equal(loadHomeProfile().leoCoins, 250);
assert.equal(loadHomeProfile().level, 1);

assert.doesNotMatch(home, /href=.*league|navigate.*store/i, "Coming Soon cards do not route to broken screens");

console.log("  ✓ Home + Play vs LeoBest flow contract");
