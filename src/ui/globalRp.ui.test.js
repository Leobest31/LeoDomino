/**
 * Global RP Profile + MatchOver UI contract.
 * Run: node src/ui/globalRp.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const profile = read("components/ProfilePanel.jsx");
const modal = read("components/MatchOverModal.jsx");
const onlinePage = read("pages/OnlineGamePage.jsx");
const gamePage = read("pages/GamePage.jsx");
const service = read("online/globalRp.js");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");

assert.match(profile, /data-global-rp="true"/);
assert.match(profile, /profile\.globalRanking/);
assert.match(profile, /profile\.globalRank/);
assert.match(profile, /profile\.rpAmount/);
assert.match(profile, /data-global-rp-rank/);
assert.match(profile, /data-global-rp-value/);
assert.match(profile, /data-global-rp-matches/);
assert.match(profile, /data-global-rp-wins/);
assert.match(profile, /data-global-rp-losses/);
assert.match(profile, /data-global-rp-winrate/);
assert.match(profile, /getMyGlobalRating/);
assert.match(profile, /subscribeGlobalRatingRefresh/);
assert.match(profile, /profile\.ratingUnavailable/);
assert.match(profile, /ratingStatus === "unavailable"/);
assert.doesNotMatch(profile, /1250/);
assert.doesNotMatch(profile, /leoBest|loadHomeProfile|leagueLp|leoCoins/i);
assert.doesNotMatch(profile, /rp:\s*1000|fallback.*1000|DEFAULT_RP/);

assert.match(modal, /globalRp\?\.kind === "rated"/);
assert.match(modal, /matchOver\.rpDelta/);
assert.match(modal, /matchOver\.rpRange/);
assert.match(modal, /globalRp\?\.kind === "unrated"/);
assert.match(modal, /matchOver\.unratedFriend/);
assert.match(modal, /matchOver\.rpUnchanged/);
assert.match(modal, /signedDeltaLabel\(globalRp\.delta/);
assert.doesNotMatch(modal, /POWER\(|K\s*=\s*32|expectedScore/);

assert.match(onlinePage, /fetchSettledMatchRpResult/);
assert.match(onlinePage, /matchRpDisplayFromResult/);
assert.match(onlinePage, /notifyGlobalRatingRefresh/);
assert.match(onlinePage, /isOnlineMatchAborted/);
assert.match(onlinePage, /globalRp=\{matchRp\}/);
assert.match(onlinePage, /display\.kind === "rated"/);

{
  const modalMount = gamePage.slice(gamePage.indexOf("<MatchOverModal"), gamePage.indexOf("/>", gamePage.indexOf("<MatchOverModal")) + 2);
  assert.doesNotMatch(modalMount, /globalRp/);
  assert.doesNotMatch(gamePage, /getMatchRpResult|fetchSettledMatchRpResult|getMyGlobalRating/);
}

assert.match(en, /globalRanking: "Global Ranking"/);
assert.match(en, /ratingUnavailable: "Rating unavailable"/);
assert.match(en, /unratedFriend: "Unrated Friend Match"/);
assert.match(en, /rpUnchanged: "RP unchanged"/);
assert.match(ht, /globalRanking:/);
assert.match(service, /rpc\("get_my_global_rating"\)/);
assert.doesNotMatch(service, /POWER\(|10\^\(/);

console.log("  ✓ Global RP UI contract");
