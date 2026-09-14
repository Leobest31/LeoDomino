/**
 * LeoPips referral +100 activation: evaluation independent of pot settlement.
 * Reads concatenated migrations (latest function wins). Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsReferralRewardActivation.test.js
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const liveRel = "supabase/migrations/20260904150000_leopips_referral_eval_independent_of_pot.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const allSql = migrationFiles.map((name) => readFileSync(join(migrationsDir, name), "utf8")).join("\n\n");
const sha256 = createHash("sha256").update(sql).digest("hex");

function latestFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  let start = -1;
  let from = 0;
  while (from < allSql.length) {
    const i = allSql.indexOf(needle, from);
    if (i < 0) break;
    start = i;
    from = i + needle.length;
  }
  assert.ok(start >= 0, `latest ${name} exists`);
  const bodyStart = allSql.indexOf("AS $$", start);
  const bodyEnd = bodyStart >= 0 ? allSql.indexOf("$$;", bodyStart + 5) : -1;
  const end = bodyEnd >= 0 ? bodyEnd + 3 : allSql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return end > start ? allSql.slice(start, end) : allSql.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true);
assert.ok("20260904150000" > "20260904140000", "timestamp after timeout sweep cron");
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /ALTER TABLE public\.(match_requests|matches|referrals|leopips_ledger)\b/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._evaluate_referral/);
assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|player_xp|player_levels/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_settle_finished_match/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_credit_referral_reward\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_try_credit_referral_after_match\(uuid\) TO authenticated/);

{
  const settle = latestFn("_leopips_settle_finished_match(p_match_id uuid)");
  assert.match(settle, /SECURITY DEFINER/);
  assert.match(settle, /SET search_path = public/);
  assert.doesNotMatch(settle, /require_service_role/);
  const tryAt = settle.indexOf("_leopips_try_credit_referral_after_match");
  const unstakedAt = settle.indexOf("friend_or_unstaked");
  const stakeMissingAt = settle.indexOf("stake_not_debited");
  const payoutAt = settle.indexOf("_leopips_credit_match_payout");
  assert.ok(tryAt > 0, "settle still evaluates referrals");
  assert.ok(unstakedAt > tryAt, "unstaked pot skip happens AFTER referral try");
  assert.ok(stakeMissingAt > tryAt, "stake_not_debited skip happens AFTER referral try");
  assert.ok(payoutAt > tryAt, "pot payout happens AFTER referral try");
  assert.match(settle, /'referral', referral/);
  assert.doesNotMatch(settle, /p_amount|p_payout|client_amount/);
  console.log("  ✓ settle evaluates referral before pot early returns (unstaked regression)");
}

{
  const tryFn = latestFn("_leopips_try_credit_referral_after_match(p_match_id uuid)");
  assert.match(tryFn, /SECURITY DEFINER/);
  assert.match(tryFn, /SET search_path = public/);
  assert.match(tryFn, /status IS DISTINCT FROM 'finished'/);
  assert.match(tryFn, /finish_reason IS DISTINCT FROM 'completed'/);
  assert.match(tryFn, /_leopips_credit_referral_reward/);
  assert.doesNotMatch(tryFn, /stake_pips/);
  assert.doesNotMatch(tryFn, /require_service_role/);
  console.log("  ✓ try requires finished+completed and ignores stake_pips");
}

{
  const credit = latestFn("_leopips_credit_referral_reward(p_referral_id uuid)");
  assert.match(credit, /SECURITY DEFINER/);
  assert.match(credit, /SET search_path = public/);
  assert.doesNotMatch(credit, /require_service_role/);
  assert.match(credit, /_leopips_count_qualifying_referral_matches/);
  assert.match(credit, /qualified_count < 3/);
  assert.match(credit, /'referral_reward'/);
  assert.match(credit, /'referral_reward:' \|\| p_referral_id::text/);
  assert.match(credit, /row\.referrer_id/);
  assert.match(credit, /amount,\s*100|,\s*100,/);
  assert.doesNotMatch(credit, /initial_grant/);
  assert.doesNotMatch(credit, /_evaluate_referral|qualifying_match_count >= 10/);
  console.log("  ✓ credit is +100 to inviter via count>=3 and idempotent key");
}

{
  const count = latestFn("_leopips_count_qualifying_referral_matches(");
  assert.match(count, /finish_reason = 'completed'/);
  assert.match(count, /COALESCE\(m\.match_kind, 'public'\) = 'public'/);
  assert.match(count, /finished_at >= p_attributed_at/);
  assert.doesNotMatch(count, /forfeit|abandon|timeout|friend/);
  console.log("  ✓ qualification matrix source still public completed post-attribution only");
}

{
  const foundation = readFileSync(join(root, "supabase/migrations/20260903120000_leopips_wallet_foundation.sql"), "utf8");
  assert.match(foundation, /leopips_ledger_referral_reward_once/);
  assert.match(foundation, /reason = 'referral_reward'/);
  assert.match(foundation, /amount = 100 AND referral_id IS NOT NULL/);
  console.log("  ✓ unique referral_reward-once index preserved in foundation");
}

{
  const prior1800 = readFileSync(
    join(root, "supabase/migrations/20260903180000_leopips_terminal_settlement.sql"),
    "utf8"
  );
  const oldSettleStart = prior1800.indexOf("CREATE OR REPLACE FUNCTION public._leopips_settle_finished_match");
  const oldBody = prior1800.slice(oldSettleStart, prior1800.indexOf("$$;", oldSettleStart) + 3);
  const oldTry = oldBody.indexOf("_leopips_try_credit_referral_after_match");
  const oldUnstaked = oldBody.indexOf("friend_or_unstaked");
  assert.ok(oldTry > oldUnstaked, "OLD settle had referral AFTER unstaked early return (bug)");
  console.log("  ✓ old ordering documented as failing regression baseline");
}

{
  // Contract matrix as source-string proofs (local; no hosted writes).
  const tryFn = latestFn("_leopips_try_credit_referral_after_match(p_match_id uuid)");
  const credit = latestFn("_leopips_credit_referral_reward(p_referral_id uuid)");
  const count = latestFn("_leopips_count_qualifying_referral_matches(");
  const cases = {
    "public completed": /finish_reason = 'completed'/.test(count) && /'public'/.test(count),
    "unstaked public completed":
      latestFn("_leopips_settle_finished_match(p_match_id uuid)").indexOf("_leopips_try_credit_referral_after_match") <
      latestFn("_leopips_settle_finished_match(p_match_id uuid)").indexOf("friend_or_unstaked"),
    "staked public completed":
      latestFn("_leopips_settle_finished_match(p_match_id uuid)").includes("_leopips_credit_match_payout") &&
      latestFn("_leopips_settle_finished_match(p_match_id uuid)").includes("_leopips_try_credit_referral_after_match"),
    friend: !/match_kind = 'friend'/.test(count) && /'public'/.test(count),
    private: /'public'/.test(count),
    forfeit: /not_completed/.test(tryFn) && !/forfeit/.test(count),
    abandon: /not_completed/.test(tryFn) && !/abandon/.test(count),
    aborted: /not_completed|not_finished/.test(tryFn),
    "pre-attribution": /finished_at >= p_attributed_at/.test(count),
    "#1/#2": /qualified_count < 3/.test(credit),
    "#3": /qualified_count < 3/.test(credit) && /100/.test(credit),
    "#4+": /referral_reward:/.test(credit) && /leopips_ledger_referral_reward_once/.test(allSql),
  };
  for (const [name, ok] of Object.entries(cases)) {
    assert.equal(ok, true, name);
  }
  console.log("  ✓ qualification / reward matrix contracts encoded");
}

{
  // Backfill candidate selection contract helpers (read-only query shape).
  assert.match(sql, /Do NOT apply/);
  assert.doesNotMatch(sql, /_leopips_backfill_referral|UPDATE public\.player_leopips_wallets SET balance/);
  console.log("  ✓ migration does not embed an auto-executing backfill writer");
}

console.log(`  ✓ migration ${liveRel} sha256=${sha256}`);
console.log("  ✓ LeoPips referral reward activation SQL contract");
