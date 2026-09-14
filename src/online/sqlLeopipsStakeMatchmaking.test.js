/**
 * LeoPips stake + style matchmaking buckets SQL contract.
 * Reads the canonical migration file. Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsStakeMatchmaking.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const heldRel = "supabase/held/20260903140000_leopips_stake_matchmaking_buckets.WITHHELD.sql";
const liveRel = "supabase/migrations/20260903140000_leopips_stake_matchmaking_buckets.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const walletRel = "supabase/migrations/20260903120000_leopips_wallet_foundation.sql";

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const alt = `CREATE FUNCTION public.${name}`;
  let start = sql.indexOf(needle);
  if (start < 0) start = sql.indexOf(alt);
  assert.ok(start >= 0, `${name} exists`);
  const nextOr = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  const nextCreate = sql.indexOf("CREATE FUNCTION public.", start + 10);
  const next = [nextOr, nextCreate].filter((i) => i > start).sort((a, b) => a - b)[0] ?? -1;
  return next > start ? sql.slice(start, next) : sql.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true, "canonical Stage-1 migration file exists");
assert.equal(existsSync(join(root, heldRel)), false, "held WITHHELD copy must not remain as a second source");
assert.equal(
  existsSync(join(migrationsDir, "20260903140000_leopips_stake_matchmaking_buckets.WITHHELD.sql")),
  false,
  "WITHHELD filename must not live in supabase/migrations"
);
assert.equal(
  readdirSync(migrationsDir).some((name) => name === "20260903140000_leopips_stake_matchmaking_buckets.sql"),
  true,
  "stake-bucket file is canonical in migrations/"
);
assert.match(sql, /WITHHELD/);
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
const uncommented = sql.replace(/--[^\n]*/g, "");
assert.doesNotMatch(uncommented, /COALESCE\(\s*(NEW\.)?stake_pips\s*,\s*20\s*\)/);
assert.doesNotMatch(uncommented, /COALESCE\(\s*r\.stake_pips\s*,\s*20\s*\)/);
assert.doesNotMatch(uncommented, /COALESCE\(\s*request\.stake_pips\s*,\s*20\s*\)/);

assert.match(sql, /ADD COLUMN IF NOT EXISTS stake_pips integer/);
assert.match(sql, /stake_pips IS NULL OR stake_pips IN \(20, 50, 100, 150\)/);
assert.match(sql, /match_requests_open_public_lobby_idx/);
assert.match(sql, /AND stake_pips IS NOT NULL/);
assert.match(sql, /GRANT INSERT \(ruleset_id, stake_pips\)/);

assert.match(sql, /match_requests\.stake_pips is immutable/);
assert.match(sql, /matches\.stake_pips is immutable/);

{
  const protectReq = sliceFn("match_requests_protect_immutable()");
  const protectMatch = sliceFn("matches_protect_ruleset()");
  assert.match(protectReq, /SET search_path = pg_catalog/);
  assert.match(protectMatch, /SET search_path = pg_catalog/);
  assert.doesNotMatch(protectReq, /SET search_path = public/);
  assert.doesNotMatch(protectMatch, /SET search_path = public/);
}

{
  const insert = sliceFn("match_requests_before_insert()");
  assert.match(insert, /NEW\.creator_id := caller/);
  assert.match(insert, /NEW\.expires_at := now\(\) \+ interval '10 minutes'/);
  assert.match(insert, /NEW\.waiting_heartbeat_at := now\(\)/);
  assert.match(insert, /NEW\.stake_pips := NULL/);
  assert.match(insert, /NEW\.visibility = 'friend'/);
  assert.match(insert, /invalid stake_pips/);
  assert.match(insert, /NEW\.stake_pips IS NOT NULL AND NEW\.stake_pips NOT IN \(20, 50, 100, 150\)/);
  assert.doesNotMatch(insert, /NEW\.stake_pips := 20/);
  assert.doesNotMatch(insert.replace(/--[^\n]*/g, ""), /COALESCE\s*\(/);
}

assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.send_friend_match_invite/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.count_joinable_open_match_requests/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.resolve_join_timeout/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._leopips_debit/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._leopips_credit/);
assert.doesNotMatch(sql, /_leopips_timeout_penalty|_leopips_assert_can_enter_find_match/);
assert.doesNotMatch(sql, /player_xp|player_levels|CREATE TABLE public\.player_progression/);

