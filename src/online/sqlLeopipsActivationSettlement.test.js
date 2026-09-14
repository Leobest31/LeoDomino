/**
 * LeoPips activation settlement SQL contract.
 * Reads the canonical migration file. Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsActivationSettlement.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const heldRel = "supabase/held/20260903160000_leopips_activation_settlement.WITHHELD.sql";
const liveRel = "supabase/migrations/20260903160000_leopips_activation_settlement.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const heldDir = join(root, "supabase/held");
const foundation = readFileSync(join(root, "supabase/migrations/20260903120000_leopips_wallet_foundation.sql"), "utf8");
const edge = readFileSync(join(root, "supabase/functions/online-game/index.js"), "utf8");

function sliceFn(name, source = sql) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true, "canonical activation settlement migration exists");
assert.equal(existsSync(join(root, heldRel)), false, "held WITHHELD copy must not remain as a second source");
assert.equal(
  existsSync(join(migrationsDir, "20260903160000_leopips_activation_settlement.WITHHELD.sql")),
  false,
  "WITHHELD filename must not live in supabase/migrations"
);
assert.equal(
  readdirSync(migrationsDir).some((name) => name === "20260903160000_leopips_activation_settlement.sql"),
  true,
  "activation settlement file is canonical in migrations/"
);
assert.equal(
  existsSync(join(heldDir, "20260903160000_leopips_activation_settlement.WITHHELD.sql")),
  false,
  "1600 must not remain held after promotion"
);
assert.match(liveRel, /20260903160000/);
assert.ok("20260903160000" > "20260903150000", "timestamp after settlement hardening");
assert.match(sql, /WITHHELD/);
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /ALTER TABLE public\.(match_requests|matches)\b/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.install_online_game\(/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.commit_online_game_transition\(/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._evaluate_referral/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.settle_match_global_rp/);
assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|player_xp|player_levels/);
assert.match(sql, /DROP CONSTRAINT IF EXISTS player_leopips_wallets_balance_check/);
assert.match(sql, /DROP CONSTRAINT IF EXISTS leopips_ledger_balance_after_check/);
assert.doesNotMatch(sql, /insufficient_balance_floor_unresolved|unresolved_terminal_pot/);

{
  const start = sliceFn("_leopips_on_playing_start(");
  assert.match(start, /require_service_role/);
  assert.match(start, /m\.stake_pips/);
  assert.match(start, /friend_or_unstaked/);
  assert.match(start, /_leopips_debit_both_stored_match_stakes/);
  assert.doesNotMatch(start, /p_stake integer|p_amount integer/);
}

{
  const install = sliceFn("_leopips_install_online_game(");
  const debitAt = install.indexOf("PERFORM public._leopips_on_playing_start");
  const installAt = install.indexOf("RETURN public.install_online_game");
  assert.ok(debitAt > 0 && installAt > debitAt, "debit before install in same wrapper");
  assert.match(install, /require_service_role/);
}

{
  const refund = sliceFn("_leopips_refund_both_match_stakes(");
  assert.match(refund, /join_timeout/);
  assert.match(refund, /game_sessions/);
  assert.match(refund, /refund_stake:/);
  assert.match(refund, /correction/);
  assert.match(refund, /not_prestart_abort/);
  const refundBody = refund.slice(refund.indexOf("AS $$"), refund.indexOf("$$;"));
  assert.match(refundBody, /authoritative_loss/);
  assert.doesNotMatch(refundBody, /abandon_opponent/);
}

{
  const timeout = sliceFn("_leopips_on_timeout_strike(");
  assert.match(timeout, /p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2/);
  assert.match(timeout, /no_third_penalty/);
  assert.match(timeout, /_leopips_timeout_penalty/);
  assert.doesNotMatch(timeout, /insufficient_balance_floor_unresolved/);
  assert.doesNotMatch(timeout, /wallet_balance < 5/);
  assert.doesNotMatch(timeout, /timeout_penalty:' \|\| p_match_id::text \|\| ':3/);
}

{
  const apply = sliceFn("_leopips_apply(");
  assert.match(apply, /allow_negative := \(p_reason = 'timeout_penalty' AND p_amount = -5\)/);
  assert.match(apply, /INSUFFICIENT_LEOPIPS/);
  assert.match(apply, /ACCOUNT_DELETED/);
  assert.match(apply, /ON CONFLICT \(player_id, idempotency_key\) DO NOTHING/);
  assert.match(apply, /'duplicate', true/);
  assert.doesNotMatch(apply.replace(/--[^\n]*/g, ""), /allow_negative := true/);
}

{
  const commit = sliceFn("_leopips_commit_online_game_transition(");
  assert.match(commit, /p_action_type = 'timeout'/);
  assert.match(commit, /_leopips_on_timeout_strike/);
  assert.match(commit, /require_service_role/);
  const timeoutFn = sliceFn("_leopips_timeout_penalty(", foundation);
  assert.match(timeoutFn, /timeout_penalty:' \|\| p_match_id::text \|\| ':' \|\| p_strike::text/);
  assert.match(timeoutFn, /p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2/);
}

{
  const finished = sliceFn("_leopips_on_match_finished(");
  assert.match(finished, /forfeit_win/);
  assert.match(finished, /timeout_win/);
  assert.match(finished, /abandon_win/);
  assert.match(finished, /normal_win/);
  assert.match(finished, /match_winner_seat/);
  assert.match(finished, /_leopips_refund_both_match_stakes/);
  assert.doesNotMatch(finished, /unresolved_terminal_pot/);
}

{
  const referral = sliceFn("_leopips_credit_referral_reward(");
  assert.match(referral, /qualified_count < 3/);
  assert.match(referral, /required', 3/);
  assert.match(referral, /referral_reward:/);
  assert.doesNotMatch(referral, /prize_amount_usd|_evaluate_referral/);
  assert.match(sliceFn("_leopips_count_qualifying_referral_matches("), /match_kind, 'public'\) = 'public'/);
  assert.match(sliceFn("_leopips_count_qualifying_referral_matches("), /finish_reason = 'completed'/);
  assert.doesNotMatch(sliceFn("_leopips_count_qualifying_referral_matches("), /include_friend boolean := true/);
  assert.doesNotMatch(sliceFn("_leopips_count_qualifying_referral_matches("), /join_timeout|aborted/);
}

assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_install_online_game\(uuid, text, jsonb, jsonb, bigint\) TO service_role/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_on_playing_start\(uuid\) TO authenticated/);
assert.doesNotMatch(foundation, /_leopips_install_online_game|_leopips_on_match_finished/);

assert.match(edge, /_leopips_install_online_game/);
assert.match(edge, /_leopips_commit_online_game_transition/);
assert.match(edge, /isMissingRpcError/);
assert.match(edge, /LEOPIPS_INSTALL_REQUIRED/);
assert.match(edge, /install_online_game/);
assert.match(edge, /commit_online_game_transition/);

console.log("  ✓ LeoPips activation settlement SQL contract");
