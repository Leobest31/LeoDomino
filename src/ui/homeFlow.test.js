/**
 * V1 Home + Play vs LeoBest product flow.
 * Run: node src/ui/homeFlow.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOME_PROFILE, loadHomeProfile } from "../persistence/homeProfile.js";
import { listV1GameStyles } from "../data/gameStyles.js";
import { V1_PLAYER_COUNT } from "../game/v1Product.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const home = read("pages/HomePage.jsx");
const style = read("pages/GameStylePage.jsx");
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
assert.match(home, /onClick=\{playVsLeoBest\}/, "Play vs LeoBest keeps the live handler");
assert.match(home, /data-home-nav-item="menu"[\s\S]*openSettings/, "Menu opens Settings");
assert.match(home, /setSettingsOpen\(false\)/, "successful auth does not leave Settings open");
assert.match(home, /setProfileOpen\(false\)/, "successful auth does not leave Profile open");
assert.match(app, /key=\{session\?\.playerId/, "Home remounts from a clean auth session");
assert.match(home, /data-home-card="league"/, "League teaser card remains");
assert.match(home, /data-home-cta="league"/, "League CTA is present but not live");
assert.match(home, /showComingSoon/, "unimplemented actions show Coming Soon");
assert.match(home, /data-home-nav="true"/, "bottom navigation exists");
assert.match(home, /data-home-nav-item="play"/, "PLAY routes to Game Style");
assert.match(home, /data-home-nav-item="league"/, "League is a bottom-nav destination");
assert.match(home, /data-home-nav-item="store"/, "Store is a bottom-nav destination");
assert.match(home, /data-home-nav-item="menu"/, "Menu is a bottom-nav destination");
assert.match(home, /handlePlayOnline/, "Play Online has a dedicated future-activation handler");
assert.match(home, /ProfilePanel/, "Home opens player profile from the avatar");
assert.match(home, /openProfile/, "signed-in avatar opens Profile");
assert.match(home, /openLogin/, "signed-out profile opens Login");
assert.match(home, /data-home-cta="account"/, "Home has an account entry control");
assert.match(app, /AuthPage/, "Create Account / Login overlay is mounted from App");
assert.match(app, /authReady && !signedIn/, "Login waits until the cloud session has been restored");
assert.match(app, /phase === "home" && signedIn/, "Home is gated on a signed-in session");
assert.match(app, /phase === "gameStyle" && signedIn/, "Game Style is gated on a signed-in session");
assert.match(app, /phase === "game" && signedIn/, "the table is gated on a signed-in session");
{
  const authPage = read("pages/AuthPage.jsx");
  const provider = read("auth/AuthProvider.jsx");
  const config = read("i18n/config.js");
  assert.doesNotMatch(authPage, /closeAuth/, "logged-out users cannot dismiss Login onto Home");
  assert.match(authPage, /auth__forgot/, "forgot-password copy is visible");
  assert.doesNotMatch(authPage, /resetPassword|forgotPassword\(/, "forgot password does not pretend to work");
  assert.match(authPage, /PASSWORD_MIN_LENGTH/, "password rules use the current length requirement");
  assert.match(authPage, /LanguageSwitcher/, "Login uses the existing language selector");
  assert.match(authPage, /authEarthNight/, "Login uses the realistic night Earth asset");
  assert.match(authPage, /CountryPicker/, "Create Account includes a country picker");
  assert.match(authPage, /PLAYER_AVATARS/, "Create Account includes avatar choices");
  assert.match(authPage, /LEGAL_URLS/, "Login includes Terms and Privacy");
  assert.match(authPage, /isCloudAuth/, "password copy follows the active auth adapter");
  assert.match(authPage, /auth\.securityNote/, "cloud auth uses the protected-account note");
  assert.match(authPage, /auth\.localNote/, "local adapter keeps device-only account copy");
  assert.match(provider, /onAuthStateChange/, "AuthProvider observes Supabase auth-state changes");
  assert.match(provider, /setAuthView\("login"\)/, "logout returns immediately to Login");
  assert.match(config, /FIRST_LAUNCH_LOCALE = "en"/, "first-ever launch defaults to English");
}
assert.match(app, /"intro" \| "home" \| "gameStyle" \| "game"/, "App phases stay Home-first");
assert.match(home, /id="online"/, "Find Match card exists");
assert.match(home, /id="friend"/, "Play with a Friend card exists");
assert.match(home, /id="private"/, "Private Table is visible as a future shell");
assert.match(home, /id="tournaments"/, "Tournaments section is visible as a future shell");
assert.match(home, /id="store"/, "Store section is visible as a future shell");
assert.match(home, /HOME_PREVIEW/, "Figma layout numbers stay presentation-only");
assert.match(home, /home\.leoCoins/, "LeoCoins visual copy is restored");
assert.match(home, /home\.leoPoints/, "Leo Points visual copy is restored");
assert.match(home, /home\.playLeague/, "PLAY LEAGUE visual CTA is restored");
assert.doesNotMatch(home, /data-home-styles/, "Game Styles selector is not duplicated on Home");
assert.doesNotMatch(home, /data-home-style/, "Classic/Haitian/American Home cards are gone");
assert.doesNotMatch(home, /data-home-nav-item="friends"/, "Friends is not a bottom-nav destination");
assert.doesNotMatch(home, /data-home-nav-item="profile"/, "Profile is not a bottom-nav destination");
assert.doesNotMatch(home, /loadHomeProfile/, "Home does not show invented player stats");
assert.doesNotMatch(home, /Add Cash|wager|deposit|withdraw|prize pool/i, "no real-money copy");
assert.doesNotMatch(home, /PLAYER_COUNTS/, "Home has no player-count selector");
assert.doesNotMatch(home, /t\("game\.playersN"/, "Home does not list 3P/4P");
assert.doesNotMatch(home, /dominican|puertorican|allFives/, "Home Game Styles are Classic/Haitian/American only");

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
assert.match(style, /listV1GameStyles/, "V1 Game Style picker is Classic/Haitian/American");
assert.doesNotMatch(style, /listAvailableGameStyles/, "picker does not use the full engine catalog");

assert.equal(V1_PLAYER_COUNT, 2, "product player count is 1v1");
const styles = listV1GameStyles();
assert.deepEqual(
  styles.map((entry) => entry.id),
  ["classic", "haitian", "american"],
  "V1 picker shows Classic, Haitian, and American only"
);
assert.ok(
  styles.every((entry) => entry.enabled !== false && entry.available),
  "V1 picker styles are selectable"
);
assert.equal(
  styles.some((entry) => entry.id === "allFives" || entry.id === "dominican" || entry.id === "puertorican"),
  false,
  "All Fives, Dominican, and Puerto Rican are not in the V1 picker"
);

assert.match(page, /game\.leoBest/, "table opponent is LeoBest");
assert.match(page, /<ReservePicker/, "reserve interaction remains");

assert.equal(DEFAULT_HOME_PROFILE.leoCoins, 250);
assert.equal(loadHomeProfile().leoCoins, 250);
assert.equal(loadHomeProfile().level, 1);

assert.doesNotMatch(home, /href=.*league|navigate.*store/i, "Coming Soon cards do not route to broken screens");

{
  const homeCss = read("pages/HomePage.css");
  assert.match(homeCss, /--home-vvh/, "Home tracks the visual viewport height");
  assert.match(homeCss, /100svh/, "Home falls back to svh");
  assert.match(homeCss, /100dvh/, "Home falls back to dvh");
  assert.match(homeCss, /clamp\(/, "Home uses clamp() for compact portrait sizes");
  assert.match(
    homeCss,
    /env\(safe-area-inset-bottom/,
    "bottom navigation accounts for the iOS safe area"
  );
  assert.doesNotMatch(homeCss, /iPhone\s*16/i, "Home has no device-name CSS hacks");
  assert.doesNotMatch(
    homeCss,
    /\.home\s*\{[^}]*transform:\s*scale\(/,
    "Home is not globally scaled"
  );
}

console.log("  ✓ Home + Play vs LeoBest flow contract");