{
  const list = sliceFn("list_joinable_open_match_requests(");
  assert.match(list, /LANGUAGE plpgsql\s+STABLE/);
  assert.match(list, /SECURITY DEFINER/);
  assert.match(list, /SET search_path = public/);
  assert.match(list, /r\.ruleset_id = p_ruleset_id/);
  assert.match(list, /r\.stake_pips = p_stake_pips/);
  assert.match(list, /p_stake_pips NOT IN \(20, 50, 100, 150\)/);
  assert.match(list, /COALESCE\(r\.visibility, 'public'\) = 'public'/);
  // Stage-1 file still documents 30s; grace migration supersedes to 5 minutes.
  assert.match(list, /waiting_heartbeat_at >= now\(\) - interval '30 seconds'/);
  assert.match(list, /r\.creator_id <> caller/);
  assert.match(list, /ranked_find_match_pair_limit_reached/);
  assert.match(list, /active_match_players/);
  assert.doesNotMatch(list, /COALESCE\(\s*r\.stake_pips/);
  assert.doesNotMatch(list, /expire_stale_open_match_requests/);
  assert.doesNotMatch(list, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(list, /FOR UPDATE/);
}

{
  const graceRel = "supabase/migrations/20260904220000_public_request_heartbeat_grace.sql";
  const grace = readFileSync(join(root, graceRel), "utf8");
  assert.match(grace, /list_joinable_open_match_requests/);
  assert.match(grace, /waiting_heartbeat_at >= now\(\) - interval '5 minutes'/);
  assert.match(grace, /waiting_heartbeat_at < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(
    grace.replace(/--[^\n]*/g, ""),
    /waiting_heartbeat_at >= now\(\) - interval '30 seconds'/
  );
  assert.match(grace, /r\.ruleset_id = p_ruleset_id/);
  assert.match(grace, /r\.stake_pips = p_stake_pips/);
  assert.match(grace, /r\.creator_id <> caller/);
  const touchAt = grace.indexOf("CREATE OR REPLACE FUNCTION public.touch_my_open_public_request");
  const touchSlice = grace.slice(touchAt, touchAt + 1400);
  assert.ok(
    touchSlice.indexOf("SET waiting_heartbeat_at = now()") <
      touchSlice.indexOf("expire_stale_open_match_requests"),
    "grace migration touches caller before expire"
  );
}

{
  const accept = sliceFn("accept_match_request(");
  const lockA = accept.indexOf("_matchmaking_lock_player(first_player)");
  const lockB = accept.indexOf("_matchmaking_lock_player(second_player)");
  const busy = accept.indexOf("PLAYER_BUSY");
  const pair = accept.indexOf("RANKED_PAIR_LIMIT");
  const unavailable = accept.indexOf("CREATOR_UNAVAILABLE");
  const lobby = accept.indexOf("LOBBY_MISMATCH");
  const insert = accept.indexOf("INSERT INTO public.matches");
  const sibling = accept.indexOf("SET status = 'cancelled'");
  assert.ok(lockA >= 0 && lockB > lockA, "UUID-order locks");
  assert.ok(busy > lockB, "PLAYER_BUSY after locks");
  assert.ok(pair > busy, "pair limit after PLAYER_BUSY");
  assert.ok(unavailable > pair, "heartbeat after pair limit");
  assert.ok(lobby > unavailable, "lobby check after heartbeat");
  assert.ok(insert > lobby, "INSERT after lobby check");
  assert.ok(sibling > insert, "sibling cancel after INSERT");
  assert.match(accept, /request\.ruleset_id/);
  assert.match(accept, /request\.stake_pips/);
  assert.match(accept, /p_ruleset_id IS DISTINCT FROM request\.ruleset_id/);
  assert.match(accept, /p_stake_pips IS DISTINCT FROM request\.stake_pips/);
  assert.match(accept, /RAISE EXCEPTION 'LOBBY_REQUIRED'/);
  assert.match(accept, /RAISE EXCEPTION 'LOBBY_MISMATCH'/);
  assert.match(
    accept,
    /INSERT INTO public\.matches \(\s*request_id, ruleset_id, stake_pips, player_a, player_b, status, match_kind, rated/
  );
  assert.match(accept, /request\.stake_pips,/);
  assert.doesNotMatch(accept, /p_stake_pips,/);
  assert.match(accept, /visibility, 'public'\) = 'friend'/);
  assert.match(accept, /ranked_find_match_pair_limit_reached/);
  assert.match(accept, /player_in_active_match\(request\.creator_id\)/);
  assert.match(accept, /player_in_active_match\(caller\)/);
  const acceptBody = accept.slice(0, accept.indexOf("COMMIT;"));
  assert.doesNotMatch(acceptBody.replace(/--[^\n]*/g, ""), /_leopips_debit|_leopips_credit|_leopips_timeout/);
  assert.doesNotMatch(acceptBody.replace(/--[^\n]*/g, ""), /COALESCE\(\s*request\.stake_pips/);
}

const stage2 = sql.slice(sql.lastIndexOf("STAGE 2"));
assert.match(stage2, /NOT EXECUTED/);
assert.match(stage2, /-- UPDATE public\.match_requests/);
assert.match(stage2, /stake_pips IS NULL/);

const executable = sql.slice(0, sql.indexOf("COMMIT;") + 7);
assert.doesNotMatch(executable, /AND stake_pips IS NULL;/);
assert.match(executable, /BEGIN;/);

const wallet = readFileSync(join(root, walletRel), "utf8");
assert.match(wallet, /20260903120000|leopips_wallet_foundation|WITHHELD/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request\(p_request_id uuid\)/);

console.log("  ✓ withheld LeoPips stake matchmaking bucket SQL contract");
