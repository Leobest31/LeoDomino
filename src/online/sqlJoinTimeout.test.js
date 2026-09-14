/**
 * Join-timeout SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlJoinTimeout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260830120000_join_timeout.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /ADD COLUMN IF NOT EXISTS joined_at timestamptz/);
assert.match(sql, /interval '3 minutes'/);
assert.match(sql, /finish_reason IN \('completed', 'forfeit', 'aborted', 'timeout', 'join_timeout'\)/);
assert.doesNotMatch(sql, /interval '60 seconds'/);
assert.doesNotMatch(sql, /PERFORM public\.settle_match_global_rp/);

{
  const abort = sliceFn("_abort_join_timeout_match(p_match_id uuid)");
  assert.match(abort, /status = 'aborted'/);
  assert.match(abort, /finish_reason = COALESCE\(finish_reason, 'join_timeout'\)/);
  assert.match(abort, /reason', 'join_timeout'/);
  assert.match(abort, /match_winner_seat = NULL/);
  assert.match(abort, /'winner', NULL/);
  assert.match(abort, /'rpChange', false/);
  assert.doesNotMatch(abort, /finish_reason = 'forfeit'/);
  assert.doesNotMatch(abort, /_forfeit_match_player/);
}

{
  const resolve = sliceFn("resolve_join_timeout(p_match_id uuid)");
  assert.match(resolve, /FOR UPDATE/);
  assert.match(resolve, /session_exists AND joined_a IS NOT NULL AND joined_b IS NOT NULL/);
  assert.match(resolve, /reason', 'started'/);
  assert.match(resolve, /reason', 'too_early'/);
  assert.match(resolve, /_abort_join_timeout_match/);
  assert.doesNotMatch(resolve, /p_player/);
}

{
  const cleanup = sliceFn("cleanup_stale_occupied_matches()");
  assert.match(cleanup, /waiting := joined_a IS NULL OR joined_b IS NULL/);
  assert.match(cleanup, /resolve_join_timeout/);
  assert.match(cleanup, /never forfeit/);
  assert.match(cleanup, /_forfeit_match_player/);
  assert.match(cleanup, /interval '5 minutes'/);
}

{
  const touch = sliceFn("touch_my_match_presence(p_match_id uuid)");
  assert.match(touch, /joined_at = COALESCE\(joined_at, now\(\)\)/);
  assert.match(touch, /last_seen_at = now\(\)/);
}

{
  const getMine = sliceFn("get_my_active_match()");
  assert.match(getMine, /caller uuid := auth\.uid\(\)/);
  assert.match(getMine, /player_a = caller OR m\.player_b = caller/);
  assert.doesNotMatch(getMine, /p_player/);
  assert.doesNotMatch(getMine, /engine_state|hand_counts|game_secrets/);
  assert.match(getMine, /join_deadline_at/);
  assert.match(getMine, /gameplay_started/);
}

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.resolve_join_timeout\(uuid\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_my_active_match\(\) TO authenticated/);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\._abort_join_timeout_match\(uuid\) FROM PUBLIC, anon, authenticated/
);

const turnTimeout = readFileSync(
  join(root, "supabase/migrations/20260828380000_online_turn_timeout.sql"),
  "utf8"
);
assert.match(turnTimeout, /now\(\) \+ interval '60 seconds'/);
assert.doesNotMatch(sql, /timeout_strikes/);

console.log("  ✓ join timeout SQL contract");
