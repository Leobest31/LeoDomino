/**
 * Staff-only LeoPips admin read RPC SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminLeopipsReadOperations.test.js
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260903170000_admin_leopips_read_operations.sql");
const staffSql = read("supabase/migrations/20260828280000_staff_roles.sql");

const priorLeo = [
  "supabase/migrations/20260903120000_leopips_wallet_foundation.sql",
  "supabase/migrations/20260903140000_leopips_stake_matchmaking_buckets.sql",
  "supabase/migrations/20260903150000_leopips_wallet_settlement_hardening.sql",
  "supabase/migrations/20260903160000_leopips_activation_settlement.sql",
];

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

function assertStaffReader(fn, { maxLimit } = {}) {
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /STABLE/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.match(fn, /staff required/);
  assert.match(fn, /ERRCODE = '42501'/);
  assert.match(fn, /public\.is_staff\('moderator'\)/);
  assert.doesNotMatch(fn, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.doesNotMatch(fn, /_leopips_apply\(|_leopips_credit|_leopips_debit|_leopips_timeout_penalty\(|_leopips_on_match_finished\(|_leopips_on_playing_start\(/);
  assert.doesNotMatch(fn, /email|phone|password|token|raw_user_meta_data|jwt/i);
  if (maxLimit) {
    assert.match(fn, new RegExp(`LEAST\\(GREATEST\\(COALESCE\\(p_limit, \\d+\\), 1\\), ${maxLimit}\\)`));
  }
}

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|CREATE INDEX/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
assert.doesNotMatch(sql, /INSERT INTO|UPDATE public\.|DELETE FROM/);
assert.doesNotMatch(sql, /auth\.users|SERVICE_ROLE|service_role_key/);
assert.doesNotMatch(sql, /TO anon;/);

for (const rel of priorLeo) {
  const before = read(rel);
  assert.match(before, /leopips|stake_pips|_leopips_/i);
}

{
  const live = sliceFn("admin_list_live_matches(");
  assertStaffReader(live, { maxLimit: 50 });
  assert.match(live, /p_limit integer DEFAULT 25/);
  assert.match(live, /p_offset integer DEFAULT 0/);
  assert.match(live, /'stake_pips', m\.stake_pips/);
  assert.match(live, /FROM public\.active_match_players/);
  assert.match(live, /THEN 'disconnected'/);
  assert.match(live, /THEN 'waiting'/);
  assert.match(live, /THEN 'live'/);
  assert.doesNotMatch(live, /COALESCE\(m\.stake_pips,\s*20\)/);
}

{
  const fn = sliceFn("admin_list_matches(");
  assertStaffReader(fn, { maxLimit: 50 });
  assert.match(fn, /p_search text DEFAULT NULL/);
  assert.match(fn, /p_stake_filter text DEFAULT NULL/);
  assert.match(fn, /p_from timestamptz DEFAULT NULL/);
  assert.match(fn, /ORDER BY COALESCE\(m\.finished_at, m\.created_at\) DESC/);
  assert.match(fn, /LIMIT safe_limit/);
  assert.match(fn, /OFFSET safe_offset/);
  assert.match(fn, /'stake_pips', m\.stake_pips/);
  assert.match(fn, /stake_filter = 'none' AND m\.stake_pips IS NULL/);
  assert.doesNotMatch(fn, /COALESCE\(m\.stake_pips,\s*20\)/);
}

{
  const fn = sliceFn("admin_get_match_leopips(");
  assertStaffReader(fn);
  assert.match(fn, /p_match_id uuid/);
  assert.match(fn, /'expected_pot'/);
  assert.match(fn, /FROM public\.leopips_ledger l/);
  assert.match(fn, /LIMIT 200/);
  assert.doesNotMatch(fn, /SELECT \*/);
}

{
  const fn = sliceFn("admin_get_leopips_overview(");
  assertStaffReader(fn);
  assert.match(fn, /'total_wallets'/);
  assert.match(fn, /'negative_wallets'/);
  assert.match(fn, /GROUP BY l\.reason/);
  assert.match(fn, /'initial_grant'|ledger/);
}

