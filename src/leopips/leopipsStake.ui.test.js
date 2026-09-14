/**
 * LeoPips stake page UI contract. Source scan — isolated from live Find Match.
 * Run: node src/leopips/leopipsStake.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import {
  LEOPIPS_POPULAR_STAKE,
  LEOPIPS_REFERRAL_REWARD,
  LEOPIPS_STAKE_TIERS,
  canEnterLeoPipsFindMatch,
  leoPipsPot,
  leoPipsStakeCardModel,
} from "./leopipsEconomy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("src/leopips/LeoPipsStakePage.jsx");
const css = read("src/leopips/LeoPipsStakePage.css");
const overlay = read("src/leopips/LeoPipsWinOverlay.jsx");
const overlayCss = read("src/leopips/LeoPipsWinOverlay.css");
const assets = read("src/leopips/leopipsAssets.js");
const economy = read("src/leopips/leopipsEconomy.js");

assert.match(page, /data-leopips-isolated=\{isolated \? "true" : "false"\}/);
assert.match(page, /isolated = true/);
assert.match(page, /data-leopips-enter=\{enter\}/);
assert.match(page, /data-leopips-plus="visual-only"/);
assert.match(page, /event\.preventDefault\(\)/);
assert.doesNotMatch(page, /showComingSoon|stripe|checkout|purchase|store/);
assert.doesNotMatch(page, /RULESET_STORAGE_KEY|writeStorage/);
assert.doesNotMatch(page, /createMatchRequest|acceptMatchRequest/);

for (const stake of LEOPIPS_STAKE_TIERS) {
  assert.match(page, /data-leopips-card=\{card\.stake\}/);
  assert.match(page, /data-leopips-play=\{card\.stake\}/);
  assert.match(page, /data-leopips-pot=\{card\.pot\}/);
  const card = leoPipsStakeCardModel(stake, 500);
  assert.equal(card.pot, leoPipsPot(stake));
}

assert.equal(leoPipsPot(150), 300);
assert.equal(leoPipsStakeCardModel(150, 500).potLabel, "300 LEOPIPS");

assert.match(page, /MOST POPULAR|LEOPIPS_COPY\.mostPopular/);
assert.match(page, /leopips-stake__requests/);
assert.match(page, /data-leopips-requests=\{stake\}/);
assert.equal(LEOPIPS_COPY.requests, "REQUESTS");
assert.equal(LEOPIPS_COPY.request, "REQUEST");
assert.match(css, /\.leopips-stake__requests/);
assert.match(css, /color: #ffffff/);
assert.match(css, /font-size: 0\.7rem/);
assert.match(css, /\.leopips-stake__card\.is-popular \.leopips-stake__requests/);
assert.doesNotMatch(page, /listJoinableOpenMatchRequests|subscribeMatchRequests/);
assert.equal(LEOPIPS_POPULAR_STAKE, 50);
assert.match(page, /data-leopips-popular=\{card\.popular \? "true" : "false"\}/);
assert.equal(leoPipsStakeCardModel(20, 500).potLabel, "40 LEOPIPS");
assert.equal(leoPipsStakeCardModel(50, 500).potLabel, "100 LEOPIPS");
assert.equal(leoPipsStakeCardModel(100, 500).potLabel, "200 LEOPIPS");
assert.equal(leoPipsStakeCardModel(150, 500).potLabel, "300 LEOPIPS");
assert.equal(leoPipsStakeCardModel(50, 500).popular, true);
assert.equal(leoPipsStakeCardModel(20, 500).popular, false);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(css, /overflow-x: hidden/);

assert.doesNotMatch(page, /LEOPIPS_PROGRESS_STEPS/);
assert.doesNotMatch(page, /data-leopips-step|leopips-stake__progress|leopips-stake__step/);
assert.doesNotMatch(css, /leopips-stake__progress|leopips-stake__step/);
assert.doesNotMatch(page, /Play Online/);
assert.doesNotMatch(page, /Find Match/);

assert.match(page, /data-leopips-tier-color=\{stakeTierColor\(card\.stake\)\}/);
assert.match(css, /\.leopips-stake__card--20/);
assert.match(css, /\.leopips-stake__card--50/);
assert.match(css, /\.leopips-stake__card--100/);
assert.match(css, /\.leopips-stake__card--150/);
assert.match(css, /data-leopips-card="20"|card--20[\s\S]*rgba\(61, 224, 140/);
assert.match(css, /card--20 \{[\s\S]*rgba\(61, 224, 140/);
assert.match(css, /card--50 \{[\s\S]*rgba\(123, 149, 255/);
assert.match(css, /card--100 \{[\s\S]*rgba\(192, 107, 255/);
assert.match(css, /card--150 \{[\s\S]*rgba\(232, 197, 71/);

assert.match(page, /leoPipsStyleTitle/);
assert.match(page, /CHANGE STYLE|LEOPIPS_COPY\.changeStyle/);
assert.match(page, /className="leopips-stake__change"/);
assert.match(page, /aria-haspopup="dialog"/);
assert.match(page, /handleToggleStyleMenu/);
assert.match(page, /data-leopips-style-menu/);
{
  const changeAt = css.indexOf(".leopips-stake__change {");
  const changeEnd = css.indexOf(".leopips-stake__change:focus-visible");
  const playAt = css.indexOf(".leopips-stake__play {");
  const playEnd = css.indexOf(".leopips-stake__play:disabled");
  assert.ok(changeAt >= 0 && changeEnd > changeAt);
  assert.ok(playAt >= 0 && playEnd > playAt);
  const changeBlock = css.slice(changeAt, changeEnd);
  const playBlock = css.slice(playAt, playEnd);
  assert.match(changeBlock, /width:\s*auto/);
  assert.match(changeBlock, /var\(--lp-emerald\)/);
  assert.match(changeBlock, /min-height:\s*2\.25rem/);
  assert.doesNotMatch(changeBlock, /(?<!max-)width:\s*100%/);
  assert.match(playBlock, /width:\s*100%/);
  assert.match(playBlock, /min-height:\s*2\.7rem/);
  assert.match(playBlock, /var\(--lp-emerald\)/);
}
assert.match(page, /LEOPIPS_STYLE_IDS/);
assert.match(page, /data-leopips-style-menu/);
assert.match(page, /data-leopips-style-option/);
assert.doesNotMatch(page, /nextLeoPipsStyleId/);
assert.match(page, /homeDominos/);
assert.match(economy, /HAITIAN DOMINO/);
assert.match(economy, /AMERICAN DOMINO/);

assert.match(page, /LEOPIPS_COPY\.insufficient/);
assert.match(page, /LEOPIPS_COPY\.friendsNote/);
assert.match(page, /data-leopips-friends/);
assert.doesNotMatch(page, /createFriendInvite|acceptFriendInvite/);
assert.equal(canEnterLeoPipsFindMatch(5), false);
assert.equal(canEnterLeoPipsFindMatch(75), true);

assert.match(page, /LEOPIPS_COPY\.fairPlayTitle/);
assert.match(page, /LEOPIPS_COPY\.winBigTitle/);
assert.match(page, /LEOPIPS_COPY\.playEarnTitle/);
assert.match(page, /LEOPIPS_COPY\.rulesNote/);
assert.doesNotMatch(page, /Your stake is safe|never lost|never lose/);
assert.doesNotMatch(LEOPIPS_COPY.rulesNote, /safe|never lost/);
assert.equal(LEOPIPS_COPY.rulesNote, "Every LeoPips match is fair, secure, and protected.");
assert.doesNotMatch(LEOPIPS_COPY.rulesNote, /server-authoritative/);
assert.match(read("src/leopips/leopipsCopy.js"), /server-authoritative/);

assert.doesNotMatch(page, /data-leopips-referral/);
assert.doesNotMatch(page, /leopips-stake__referral/);
assert.equal(LEOPIPS_REFERRAL_REWARD, 100);
assert.equal(LEOPIPS_COPY.referralTitle, "Referral Reward");
assert.equal(LEOPIPS_COPY.referralAmount, "+100 LeoPips");

assert.match(overlay, /Congratulations!|LEOPIPS_COPY\.congratulations/);
assert.match(overlay, /LEOPIPS_COPY\.bigWin/);
assert.match(overlay, /LEOPIPS_COPY\.continue/);
assert.match(overlay, /isLeoPipsBigWin\(payout\)/);
assert.match(overlay, /usePrefersReducedMotion/);
assert.match(overlayCss, /prefers-reduced-motion: reduce/);
assert.match(overlayCss, /leopips-win-pulse/);
assert.doesNotMatch(overlay, /\bcash\b|\bdollar\b/i);
assert.doesNotMatch(LEOPIPS_COPY.youWon(300), /\$|cash|dollar/i);
assert.doesNotMatch(LEOPIPS_COPY.winBigBody, /\$|cash|dollar/i);

const uiFiles = [page, css, overlay, overlayCss, economy];
for (const source of uiFiles) {
  assert.doesNotMatch(source, /Your stake is safe/i);
  assert.doesNotMatch(source, /never lost|never lose/i);
  assert.doesNotMatch(source, /\bcash\b/i);
  assert.doesNotMatch(source, /\bdollar\b/i);
  assert.doesNotMatch(source, /real money/i);
}

assert.match(assets, /leopips-coin-20\.webp/);
assert.match(assets, /leopips-coin-50\.webp/);
assert.match(assets, /leopips-coin-100\.webp/);
assert.match(assets, /leopips-coin-150\.webp/);
assert.doesNotMatch(assets, /leopips-coin-\d+\.png/);

for (const stake of LEOPIPS_STAKE_TIERS) {
  const webp = statSync(join(root, `src/assets/leopips/leopips-coin-${stake}.webp`));
  assert.ok(webp.size < 150 * 1024, `${stake} webp must stay under 150KB, got ${webp.size}`);
}

assert.equal(LEOPIPS_COPY.rulesNote.includes("never"), false);

console.log("  ✓ LeoPips stake UI contract");
