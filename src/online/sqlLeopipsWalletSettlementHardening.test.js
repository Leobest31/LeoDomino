/**
 * LeoPips settlement hardening SQL contract.
 * Reads the canonical migration file. Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsWalletSettlementHardening.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const heldRel = "supabase/held/20260903150000_leopips_wallet_settlement_hardening.WITHHELD.sql";
const liveRel = "supabase/migrations/20260903150000_leopips_wallet_settlement_hardening.sql";
const foundationRel = "supabase/migrations/20260903120000_leopips_wallet_foundation.sql";
const stage1Rel = "supabase/migrations/20260903140000_leopips_stake_matchmaking_buckets.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const foundation = readFileSync(join(root, foundationRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const heldDir = join(root, "supabase/held");

function sliceFn(name, source = sql) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true, "canonical settlement-hardening migration exists");
assert.equal(existsSync(join(root, heldRel)), false, "held WITHHELD copy must not remain as a second source");
assert.equal(
  existsSync(join(migrationsDir, "20260903150000_leopips_wallet_settlement_hardening.WITHHELD.sql")),
  false,
  "WITHHELD filename must not live in supabase/migrations"
);
assert.equal(
  readdirSync(migrationsDir).some((name) => name === "20260903150000_leopips_wallet_settlement_hardening.sql"),
  true,
  "settlement-hardening file is canonical in migrations/"
);
assert.equal(
  existsSync(join(heldDir, "20260903150000_leopips_wallet_settlement_hardening.WITHHELD.sql")),
  false,
  "1500 must not remain held after promotion"
);
assert.equal(existsSync(join(root, stage1Rel)), true, "Stage-1 canonical migration exists");
assert.equal(
  existsSync(join(heldDir, "20260903140000_leopips_stake_matchmaking_buckets.WITHHELD.sql")),
  false,
  "Stage-1 must not remain held after promotion"
);
assert.match(liveRel, /20260903150000/);
assert.ok("20260903150000" > "20260903140000", "timestamp after held Stage-1");
assert.ok("20260903150000" > "20260903120000", "timestamp after wallet foundation");

assert.match(sql, /WITHHELD/);
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /Do NOT touch 20260903120000/);
assert.match(sql, /20260903140000/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /\bDROP TABLE\b/);
assert.doesNotMatch(sql, /\bTRUNCATE\b/);
assert.doesNotMatch(sql, /\bALTER TABLE\b/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._evaluate_referral/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.settle_match_global_rp/);
assert.doesNotMatch(sql, /reconcile_leopips_initial_grants/);

{
  const apply = sliceFn("_leopips_apply(");
  const tombstoneAt = apply.indexOf("profile_deleted_at");
  const selectDeleted = apply.indexOf("SELECT p.deleted_at");
  const ensureAt = apply.indexOf("PERFORM public._leopips_ensure_wallet(p_player)");
  const insertAt = apply.indexOf("INSERT INTO public.leopips_ledger");
  const updateAt = apply.indexOf("UPDATE public.player_leopips_wallets");
  assert.ok(tombstoneAt > 0, "reads profiles.deleted_at");
  assert.ok(selectDeleted > 0 && selectDeleted < ensureAt, "tombstone check before ensure_wallet");
  assert.ok(ensureAt > selectDeleted && insertAt > ensureAt && updateAt > insertAt);
  assert.match(apply, /RAISE EXCEPTION 'ACCOUNT_DELETED' USING ERRCODE = 'P0001'/);
  assert.match(apply, /RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002'/);
  assert.match(apply, /IF profile_deleted_at IS NOT NULL/);
  assert.match(apply, /ON CONFLICT \(player_id, idempotency_key\) DO NOTHING/);
  assert.match(apply, /SECURITY DEFINER/);
  assert.match(apply, /SET search_path = public/);
  assert.doesNotMatch(apply, /auth\.uid\(\)/);
  assert.doesNotMatch(apply, /GRANT EXECUTE ON FUNCTION public\._leopips_apply/);
}

assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\._leopips_apply\(uuid, integer, text, text, uuid, uuid\) FROM PUBLIC, anon, authenticated, service_role/
);

{
  const stored = sliceFn("_leopips_debit_both_stored_match_stakes(");
  assert.match(stored, /_leopips_debit_both_stored_match_stakes\(p_match_id uuid\)/);
  assert.doesNotMatch(stored, /p_stake integer|p_amount integer|p_player_a uuid|p_player_b uuid/);
  assert.match(stored, /require_service_role/);
  assert.match(stored, /SECURITY DEFINER/);
  assert.match(stored, /SET search_path = public/);
  assert.match(stored, /FROM public\.matches m/);
  assert.match(stored, /m\.stake_pips/);
  assert.match(stored, /FOR UPDATE/);
  assert.match(stored, /FROM public\.match_requests r/);
  assert.match(stored, /r\.stake_pips/);
  assert.match(stored, /_leopips_is_allowed_stake\(stake\)/);
  assert.match(stored, /INVALID_LEOPIPS_STAKE/);
  assert.match(stored, /ACCOUNT_DELETED/);
  assert.match(stored, /deleted_at IS NOT NULL/);
  assert.match(stored, /_leopips_debit_both_match_stakes\(/);
  assert.match(stored, /match_player_a/);
  assert.match(stored, /match_player_b/);
  assert.match(stored, /Not wired into accept_match_request|DORMANT/);
  assert.doesNotMatch(stored.replace(/--[^\n]*/g, ""), /COALESCE\(\s*(m\.|r\.|match_row\.)?stake_pips\s*,\s*20/);
  const matchLock = stored.indexOf("FROM public.matches m");
  const requestLock = stored.indexOf("FROM public.match_requests r");
  const debit = stored.indexOf("_leopips_debit_both_match_stakes(");
  assert.ok(matchLock > 0 && requestLock > matchLock && debit > requestLock, "match then request then wallet debit");
}

assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_debit_both_stored_match_stakes\(uuid\) TO service_role/
);
assert.doesNotMatch(
  sql,
  /GRANT EXECUTE ON FUNCTION public\._leopips_debit_both_stored_match_stakes\(uuid\) TO authenticated/
);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\._leopips_debit_both_match_stakes\(uuid, uuid, uuid, integer\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/
);

assert.doesNotMatch(foundation, /_leopips_debit_both_stored_match_stakes/);
assert.doesNotMatch(sliceFn("_leopips_apply(", foundation), /profile_deleted_at|ACCOUNT_DELETED/);
assert.match(foundation, /CREATE OR REPLACE FUNCTION public\._leopips_apply\(/);
assert.match(foundation, /p_stake integer/);

console.log("  ✓ withheld LeoPips wallet settlement hardening SQL contract");
