/**
 * Isolation contract: live App / Find Match must not import LeoPips yet.
 * Run: node src/leopips/leopipsIsolation.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const live = [
  "src/App.jsx",
  "src/main.jsx",
  "src/pages/FindMatchPage.jsx",
  "src/pages/OnlineGamePage.jsx",
  "src/pages/HomePage.jsx",
  "src/pages/GameStylePage.jsx",
  "src/online/matchmaking.js",
  "src/online/globalRp.js",
  "src/hooks/useOnlineMatch.js",
  "src/online/gameplayHandler.js",
];

for (const rel of live) {
  const src = read(rel);
  assert.doesNotMatch(src, /from ["'].*leopips/, `${rel} must not import LeoPips`);
  assert.doesNotMatch(src, /LeoPipsStakePage|LeoPipsHomePage|LeoPipsWinOverlay|leopips-preview/);
}

const app = read("src/App.jsx");
assert.match(app, /onFindMatch=\{\(\) => setPhase\("findMatch"\)\}/);
assert.doesNotMatch(app, /leoPipsStake|online-leopips/);
assert.match(app, /<FindMatchPage/);
assert.match(app, /phase === "findMatch"/);

const findMatch = read("src/pages/FindMatchPage.jsx");
assert.match(findMatch, /createMatchRequest/);
assert.match(findMatch, /acceptMatchRequest/);
assert.doesNotMatch(findMatch, /LEOPIPS_STAKE_TIERS|stake_pips/);

const indexHtml = read("index.html");
assert.match(indexHtml, /src="\/src\/main\.jsx"/);
assert.doesNotMatch(indexHtml, /leopips-preview|LeoPipsStakePage|LeoPipsHomePage/);

const vite = read("vite.config.js");
assert.doesNotMatch(vite, /leopips-preview/);
assert.doesNotMatch(vite, /vite\.preview\.config/);

const vercel = read("vercel.json");
assert.doesNotMatch(vercel, /leopips/i);

const preview = read("src/leopips/preview.jsx");
assert.match(preview, /LeoPipsHomePage/);
assert.match(preview, /screen === "home"/);
assert.match(preview, /readParam\("screen", "home"\)/);
assert.match(preview, /LEOPIPS_PREVIEW_DEFAULT_BALANCE/);
assert.doesNotMatch(preview, /readParam\("balance", "5240"\)/);
assert.doesNotMatch(preview, /from ["'].*App/);

const previewVite = read("src/leopips/vite.preview.config.js");
assert.match(previewVite, /src\/leopips\/preview\.html/);
assert.doesNotMatch(previewVite, /leodomino-testers/);
assert.doesNotMatch(previewVite, /VitePWA|sentry/i);

const main = read("src/main.jsx");
assert.match(main, /import App from "\.\/App\.jsx"/);
assert.doesNotMatch(main, /leopips\/preview/);

console.log("  ✓ live online path does not import LeoPips");
