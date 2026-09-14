/**
 * Admin LeoPips referral boards: who invited whom, 0/3–3/3, ledger +100 proof.
 * Run: node src/online/adminLeopipsReferrals.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  aggregateLeoPipsReferrer,
  classifyLeoPipsReferralBackfillCandidate,
  hasLeoPipsReferralRewardProof,
  leoPipsReferralIssuedAmount,
  leoPipsReferralStatus,
  leoPipsRewardI18nKey,
  referralProgressLabel,
  searchLeoPipsReferrals,
  summarizeLeoPipsReferrals,
} from "./adminLeopipsOps.js";
import {
  fetchAdminLeopipsReferralUniverse,
  normalizeAdminLeopipsReferralPage,
} from "./adminLeopipsReads.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const panels = readFileSync(join(root, "src/pages/AdminLeopipsPanels.jsx"), "utf8");
const ops = readFileSync(join(root, "src/online/adminLeopipsOps.js"), "utf8");

function row(extras) {
  return {
    referralId: extras.referralId,
    inviter: {
      playerId: extras.referrerId || "a",
      displayName: extras.referrerName || "Ann",
      username: extras.referrerUser || "ann",
    },
    referred: {
      playerId: extras.referredId || "b",
      displayName: extras.referredName || "Bo",
      username: extras.referredUser || "bo",
    },
    qualifyingCount: extras.qualifyingCount ?? 0,
    progress: extras.progress ?? extras.qualifyingCount ?? 0,
    inviteWinStatus: extras.inviteWinStatus || "pending",
    validationStatus: extras.inviteWinStatus || "pending",
    rewarded: extras.rewarded === true,
    rewardAmount: extras.rewardAmount ?? null,
    rewardIdempotencyKey: extras.rewardIdempotencyKey || "",
    rewardCreatedAt: extras.rewardCreatedAt || null,
  };
}

{
  const mapping = normalizeAdminLeopipsReferralPage({
    referrals: [
      {
        referral_id: "r1",
        inviter: { player_id: "a", display_name: "Ann", username: "ann" },
        referred: { player_id: "b", display_name: "Bo", username: "bo" },
        qualifying_count: 1,
        progress: 1,
        rewarded: false,
      },
    ],
    summary: { total_referrals: 1 },
    total: 1,
  });
  assert.equal(mapping.referrals[0].inviter.username, "ann");
  assert.equal(mapping.referrals[0].referred.username, "bo");
  assert.equal(mapping.referrals[0].inviter.playerId, "a");
  console.log("  ✓ inviter → referred mapping is preserved");
}

{
  assert.equal(referralProgressLabel(0), "0 / 3");
  assert.equal(referralProgressLabel(1), "1 / 3");
  assert.equal(referralProgressLabel(2), "2 / 3");
  assert.equal(referralProgressLabel(3), "3 / 3");
  assert.equal(referralProgressLabel(16), "3 / 3");
  console.log("  ✓ 0/3 through 3/3 display; extra matches stay 3/3");
}

{
  const qualified = row({
    referralId: "q",
    qualifyingCount: 3,
    inviteWinStatus: "validated",
    rewarded: false,
  });
  assert.equal(leoPipsReferralStatus(qualified), "qualified");
  assert.equal(hasLeoPipsReferralRewardProof(qualified), false);
  assert.equal(leoPipsRewardI18nKey(qualified), "admin.referralRewardPending");
  assert.equal(leoPipsReferralIssuedAmount(qualified), 0);
  console.log("  ✓ 3/3 does not equal +100 issued, even if Invite & Win is validated");
}

{
  const issued = row({
    referralId: "c1748268-4d82-4d90-9459-8d15e553e4b2",
    qualifyingCount: 16,
    inviteWinStatus: "validated",
    rewarded: true,
    rewardAmount: 100,
    rewardIdempotencyKey: "referral_reward:c1748268-4d82-4d90-9459-8d15e553e4b2",
    rewardCreatedAt: "2026-09-04T01:11:12.634Z",
  });
  assert.equal(leoPipsReferralStatus(issued), "issued");
  assert.equal(hasLeoPipsReferralRewardProof(issued), true);
  assert.equal(leoPipsReferralIssuedAmount(issued), 100);
  console.log("  ✓ +100 issued requires referral_reward ledger amount 100");
}

{
  const fake = row({
    referralId: "x",
    qualifyingCount: 3,
    rewarded: true,
    rewardAmount: 50,
    rewardIdempotencyKey: "referral_reward:11111111-1111-4111-8111-111111111111",
  });
  assert.equal(hasLeoPipsReferralRewardProof(fake), false);
  const badKey = row({
    referralId: "y",
    qualifyingCount: 3,
    rewarded: true,
    rewardAmount: 100,
    rewardIdempotencyKey: "match_payout:abc",
  });
  assert.equal(hasLeoPipsReferralRewardProof(badKey), false);
  console.log("  ✓ wrong amount or key is not treated as +100 issued");
}

{
  const dup = [
    row({
      referralId: "same",
      qualifyingCount: 3,
      rewarded: true,
      rewardAmount: 100,
      rewardIdempotencyKey: "referral_reward:11111111-1111-4111-8111-111111111111",
    }),
    row({
      referralId: "same",
      qualifyingCount: 3,
      rewarded: true,
      rewardAmount: 100,
      rewardIdempotencyKey: "referral_reward:11111111-1111-4111-8111-111111111111",
    }),
  ];
  const summary = summarizeLeoPipsReferrals(dup);
  assert.equal(summary.issuedRewards, 1);
  assert.equal(summary.issuedAmount, 100);
  console.log("  ✓ duplicate +100 rows are not counted twice");
}

{
  const rows = [
    row({ referralId: "1", referrerUser: "theoudule", referrerName: "FEDSON", referredUser: "watson" }),
    row({ referralId: "2", referrerUser: "cass509", referredUser: "mezguerson23", referredName: "Wwwpapè" }),
  ];
  assert.deepEqual(searchLeoPipsReferrals(rows, "FEDSON").map((item) => item.referralId), ["1"]);
  assert.deepEqual(searchLeoPipsReferrals(rows, "mezguerson").map((item) => item.referralId), ["2"]);
  assert.equal(searchLeoPipsReferrals(rows, "theoudule")[0].referred.username, "watson");
  console.log("  ✓ search by inviter or referred player keeps who invited whom");
}

{
  const rows = [
    row({ referralId: "p", qualifyingCount: 1 }),
    row({ referralId: "q", qualifyingCount: 11, inviteWinStatus: "validated", rewarded: false }),
    row({
      referralId: "i",
      qualifyingCount: 16,
      rewarded: true,
      rewardAmount: 100,
      rewardIdempotencyKey: "referral_reward:11111111-1111-4111-8111-111111111111",
    }),
  ];
  const summary = summarizeLeoPipsReferrals(rows);
  assert.equal(summary.totalReferrals, 3);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.qualified, 2);
  assert.equal(summary.pendingRewards, 1);
  assert.equal(summary.issuedRewards, 1);
  assert.equal(summary.issuedAmount, 100);
  console.log("  ✓ summary counts match the same table source");
}

{
  const cashOnly = row({
    referralId: "legacy",
    qualifyingCount: 11,
    inviteWinStatus: "validated",
    rewarded: false,
  });
  assert.equal(leoPipsReferralStatus(cashOnly), "qualified");
  assert.equal(hasLeoPipsReferralRewardProof(cashOnly), false);
  assert.doesNotMatch(ops, /qualifying_match_count/);
  console.log("  ✓ legacy Invite & Win validated is not treated as a LeoPips +100 row");
}

{
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, "admin_list_leopips_referrals");
      if (args.p_offset === 0) {
        return Promise.resolve({
          data: {
            referrals: [
              { referral_id: "r", inviter: { player_id: "a" }, referred: { player_id: "b" }, progress: 2 },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { referrals: [], total: 1, limit: 50, offset: args.p_offset }, error: null });
    },
  };
  const universe = await fetchAdminLeopipsReferralUniverse(client);
  assert.equal(universe.length, 1);
  assert.ok(calls.length >= 1);
  console.log("  ✓ universe fetch pages the staff reader");
}

{
  const mine = [
    row({
      referralId: "1",
      referrerId: "fed",
      qualifyingCount: 16,
      rewarded: true,
      rewardAmount: 100,
      rewardIdempotencyKey: "referral_reward:11111111-1111-4111-8111-111111111111",
    }),
    row({ referralId: "2", referrerId: "fed", qualifyingCount: 1 }),
    row({ referralId: "3", referrerId: "other", qualifyingCount: 3 }),
  ];
  const agg = aggregateLeoPipsReferrer(mine, "fed");
  assert.equal(agg.totalReferred, 2);
  assert.equal(agg.issuedAmount, 100);
  assert.notEqual(agg.issuedAmount, agg.totalReferred * 100);
  console.log("  ✓ referrer earned LeoPips comes from ledger proof, not referrals × 100");
}

{
  const eligible = classifyLeoPipsReferralBackfillCandidate({
    qualifyingCount: 3,
    existingRewardRows: 0,
    inviterPlayerId: "a",
    inviterWallet: -5,
    inviterDeleted: false,
    referredDeleted: false,
  });
  assert.equal(eligible.eligibility, "PASS");
  assert.equal(eligible.proposedCredit, 100);
  assert.equal(eligible.projectedWallet, 95);
  const already = classifyLeoPipsReferralBackfillCandidate({
    qualifyingCount: 16,
    existingRewardRows: 1,
    inviterPlayerId: "a",
    inviterWallet: 1165,
    hasPlus100Ledger: true,
  });
  assert.equal(already.eligibility, "FAIL");
  assert.equal(already.reason, "already_rewarded");
  assert.equal(already.proposedCredit, 0);
  const tombstoned = classifyLeoPipsReferralBackfillCandidate({
    qualifyingCount: 11,
    existingRewardRows: 0,
    inviterPlayerId: "gone",
    inviterWallet: null,
    inviterDeleted: true,
    referredDeleted: false,
  });
  assert.equal(tombstoned.eligibility, "POLICY DECISION REQUIRED");
  assert.equal(tombstoned.reason, "deleted_or_tombstoned_party");
  const low = classifyLeoPipsReferralBackfillCandidate({
    qualifyingCount: 2,
    existingRewardRows: 0,
    inviterPlayerId: "a",
    inviterWallet: 50,
  });
  assert.equal(low.eligibility, "FAIL");
  assert.equal(low.reason, "below_threshold");
  console.log("  ✓ backfill candidate selection: eligible / already rewarded / tombstone / below 3");
}

{
  assert.match(panels, /fetchAdminLeopipsReferralUniverse/);
  assert.match(panels, /visibilitychange/);
  assert.match(panels, /ADMIN_PRESENCE_POLL_MS/);
  assert.match(panels, /data-admin-referral-summary/);
  assert.match(panels, /data-admin-referral-detail/);
  assert.match(panels, /data-admin-referral-created/);
  assert.match(panels, /inviteWinValidatedLegacy/);
  assert.match(panels, /summarizeLeoPipsReferrals\(searched\)/);
  assert.doesNotMatch(panels, /page\.summary\.rewarded/);
  console.log("  ✓ dashboard refetches without full reload and keeps summary separate from referrer drill-in");
}

console.log("  ✓ admin LeoPips referrals");
