/**
 * Admin LeoPips read-client contract. No network.
 * Run: node src/online/adminLeopipsReads.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  adminHistoryStatusKey,
  normalizeAdminHistoryMatch,
  normalizeAdminLeopipsOverview,
  normalizeAdminLeopipsReferralPage,
  normalizeAdminMatchLeopips,
  normalizeAdminNegativePage,
  normalizeAdminStakeActivity,
} from "./adminLeopipsReads.js";
import { adminExpectedPot, adminStakeLabel, referralProgressLabel } from "./adminLeopipsOps.js";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "adminLeopipsReads.js"), "utf8");

assert.doesNotMatch(source, /\.from\(/);
assert.doesNotMatch(source, /SERVICE_ROLE|_leopips_apply|_leopips_credit|_leopips_debit/);
assert.match(source, /rpc\(\s*"admin_list_matches"/);
assert.match(source, /rpc\(\s*"admin_get_match_leopips"/);
assert.match(source, /rpc\(\s*"admin_get_leopips_overview"/);
assert.match(source, /rpc\(\s*"admin_list_negative_leopips"/);
assert.match(source, /rpc\(\s*"admin_list_leopips_referrals"/);
assert.match(source, /rpc\(\s*"admin_get_player_leopips"/);
assert.match(source, /rpc\(\s*"admin_list_timeout_penalties"/);
assert.match(source, /rpc\(\s*"admin_list_leopips_anomalies"/);
assert.match(source, /rpc\(\s*"admin_list_open_match_requests"/);
assert.match(source, /rpc\(\s*"admin_list_leopips_stake_activity"/);

assert.equal(adminStakeLabel(null), null);
assert.equal(adminExpectedPot(20), 40);
assert.equal(referralProgressLabel(2), "2 / 3");
assert.equal(adminHistoryStatusKey("ready", null), "admin.statusReady");
assert.equal(adminHistoryStatusKey("finished", "join_timeout"), "admin.statusJoinTimeout");

{
  const match = normalizeAdminHistoryMatch({
    match_id: "11111111-1111-4111-8111-111111111111",
    player_a: { player_id: "a", display_name: "Ada", username: "ada" },
    player_b: { player_id: "b", display_name: "Bea", username: "bea" },
    ruleset_id: "haitian",
    match_kind: "friend",
    stake_pips: null,
    created_at: "2026-09-03T12:00:00.000Z",
    status: "finished",
    finish_reason: "completed",
  });
  assert.equal(match.stakePips, null);
  assert.equal(match.matchKind, "friend");
}

{
  const staked = normalizeAdminHistoryMatch({
    match_id: "11111111-1111-4111-8111-111111111111",
    player_a: { player_id: "a" },
    player_b: { player_id: "b" },
    stake_pips: 50,
    match_kind: "public",
  });
  assert.equal(staked.stakePips, 50);
}

{
  const detail = normalizeAdminMatchLeopips({
    found: true,
    match_id: "m",
    stake_pips: 20,
    expected_pot: 40,
    ledger: [{ id: "1", amount: -20, reason: "match_stake", idempotency_key: "k" }],
  });
  assert.equal(detail.expectedPot, 40);
  assert.equal(detail.ledger[0].reason, "match_stake");
}

{
  const overview = normalizeAdminLeopipsOverview({
    wallets: { total_wallets: 4, total_balance: 3900, negative_wallets: 1, min_balance: -5, max_balance: 1000 },
    ledger: { timeout_penalty: { count: 1, total_amount: -5 } },
  });
  assert.equal(overview.negativeWallets, 1);
  assert.equal(overview.minBalance, -5);
}

{
  const negative = normalizeAdminNegativePage({
    wallets: [{ player_id: "a", balance: -5, latest_reason: "timeout_penalty", timeout_penalty_latest: true }],
    total: 1,
  });
  assert.equal(negative.wallets[0].balance, -5);
  assert.equal(negative.wallets[0].timeoutPenaltyLatest, true);
}

{
  const stakes = normalizeAdminStakeActivity({
    totals: { 20: 2, 50: 1, 100: 0, 150: 0, null_stake: 4 },
    by_style: [{ ruleset_id: "legacy", 20: 2, 50: 0, 100: 0, 150: 0 }],
  });
  assert.equal(stakes.totals[20], 2);
  assert.equal(stakes.totals.nullStake, 4);
}

{
  const refs = normalizeAdminLeopipsReferralPage({
    referrals: [
      {
        referral_id: "r",
        inviter: { player_id: "i", username: "inv" },
        referred: { player_id: "n", username: "new" },
        qualifying_count: 2,
        progress: 2,
        rewarded: false,
        reward_amount: null,
        reward_idempotency_key: "",
        validation_status: "pending",
      },
    ],
    summary: { total_referrals: 1, pending: 1, rewarded: 0 },
    total: 1,
  });
  assert.equal(refs.referrals[0].progress, 2);
  assert.equal(refs.referrals[0].rewarded, false);
  assert.equal(refs.referrals[0].inviteWinStatus, "pending");
  assert.equal(referralProgressLabel(refs.referrals[0].progress), "2 / 3");
}

console.log("  ✓ Admin LeoPips read client contract");
