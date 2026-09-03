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

assert.match(page, /data-leopips-isolated="true"/);
assert.match(page, /data-leopips-enter=\{canEnter \? "ready" : "blocked"\}/);
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
assert.equal(LEOPIPS_POPULAR_STAKE, 50);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(css, /overflow-x: hidden/);

assert.match(page, /LEOPIPS_PROGRESS_STEPS/);
assert.match(page, /data-leopips-step=\{step\.id\}/);
assert.match(economy, /Play Online/);
assert.match(economy, /Choose Stake/);
assert.match(economy, /Find Match/);

assert.match(page, /leoPipsStyleTitle/);
assert.match(page, /CHANGE STYLE|LEOPIPS_COPY\.changeStyle/);
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
