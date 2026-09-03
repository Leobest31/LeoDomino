/**
 * Isolated LeoPips Home preview UI contract.
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

assert.match(home, /data-leopips-home="true"/);
assert.match(home, /data-leopips-isolated="true"/);
assert.match(home, /import "\.\.\/pages\/HomePage\.css"/);
assert.doesNotMatch(home, /from ["'][^"']*HomePage\.jsx/);
assert.doesNotMatch(home, /useReferralInvite|useAuth|useFindMatchAvailability|globalRp|createMatchRequest/);
assert.doesNotMatch(home, /from ["'].*App/);

assert.match(home, /data-leopips-home-wallet/);
assert.match(home, /LeoPipsCoin/);
assert.match(home, /LEOPIPS_COPY\.currency/);
assert.match(home, /formatLeoPipsAmount\(available\)/);
assert.match(home, /data-leopips-home-level/);
assert.match(home, /LEOPIPS_COPY\.levelLabel/);
assert.match(home, /data-leopips-home-xp/);
assert.match(home, /LEOPIPS_COPY\.xpProgress/);
assert.match(home, /LEOPIPS_HOME_PREVIEW\.xpFill/);
assert.doesNotMatch(home, /level.*=.*available|available.*level/);

assert.match(home, /data-leopips-home-referral/);
assert.match(home, /LEOPIPS_COPY\.referralTitle/);
assert.match(home, /LEOPIPS_COPY\.referralAmount/);
assert.match(home, /data-leopips-home-top-referral/);
assert.match(home, /LEOPIPS_COPY\.topReferralPrize/);
assert.match(home, /LEOPIPS_COPY\.topReferralEyebrow/);
assert.match(home, /data-leopips-home-play-online/);
assert.match(home, /onPlayOnline/);
assert.match(home, /data-home-card="leoBest"/);
assert.match(home, /data-home-card="league"/);
assert.match(home, /data-home-nav="true"/);

assert.equal(LEOPIPS_COPY.referralTitle, "Referral Reward");
assert.equal(LEOPIPS_COPY.referralAmount, "+100 LeoPips");
assert.equal(LEOPIPS_REFERRAL_REWARD, 100);
assert.equal(LEOPIPS_COPY.topReferralPrize, "$63 US");
assert.equal(LEOPIPS_TOP_REFERRAL_USD, 63);
assert.equal(LEOPIPS_HOME_PREVIEW.level, 12);
assert.equal(LEOPIPS_COPY.xpProgress, "2,450 / 3,000");
assert.equal(LEOPIPS_COPY.levelLabel, "LVL 12");

assert.doesNotMatch(home, /\$500/);
assert.doesNotMatch(css, /\$500/);
assert.doesNotMatch(LEOPIPS_COPY.topReferralPrize, /500/);
assert.doesNotMatch(home, /Win Rate|win rate|winRate/i);
assert.doesNotMatch(home, /\bRP\b|Global RP|globalRp|leoPoints|1,250 LP/);
assert.doesNotMatch(home, /home__lp-hero|home__stat-value--lp/);

assert.match(preview, /LeoPipsHomePage/);
assert.match(preview, /readParam\("screen", "home"\)/);
assert.match(preview, /screen === "stake"/);
assert.match(preview, /inspect/);
assert.match(preview, /win/);
assert.match(preview, /onPlayOnline=\{\(\) => setScreen\("stake"\)\}/);
assert.match(preview, /onBack=\{\(\) => setScreen\("home"\)\}/);
assert.match(preview, /LEOPIPS_PREVIEW_DEFAULT_BALANCE/);
assert.match(preview, /readParam\("balance", String\(LEOPIPS_PREVIEW_DEFAULT_BALANCE\)\)/);
assert.match(preview, /balance=5240/);
assert.equal(LEOPIPS_PREVIEW_DEFAULT_BALANCE, 1000);
assert.doesNotMatch(preview, /readParam\("balance", "5240"\)/);

assert.doesNotMatch(realHome, /LeoPipsHomePage|from ["'].*leopips/);
assert.doesNotMatch(app, /LeoPipsHomePage|screen=home/);
assert.match(realHome, /HOME_PREVIEW\.leoPoints/);
assert.match(app, /<HomePage/);

assert.match(css, /leopips-home__wallet-coin/);
assert.match(css, /leopips-home__cash-prize/);
assert.match(css, /overflow-x: hidden/);
assert.match(css, /font-size: 10px/);
assert.match(css, /font-size: 15px/);
assert.doesNotMatch(css, /font-size: 22px/);
assert.doesNotMatch(css, /font-size: 8px/);

const referralAt = home.indexOf("data-leopips-home-referral");
const cashAt = home.indexOf("data-leopips-home-top-referral");
const inviteAt = home.indexOf("data-home-cta=\"inviteFriends\"");
assert.ok(referralAt > 0 && cashAt > referralAt, "Referral Reward appears before Top Referral");
assert.ok(inviteAt > cashAt, "Invite Friends follows the referral rewards");

console.log("  ✓ LeoPips Home preview UI contract");
