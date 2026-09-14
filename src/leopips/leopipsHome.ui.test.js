/**
 * Isolated LeoPips Home preview UI contract (pre-premium redesign).
 * Live wiring: wallet + LVL/XP/rank in the status strip. Visual: approved League/status Home.
 * Run: node src/leopips/leopipsHome.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import {
  LEOPIPS_HOME_PREVIEW,
  LEOPIPS_PREVIEW_DEFAULT_BALANCE,
  LEOPIPS_REFERRAL_REWARD,
  LEOPIPS_TOP_REFERRAL_USD,
} from "./leopipsEconomy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const home = read("src/leopips/LeoPipsHomePage.jsx");
const css = read("src/leopips/LeoPipsHomePage.css");
const preview = read("src/leopips/preview.jsx");
const realHome = read("src/pages/HomePage.jsx");
const app = read("src/App.jsx");
const authHome = read("src/pages/LeoPipsAuthenticatedHome.jsx");

assert.match(home, /data-leopips-home="true"/);
assert.match(home, /data-leopips-isolated/);
assert.match(home, /import "\.\.\/pages\/HomePage\.css"/);
assert.doesNotMatch(home, /data-home-structure="premium-v1"/);
assert.doesNotMatch(home, /from ["'][^"']*HomePage\.jsx/);
assert.doesNotMatch(home, /useReferralInvite|useAuth|useFindMatchAvailability|globalRp|createMatchRequest/);
assert.doesNotMatch(home, /from ["'].*App/);

assert.match(home, /home__status/);
assert.match(home, /home__header/);
assert.match(home, /data-home-card="league"/);
assert.match(home, /data-home-card="leoBest"/);
assert.match(home, /data-home-nav="true"/);
assert.match(home, /LEOPIPS_COPY\.navLeague/);
assert.match(home, /LEOPIPS_COPY\.navPlay/);
assert.match(home, /LEOPIPS_COPY\.navStore/);
assert.match(home, /LEOPIPS_COPY\.navMenu/);
assert.doesNotMatch(home, /navLeaderboard|homeWordmarkCrown|homeCommunityBanner|homeIconGear|homeRankCrest/);
assert.doesNotMatch(home, /data-home-section="hero"|data-home-section="ranks"|data-home-section="community"/);

assert.match(home, /data-leopips-home-wallet/);
assert.match(home, /LeoPipsCoin/);
assert.match(home, /LEOPIPS_COPY\.currency/);
assert.match(home, /formatLeoPipsAmount\(clampLeoPipsBalance\(balance\)\)/);
assert.match(home, /data-leopips-home-level/);
assert.match(home, /data-progression-level/);
assert.match(home, /data-progression-rank/);
assert.match(home, /leopips-home__crest-frame/);
assert.match(home, /homeLeoBestLion/);
assert.match(home, /data-leopips-win-progress/);
assert.match(home, /progressionWinProgress/);
assert.match(home, /data-leopips-home-xp/);
assert.match(home, /data-progression-xp/);
assert.match(home, /formatLeoPipsAmount\(liveXp\)/);
assert.match(home, /isolated \? LEOPIPS_HOME_PREVIEW\.division : LEOPIPS_COPY\.progressComingSoon/);
assert.match(home, /isolated \? LEOPIPS_HOME_PREVIEW\.leagueFill : 0/);
assert.doesNotMatch(home, /level.*=.*available|available.*level/);
assert.doesNotMatch(home, /xpFill/);
assert.doesNotMatch(home, /2450 \/ 3000|xpNext/);

assert.match(home, /data-leopips-home-referral/);
assert.match(home, /LEOPIPS_COPY\.referralTitle/);
assert.match(home, /LEOPIPS_COPY\.referralAmount/);
assert.match(home, /data-leopips-home-top-referral/);
assert.match(home, /LEOPIPS_COPY\.topReferralPrize/);
assert.match(home, /data-leopips-home-play-online/);
assert.match(home, /onPlayOnline/);
assert.match(home, /data-home-cta="playVsLeoBest"/);
assert.match(home, /data-home-cta="inviteFriends"/);
assert.match(home, /data-home-card="challenge"/);

assert.equal(LEOPIPS_COPY.referralTitle, "Referral Reward");
assert.equal(LEOPIPS_COPY.referralAmount, "+100 LeoPips");
assert.match(LEOPIPS_COPY.referralHint, /3 online matches/);
assert.equal(LEOPIPS_REFERRAL_REWARD, 100);
assert.equal(LEOPIPS_COPY.topReferralPrize, "$63 US");
assert.equal(LEOPIPS_TOP_REFERRAL_USD, 63);
assert.equal(LEOPIPS_HOME_PREVIEW.level, 12);
assert.equal(LEOPIPS_COPY.xpProgress, "2,450");
assert.equal(LEOPIPS_COPY.levelLabel, "LVL 12");
assert.equal(LEOPIPS_COPY.levelPending, "LVL 0");
assert.equal(LEOPIPS_COPY.xpPending, "0");
assert.equal(LEOPIPS_COPY.progressPending, "—");
assert.equal(LEOPIPS_COPY.progressComingSoon, "Coming Soon");
assert.equal(LEOPIPS_COPY.rankBronze, "BRONZE");
assert.equal(LEOPIPS_COPY.maxLevel, "MAX LEVEL");

assert.doesNotMatch(home, /\$500/);
assert.doesNotMatch(css, /\$500/);
assert.doesNotMatch(LEOPIPS_COPY.topReferralPrize, /500/);
assert.doesNotMatch(home, /Win Rate|win rate|winRate/i);
assert.doesNotMatch(home, /\bRP\b|Global RP|globalRp|leoPoints|1,250 LP/);
assert.doesNotMatch(home, /home__lp-hero|home__stat-value--lp/);

assert.match(preview, /LeoPipsHomePage/);
assert.match(preview, /readParam\("screen", "home"\)/);
assert.match(preview, /onPlayOnline=\{\(\) => setScreen\("stake"\)\}/);
assert.doesNotMatch(preview, /isolated=\{false\}/);
assert.match(preview, /LEOPIPS_PREVIEW_DEFAULT_BALANCE/);
assert.equal(LEOPIPS_PREVIEW_DEFAULT_BALANCE, 1000);

assert.match(app, /LeoPipsAuthenticatedHome/);
assert.match(authHome, /isolated=\{false\}/);
assert.match(authHome, /readMyProgression/);
assert.match(authHome, /LevelUpOverlay/);
assert.doesNotMatch(authHome, /LEOPIPS_HOME_PREVIEW|GOLD II|LVL 12/);
assert.doesNotMatch(authHome, /displayName=|countryLabel=|rateAvailable=|onRate=/);

assert.match(realHome, /HOME_PREVIEW\.leoPoints/);
assert.doesNotMatch(realHome, /LeoPipsHomePage|from ["'].*leopips/);

assert.match(css, /leopips-home__wallet-coin/);
assert.match(css, /leopips-home__crest-frame/);
assert.match(css, /leopips-home__crest-lion/);
assert.match(css, /leopips-home__nameplate/);
assert.match(css, /leopips-home__divider/);
assert.match(css, /leopips-home__level-sub/);
assert.match(css, /leopips-home__cash-prize/);
assert.match(css, /overflow-x: hidden/);
assert.match(css, /flex: 1\.35 1 0/);
assert.match(home, /homeLeoBestLion/);
assert.doesNotMatch(css, /leopips-home--premium|data-home-structure|community-banner/);

const referralAt = home.indexOf("data-leopips-home-referral");
const cashAt = home.indexOf("data-leopips-home-top-referral");
const inviteAt = home.indexOf('data-home-cta="inviteFriends"');
assert.ok(referralAt > 0 && cashAt > referralAt, "Referral Reward appears before Top Referral");
assert.ok(inviteAt > cashAt, "Invite Friends follows the referral rewards");

console.log("  ✓ LeoPips Home preview UI contract (pre-premium)");
