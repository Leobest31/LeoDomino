/**
 * Authenticated LeoPips stake → existing Find Match handoff.
 * Stake is UI/test state only. No debit, payout, or SQL.
 * Run: node src/leopips/leopipsAuthenticatedStake.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEOPIPS_STAKE_TIERS,
  canEnterLeoPipsFindMatch,
  leoPipsEnabledStakes,
  leoPipsPot,
} from "./leopipsEconomy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("src/App.jsx");
const home = read("src/pages/LeoPipsAuthenticatedHome.jsx");
const stakePage = read("src/leopips/LeoPipsStakePage.jsx");
const wrapper = read("src/pages/LeoPipsAuthenticatedStake.jsx");
const findMatch = read("src/pages/FindMatchPage.jsx");
const matchmaking = read("src/online/matchmaking.js");
const preview = read("src/leopips/preview.jsx");

assert.match(app, /onFindMatch=\{\(\) => setPhase\("leopipsStake"\)\}/, "Home FIND MATCH opens LeoPips flow");
assert.match(app, /<LeoPipsAuthenticatedStake/);
assert.match(app, /onContinueToMatchmaking/);
assert.match(app, /setLeopipsPick\(\{ styleId, stake \}\)/);
assert.match(app, /setPhase\("findMatch"\)/);
assert.match(app, /lockedStyleId=\{leopipsPick\?\.styleId/);
assert.doesNotMatch(app, /lockedStyleId=\{leopipsPick\?\.stake/);
assert.match(app, /lockedStake=\{leopipsPick\?\.stake \?\? null\}/);
assert.doesNotMatch(app, /createMatchRequest\(/);
assert.doesNotMatch(app, /acceptMatchRequest\(/);

assert.match(home, /onFindMatch/);
assert.match(home, /if \(resumeOnline\) onEnterMatch/);
assert.doesNotMatch(home, /LeoPipsStakePage|setPhase\("findMatch"\)/);

assert.match(wrapper, /readMyLeoPipsWallet/);
assert.match(wrapper, /isolated=\{false\}/);
assert.match(wrapper, /onContinueToMatchmaking/);
assert.match(wrapper, /canAffordLeoPipsStake/);
assert.match(wrapper, /isLeoPipsStyleId/);
assert.doesNotMatch(wrapper, /5240|5,240|\?balance=/);
assert.doesNotMatch(wrapper, /createMatchRequest|acceptMatchRequest/);
assert.doesNotMatch(wrapper, /LeoPipsWinOverlay|youWon|_leopips_credit_match_payout/);
assert.doesNotMatch(wrapper, /\.rpc\(|get_my_leopips_wallet|_leopips_debit|_leopips_credit/);
assert.match(wrapper, /useLeoPipsStakeRequestCounts/);
assert.match(wrapper, /requestCounts=\{requestCounts\}/);
assert.match(wrapper, /onChangeStyle/);

assert.match(stakePage, /data-leopips-style-menu/);
assert.match(stakePage, /handleToggleStyleMenu/);
assert.doesNotMatch(stakePage, /nextLeoPipsStyleId/);
assert.match(stakePage, /onFindMatch\?\.\(\{ styleId: style, stake \}\)/);
assert.doesNotMatch(stakePage, /createMatchRequest|acceptMatchRequest|_leopips_debit/);

assert.match(findMatch, /lockedStyleId = ""/);
assert.match(findMatch, /data-find-match-style-picker=\{lockedId \? "hidden" : "visible"\}/);
assert.match(findMatch, /data-find-match-choose-style=\{lockedId \? "bypassed" : "visible"\}/);
assert.match(findMatch, /if \(lockedId\) return/);
assert.match(findMatch, /joinOrCreatePublicMatchRequest\(selectedId, lockedStakePips\)/);
assert.doesNotMatch(findMatch, /createMatchRequest\(selectedId, lockedStakePips\)/);
assert.match(findMatch, /createMatchRequest\(selectedId\)/);
assert.doesNotMatch(findMatch, /from ["'].*leopips/);
assert.doesNotMatch(findMatch, /leopipsPick|_leopips_debit/);
assert.match(findMatch, /case "RANKED_PAIR_LIMIT":\s*return "findMatch\.rankedPairLimit"/);
assert.match(findMatch, /acceptMatchRequest/);
assert.match(findMatch, /onBack\?\.\(\)/);
assert.match(findMatch, /onMainMenu\?\.\(\)/);

assert.match(app, /onBack=\{\(\) => setPhase\(leopipsPick \? "leopipsStake" : "home"\)\}/);
assert.match(app, /onBack=\{\(\) => setPhase\("home"\)\}/);
assert.match(wrapper, /onBack=\{\(\) => tap\(\(\) => onBack\?\.\(\)\)\}/);

assert.match(matchmaking, /export async function createMatchRequest\(styleId, stakeOrClient, client\)/);
assert.match(matchmaking, /stake_pips: stakePips/);
assert.doesNotMatch(matchmaking, /from ["'].*leopips|_leopips_debit|_leopips_credit/);
assert.match(matchmaking, /RANKED_PAIR_LIMIT/);
assert.match(matchmaking, /acceptMatchRequest/);

assert.match(preview, /LeoPipsWinOverlay/);
assert.doesNotMatch(app, /LeoPipsWinOverlay/);
assert.doesNotMatch(wrapper, /LeoPipsWinOverlay/);
assert.doesNotMatch(findMatch, /LeoPipsWinOverlay/);

assert.equal(canEnterLeoPipsFindMatch(5), false);
assert.deepEqual(leoPipsEnabledStakes(5), []);
assert.deepEqual(leoPipsEnabledStakes(20), [20]);
assert.deepEqual(leoPipsEnabledStakes(75), [20, 50]);
assert.deepEqual(leoPipsEnabledStakes(1000), [...LEOPIPS_STAKE_TIERS]);
assert.equal(leoPipsPot(20), 40);
assert.equal(leoPipsPot(50), 100);
assert.equal(leoPipsPot(100), 200);
assert.equal(leoPipsPot(150), 300);

const occupancy = [
  "supabase/migrations/20260902210000_sessions_then_matches_lock_order.sql",
  "supabase/migrations/20260902220000_shared_stale_occupancy_abort.sql",
];
for (const rel of occupancy) {
  assert.match(read(rel), /CREATE OR REPLACE FUNCTION/, rel);
}

console.log("  ✓ authenticated LeoPips stake hands off to existing Find Match");
