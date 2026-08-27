/**
 * Stale occupancy TTL SQL contract.
 * Run: node src/online/sqlStaleMatchLifecycle.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260827200000_stale_match_occupancy.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /ADD COLUMN IF NOT EXISTS last_seen_at timestamptz/);
assert.match(sql, /interval '5 minutes'/);
assert.doesNotMatch(sql, /beforeunload/);
assert.doesNotMatch(sql, /finish_reason = COALESCE\(finish_reason, 'completed'\)/);

{
  const cleanup = sliceFn("cleanup_stale_occupied_matches()");
  assert.match(cleanup, /stale_a AND stale_b/);
  assert.match(cleanup, /_abort_stale_match/);
  assert.match(cleanup, /_forfeit_match_player/);
  assert.match(cleanup, /FOR UPDATE SKIP LOCKED/);
  assert.match(cleanup, /last_seen_at < now\(\) - grace/);
}

{
  const abort = sliceFn("_abort_stale_match(p_match_id uuid)");
  assert.match(abort, /SET status = 'aborted'/);
  assert.match(abort, /reason', 'abandoned'/);
  assert.match(abort, /status = 'match_over'/);
  assert.match(abort, /idempotent', true/);
  assert.doesNotMatch(abort, /finish_reason = 'completed'/);
  assert.doesNotMatch(abort, /finish_reason = 'forfeit'/);
}

{
  const forfeit = sliceFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  assert.match(forfeit, /finish_reason = COALESCE\(finish_reason, 'forfeit'\)/);
  assert.match(forfeit, /reason', 'forfeit'/);
  assert.match(forfeit, /status = 'match_over'/);
  assert.match(forfeit, /idempotent', true/);
}

{
  const touch = sliceFn("touch_my_match_presence(p_match_id uuid)");
  assert.match(touch, /SET last_seen_at = now\(\)/);
  assert.match(touch, /cleanup_stale_occupied_matches/);
  assert.match(touch, /player_id = caller/);
}

{
  const busy = sliceFn("player_in_active_match(p_player uuid)");
  assert.match(busy, /cleanup_stale_occupied_matches/);
  assert.match(busy, /FROM public\.active_match_players/);
}

{
  const friends = sliceFn("list_friends_in_active_match()");
  assert.match(friends, /cleanup_stale_occupied_matches/);
  assert.match(friends, /FROM public\.active_match_players a/);
}

{
  const count = sliceFn("count_joinable_open_match_requests()");
  assert.match(count, /cleanup_stale_occupied_matches/);
  assert.match(count, /VOLATILE/);
}

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.cleanup_stale_occupied_matches\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.touch_my_match_presence\(uuid\) TO authenticated/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\._forfeit_match_player\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\._abort_stale_match\(uuid\) FROM PUBLIC, anon, authenticated/);
assert.match(sql, /SELECT public\.cleanup_stale_occupied_matches\(\)/);
assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.active_match_players/);

console.log("  ✓ stale match occupancy SQL contract");
