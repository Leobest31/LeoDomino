/**
 * LeoPips wallet foundation SQL contract.
 * Reads the canonical migration file. Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsWalletFoundation.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const heldRel = "supabase/held/20260903120000_leopips_wallet_foundation.WITHHELD.sql";
const liveRel = "supabase/migrations/20260903120000_leopips_wallet_foundation.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const evaluate = readFileSync(join(root, "supabase/migrations/20260827180000_referral_foundation.sql"), "utf8");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true, "canonical migration file exists");
assert.equal(existsSync(join(root, heldRel)), false, "held WITHHELD copy must not remain as a second source");
assert.match(sql, /WITHHELD/);
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /\bDROP TABLE\b/);
assert.doesNotMatch(sql, /\bTRUNCATE\b/);
assert.doesNotMatch(sql, /\bDELETE FROM\b/);

assert.match(sql, /CREATE TABLE public\.player_leopips_wallets/);
assert.match(sql, /CREATE TABLE public\.leopips_ledger/);
assert.match(sql, /balance integer NOT NULL DEFAULT 0 CHECK \(balance >= 0\)/);
assert.match(sql, /CONSTRAINT leopips_ledger_player_idempotency UNIQUE \(player_id, idempotency_key\)/);
assert.match(sql, /leopips_ledger_initial_grant_once/);
assert.match(sql, /leopips_ledger_referral_reward_once/);
assert.match(sql, /leopips_ledger is immutable/);
assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.leopips_ledger/);
assert.match(sql, /amount = 1000/);
assert.match(sql, /amount = -5/);
assert.match(sql, /amount IN \(-20, -50, -100, -150\)/);

assert.match(sql, /'initial_grant'/);
assert.match(sql, /'match_stake'/);
assert.match(sql, /'match_payout'/);
assert.match(sql, /'timeout_penalty'/);
assert.match(sql, /'referral_reward'/);

assert.match(sql, /profiles_insert_leopips_wallet/);
assert.match(sql, /AFTER INSERT ON public\.profiles/);
assert.doesNotMatch(
  sql,
  /INSERT INTO public\.player_leopips_wallets \(player_id\)[\s\S]*SELECT id FROM public\.profiles/
);
assert.doesNotMatch(sql, /SELECT player_id[\s\S]*FROM public\.player_leopips_wallets[\s\S]*ORDER BY player_id/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.reconcile_leopips_initial_grants/);
assert.match(sql, /p\.deleted_at IS NULL/);
assert.match(sql, /LIMIT batch_size/);
assert.match(sql, /batch_size > 500/);

assert.match(sql, /p_stake IN \(20, 50, 100, 150\)/);
assert.match(sql, /wallet\.balance >= 20/);
assert.match(sql, /INSUFFICIENT_LEOPIPS/);
assert.match(sql, /FOR UPDATE/);
assert.match(sql, /ON CONFLICT \(player_id, idempotency_key\) DO NOTHING/);

{
  const apply = sliceFn("_leopips_apply(");
  assert.match(apply, /SECURITY DEFINER/);
  assert.match(apply, /SET search_path = public/);
  assert.match(apply, /FOR UPDATE/);
  assert.match(apply, /next_balance := wallet\.balance \+ p_amount/);
  assert.match(apply, /IF next_balance < 0/);
  const insertAt = apply.indexOf("INSERT INTO public.leopips_ledger");
  const updateAt = apply.indexOf("UPDATE public.player_leopips_wallets");
  assert.ok(insertAt > 0 && updateAt > insertAt, "ledger insert precedes wallet update");
  assert.doesNotMatch(apply, /auth\.uid\(\)/);
}

{
  const grant = sliceFn("_leopips_ensure_initial_grant(");
  assert.match(grant, /1000/);
  assert.match(grant, /'initial_grant'/);
}

{
  const recon = sliceFn("reconcile_leopips_initial_grants(");
  assert.match(recon, /require_service_role/);
  assert.match(recon, /deleted_at IS NULL/);
  assert.match(recon, /reason = 'initial_grant'/);
  assert.match(recon, /LIMIT batch_size/);
}

{
  const mine = sliceFn("get_my_leopips_wallet()");
  assert.match(mine, /caller uuid := auth\.uid\(\)/);
  assert.match(mine, /_leopips_ensure_initial_grant\(caller\)/);
  assert.doesNotMatch(mine, /p_balance|p_player|p_amount/);
  assert.match(mine, /ACCOUNT_DELETED/);
}

{
  const both = sliceFn("_leopips_debit_both_match_stakes(");
  assert.match(both, /DORMANT|require_service_role/);
  assert.match(both, /require_service_role/);
  assert.match(both, /_leopips_is_allowed_stake\(p_stake\)/);
  assert.match(both, /p_player_a < p_player_b/);
  assert.match(both, /FOR UPDATE/);
  assert.match(both, /reason = 'match_stake'/);
  assert.match(both, /first_staked IS NOT TRUE AND first_wallet\.balance < p_stake/);
  assert.match(both, /_leopips_debit_match_stake\(first_id/);
  assert.match(both, /_leopips_debit_match_stake\(second_id/);
  assert.match(both, /first_id = p_player_a/);
  assert.match(both, /Not wired into accept_match_request/);
}

{
  const timeout = sliceFn("_leopips_timeout_penalty(");
  assert.match(timeout, /require_service_role/);
  assert.match(timeout, /p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2/);
  assert.match(timeout, /-5/);
  assert.match(timeout, /timeout_penalty:' \|\| p_match_id::text \|\| ':' \|\| p_strike::text/);
  assert.doesNotMatch(timeout, /p_amount/);
}

{
  const payout = sliceFn("_leopips_credit_match_payout(");
  assert.match(payout, /require_service_role/);
  assert.match(payout, /p_outcome IS DISTINCT FROM 'normal_win'/);
  assert.match(payout, /reason = 'match_stake'/);
  assert.match(payout, /stake \* 2/);
  assert.match(payout, /'match_payout:' \|\| p_match_id::text/);
  assert.doesNotMatch(payout, /p_amount/);
  assert.match(payout, /abandon_payout_not_finalized|payout outcome not finalized/);
}

{
  const referral = sliceFn("_leopips_credit_referral_reward(");
  assert.match(referral, /require_service_role/);
  assert.doesNotMatch(referral, /referral_qualifying_matches/);
  assert.match(referral, /FROM public\.matches m/);
  assert.match(referral, /m\.finish_reason = 'completed'/);
  assert.match(referral, /m\.match_kind = 'public'/);
  assert.match(referral, /m\.finished_at >= row\.attributed_at/);
  assert.match(referral, /row\.status = 'rejected'/);
  assert.match(referral, /row\.referrer_id/);
  assert.match(referral, /'referral_reward:' \|\| p_referral_id::text/);
  assert.doesNotMatch(referral, /qualifying_match_count >= 10/);
}

assert.doesNotMatch(sql, /FROM public\.referral_qualifying_matches/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.settle_match_global_rp/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._evaluate_referral/);
assert.doesNotMatch(sql, /SET prize_amount_usd|prize_amount_usd\s*=/);
assert.match(evaluate, /qualifying_match_count >= 10/);
assert.match(evaluate, /CREATE OR REPLACE FUNCTION public\._evaluate_referral/);

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_my_leopips_wallet\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reconcile_leopips_initial_grants\(integer\) TO service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_debit_both_match_stakes/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_timeout_penalty/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_credit_match_payout/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_credit_referral_reward/);

const internalOnly = [
  "_leopips_apply",
  "_leopips_ensure_wallet",
  "_leopips_ensure_initial_grant",
  "profiles_insert_leopips_wallet",
  "_leopips_assert_can_enter_find_match",
  "_leopips_debit_match_stake",
  "_leopips_is_allowed_stake",
  "leopips_ledger_protect_immutable",
];
for (const name of internalOnly) {
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
  assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
}

assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_apply/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.reconcile_leopips_initial_grants\(integer\) TO authenticated/);
assert.doesNotMatch(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_debit_both_match_stakes\([^)]+\) TO authenticated/
);
assert.doesNotMatch(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_timeout_penalty\([^)]+\) TO authenticated/
);
assert.doesNotMatch(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_credit_match_payout\([^)]+\) TO authenticated/
);
assert.doesNotMatch(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_credit_referral_reward\([^)]+\) TO authenticated/
);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE public\.player_leopips_wallets/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE public\.leopips_ledger/);
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.player_leopips_wallets/);
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.leopips_ledger/);

const definerFns = [
  "_leopips_ensure_wallet(",
  "_leopips_apply(",
  "_leopips_ensure_initial_grant(",
  "profiles_insert_leopips_wallet()",
  "reconcile_leopips_initial_grants(",
  "get_my_leopips_wallet()",
  "_leopips_assert_can_enter_find_match(",
  "_leopips_debit_match_stake(",
  "_leopips_debit_both_match_stakes(",
  "_leopips_timeout_penalty(",
  "_leopips_credit_match_payout(",
  "_leopips_credit_referral_reward(",
];
for (const name of definerFns) {
  const body = sliceFn(name);
  assert.match(body, /SECURITY DEFINER/, `${name} is SECURITY DEFINER`);
  assert.match(body, /SET search_path = public/, `${name} pins search_path`);
}

assert.doesNotMatch(sql, /DROP TABLE public\.player_global_ratings/);
assert.doesNotMatch(sql, /DROP TABLE public\.match_rp_results/);
assert.doesNotMatch(sql, /FROM public\.player_global_ratings/);
assert.doesNotMatch(sql, /FROM public\.match_rp_results/);
assert.doesNotMatch(sql, /UPDATE public\.player_global_ratings/);
assert.doesNotMatch(sql, /PERFORM public\.settle_match_global_rp/);
assert.doesNotMatch(sql, /player_progression|player_xp|CREATE TABLE public\.player_levels/);
assert.doesNotMatch(sql, /level integer|xp integer/);

assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /player_id = \(SELECT auth\.uid\(\)\)/);
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR INSERT/);
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR UPDATE/);
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR DELETE/);
assert.match(sql, /REVOKE ALL ON TABLE public\.player_leopips_wallets FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /REVOKE ALL ON TABLE public\.leopips_ledger FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT SELECT ON TABLE public\.player_leopips_wallets TO authenticated/);
assert.match(sql, /GRANT SELECT ON TABLE public\.leopips_ledger TO authenticated/);
assert.match(sql, /GRANT SELECT ON TABLE public\.player_leopips_wallets TO service_role/);
assert.match(sql, /GRANT SELECT ON TABLE public\.leopips_ledger TO service_role/);

console.log("  ✓ LeoPips wallet foundation SQL contract (canonical migration)");
