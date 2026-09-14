/**
 * Isolation contract: live Find Match / gameplay must not import LeoPips modules.
 * Authenticated Home opens LeoPips stake UI; matchmaking still uses FindMatchPage.
 * Stake values stay local. Isolated LeoPipsWinOverlay stays preview-only.
 * Live winner celebration is LeoPipsVictoryOverlay in components/.
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

const gameplay = [
  "src/pages/FindMatchPage.jsx",
  "src/pages/OnlineGamePage.jsx",
  "src/online/matchmaking.js",
  "src/hooks/useOnlineMatch.js",
  "src/online/gameplayHandler.js",
];

for (const rel of gameplay) {
  const src = read(rel);
  // Preview package (`src/leopips/*`) stays out of live gameplay. Online wallet
  // event helpers under `src/online/leopips*` are allowed for settlement notify.
  assert.doesNotMatch(src, /from ["'][^"']*\/leopips\//, `${rel} must not import LeoPips preview package`);
  assert.doesNotMatch(src, /LeoPipsStakePage|LeoPipsHomePage|LeoPipsWinOverlay|leopips-preview/);
}

const app = read("src/App.jsx");
assert.match(app, /onFindMatch=\{\(\) => setPhase\("leopipsStake"\)\}/);
assert.match(app, /<LeoPipsAuthenticatedStake/);
assert.match(app, /<FindMatchPage/);
assert.match(app, /phase === "findMatch"/);
assert.match(app, /LeoPipsAuthenticatedHome/);
assert.doesNotMatch(app, /LeoPipsStakePage|LeoPipsWinOverlay|leopips-preview/);
assert.doesNotMatch(app, /from ["'][^"']*\/leopips\//);
assert.doesNotMatch(app, /_leopips_debit|_leopips_credit_match_payout/);

const wrapper = read("src/pages/LeoPipsAuthenticatedHome.jsx");
assert.match(wrapper, /LeoPipsHomePage/);
assert.match(wrapper, /isolated=\{false\}/);
assert.match(wrapper, /readMyLeoPipsWallet/);
assert.match(wrapper, /onFindMatch/);
assert.doesNotMatch(wrapper, /LeoPipsStakePage|LEOPIPS_STAKE_TIERS|canEnterLeoPipsFindMatch/);
assert.doesNotMatch(wrapper, /5240|5,240/);
assert.doesNotMatch(wrapper, /get_my_leopips_wallet/);
assert.doesNotMatch(wrapper, /LEOPIPS_HOME_PREVIEW|levelLabel|xpProgress|GOLD II|LVL 12|2,450/);

const stake = read("src/pages/LeoPipsAuthenticatedStake.jsx");
assert.match(stake, /LeoPipsStakePage/);
assert.match(stake, /isolated=\{false\}/);
assert.match(stake, /readMyLeoPipsWallet/);
assert.doesNotMatch(stake, /createMatchRequest|acceptMatchRequest|LeoPipsWinOverlay/);
assert.doesNotMatch(stake, /_leopips_debit|_leopips_credit|get_my_leopips_wallet/);
assert.match(stake, /useLeoPipsStakeRequestCounts/);
assert.match(stake, /requestCounts=/);

const findMatch = read("src/pages/FindMatchPage.jsx");
assert.match(findMatch, /createMatchRequest/);
assert.match(findMatch, /acceptMatchRequest/);
assert.match(findMatch, /lockedStyleId/);
assert.doesNotMatch(findMatch, /LEOPIPS_STAKE_TIERS|_leopips_debit/);
assert.match(findMatch, /lockedStakePips/);
assert.doesNotMatch(findMatch, /from ["'][^"']*\/leopips\//);

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
assert.match(preview, /onPlayOnline=\{\(\) => setScreen\("stake"\)\}/);
assert.doesNotMatch(preview, /readParam\("balance", "5240"\)/);
assert.doesNotMatch(preview, /from ["'].*App/);
assert.doesNotMatch(preview, /AuthProvider|useAuth/);

const previewVite = read("src/leopips/vite.preview.config.js");
assert.match(previewVite, /src\/leopips\/preview\.html/);
assert.doesNotMatch(previewVite, /leodomino-testers/);
assert.doesNotMatch(previewVite, /VitePWA|sentry/i);

const main = read("src/main.jsx");
assert.match(main, /import App from "\.\/App\.jsx"/);
assert.doesNotMatch(main, /leopips\/preview/);
assert.match(main, /AuthProvider/);

console.log("  ✓ live Find Match stays off LeoPips settlement; stake UI is local handoff only");