{
  const fn = sliceFn("admin_list_negative_leopips(");
  assertStaffReader(fn, { maxLimit: 50 });
  assert.match(fn, /w\.balance < 0/);
  assert.match(fn, /timeout_penalty/);
  assert.match(fn, /Negative balance is valid/);
}

{
  const fn = sliceFn("admin_list_leopips_stake_activity(");
  assertStaffReader(fn);
  assert.match(fn, /m\.stake_pips = 20/);
  assert.match(fn, /'null_stake'/);
  assert.doesNotMatch(fn, /COALESCE\(m\.stake_pips,\s*20\)/);
}

{
  const fn = sliceFn("admin_list_leopips_referrals(");
  assertStaffReader(fn, { maxLimit: 50 });
  assert.match(fn, /_leopips_count_qualifying_referral_matches/);
  assert.match(fn, /'referral_reward'/);
  assert.match(fn, /LEAST\(progress\.qualified_count, 3\)/);
  assert.doesNotMatch(fn, /qualifying_match_count/);
  assert.doesNotMatch(fn, /_evaluate_referral|_credit_referral_qualifying/);
}

{
  const fn = sliceFn("admin_list_timeout_penalties(");
  assertStaffReader(fn, { maxLimit: 50 });
  assert.match(fn, /reason = 'timeout_penalty'/);
  assert.match(fn, /anomaly_strike_3/);
  assert.match(fn, /amount IS DISTINCT FROM -5/);
  assert.match(fn, /strike 1 = -5, strike 2 = -5, no strike 3/);
}

{
  const fn = sliceFn("admin_list_leopips_anomalies(");
  assertStaffReader(fn);
  assert.match(fn, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)/);
  assert.match(fn, /missing_stake_debit/);
  assert.match(fn, /missing_payout/);
  assert.match(fn, /missing_refund/);
  assert.match(fn, /duplicate_payout/);
  assert.match(fn, /invalid_timeout_penalty/);
  assert.match(fn, /payout_inconsistent_with_stake/);
  assert.match(fn, /unstaked_or_friend_ledger/);
  assert.match(fn, /public_null_or_invalid_stake/);
  assert.match(fn, /interval '7 days'/);
}

{
  const fn = sliceFn("admin_list_open_match_requests(");
  assertStaffReader(fn, { maxLimit: 50 });
  assert.match(fn, /r\.status = 'open'/);
  assert.match(fn, /flag_public_null_stake/);
  assert.match(fn, /exact_style_stake_bucket/);
  assert.match(fn, /exact style \+ exact stake/);
}

{
  const fn = sliceFn("admin_get_player_leopips(");
  assertStaffReader(fn);
  assert.match(fn, /LIMIT 25/);
  assert.match(fn, /LIMIT 10/);
  assert.match(fn, /_leopips_count_qualifying_referral_matches/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_matches\(/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_match_leopips\(uuid\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_leopips_overview\(\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_negative_leopips\(integer, integer\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_leopips_stake_activity\(timestamptz, timestamptz\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_leopips_referrals\(text, integer, integer\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_timeout_penalties\(timestamptz, timestamptz, integer, integer\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_leopips_anomalies\(timestamptz, timestamptz, integer\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_list_open_match_requests\(integer, integer\) FROM PUBLIC, anon/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_player_leopips\(uuid\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_list_matches\(/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_leopips_overview\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_player_leopips\(uuid\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_list_open_match_requests\(integer, integer\) TO authenticated/);

assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);

const bytes = statSync(join(root, "supabase/migrations/20260903170000_admin_leopips_read_operations.sql")).size;
const sha = createHash("sha256").update(sql).digest("hex");
assert.ok(bytes > 1000, "migration file is present");
console.log(`  ✓ admin LeoPips read operations SQL contract (${bytes} bytes, sha256=${sha})`);
