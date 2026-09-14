/**
 * Public Find Match creator availability SQL contract.
 * Concatenates migrations. Does not connect to Supabase.
 * Run: node src/online/sqlPublicRequestAvailability.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = "supabase/migrations/20260902140000_public_request_creator_availability.sql";
const migration = readFileSync(join(root, rel), "utf8");
const allSql = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(root, "supabase/migrations", name), "utf8"))
  .join("\n\n");

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

assert.match(migration, /ADD COLUMN IF NOT EXISTS waiting_heartbeat_at timestamptz/);
assert.match(migration, /SET search_path = public/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.touch_my_open_public_request\(\) TO authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.touch_my_open_public_request\(\) FROM PUBLIC, anon/);
assert.doesNotMatch(migration, /p_player|p_player_id|p_creator/);
assert.doesNotMatch(migration, /touch_my_presence/);
assert.doesNotMatch(migration, /DROP POLICY|DISABLE ROW LEVEL SECURITY/);

{
  const expire = latestFn("expire_stale_open_match_requests()");
  assert.match(expire, /expires_at <= now\(\)/);
  assert.match(expire, /COALESCE\(visibility, 'public'\) = 'public'/);
  assert.match(expire, /waiting_heartbeat_at < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(expire, /waiting_heartbeat_at < now\(\) - interval '30 seconds'/);
  assert.match(expire, /waiting_heartbeat_at IS NULL/);
  assert.match(expire, /SET search_path = public/);
}

{
  const insert = latestFn("match_requests_before_insert()");
  assert.match(insert, /NEW\.waiting_heartbeat_at := now\(\)/);
  assert.match(insert, /NEW\.waiting_heartbeat_at := NULL/);
  assert.match(insert, /NEW\.visibility = 'friend'/);
  assert.match(insert, /expire_stale_open_match_requests/);
  assert.match(insert, /auth\.uid\(\)/);
  assert.doesNotMatch(insert, /p_player/);
}

{
  const touch = latestFn("touch_my_open_public_request()");
  assert.match(touch, /caller uuid := auth\.uid\(\)/);
  assert.match(touch, /waiting_heartbeat_at = now\(\)/);
  assert.match(touch, /expires_at > now\(\)/);
  assert.match(touch, /COALESCE\(visibility, 'public'\) = 'public'/);
  assert.match(touch, /expire_stale_open_match_requests/);
  assert.match(touch, /SET search_path = public/);
  assert.doesNotMatch(touch, /p_player|p_creator_id/);
  assert.doesNotMatch(touch, /player_presence/);
  const updateAt = touch.indexOf("SET waiting_heartbeat_at = now()");
  const expireAt = touch.indexOf("expire_stale_open_match_requests");
  assert.ok(updateAt >= 0 && expireAt > updateAt, "touch refreshes caller before expire");
}

{
  const joinable = latestFn("count_joinable_open_match_requests()");
  assert.match(joinable, /LANGUAGE plpgsql\s+STABLE/);
  assert.match(joinable, /waiting_heartbeat_at IS NOT NULL/);
  assert.match(joinable, /waiting_heartbeat_at >= now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(joinable, /waiting_heartbeat_at >= now\(\) - interval '30 seconds'/);
  assert.doesNotMatch(joinable, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(joinable, /expire_stale_open_match_requests/);
  assert.doesNotMatch(joinable, /FOR UPDATE/);
  assert.doesNotMatch(joinable, /INSERT INTO|UPDATE public\.|DELETE FROM public\./);
}

{
  const accept = latestFn("accept_match_request(");
  const lockA = accept.indexOf("_matchmaking_lock_player(first_player)");
  const lockB = accept.indexOf("_matchmaking_lock_player(second_player)");
  const busy = accept.indexOf("PLAYER_BUSY");
  const pair = accept.indexOf("RANKED_PAIR_LIMIT");
  const unavailable = accept.indexOf("CREATOR_UNAVAILABLE");
  const insert = accept.indexOf("INSERT INTO public.matches");
  const sibling = accept.indexOf("SET status = 'cancelled'");
  assert.ok(lockA >= 0 && lockB > lockA, "UUID-order locks both players");
  assert.ok(busy > lockB, "PLAYER_BUSY after locks");
  assert.ok(pair > busy, "pair limit after PLAYER_BUSY");
  assert.ok(unavailable > pair, "heartbeat revalidation after pair limit");
  assert.ok(insert > unavailable, "no match INSERT until heartbeat is fresh");
  assert.ok(sibling > insert, "acceptor sibling cancel only after successful INSERT");
  assert.match(accept, /RAISE EXCEPTION 'CREATOR_UNAVAILABLE' USING ERRCODE = 'P0005'/);
  assert.match(accept, /waiting_heartbeat_at < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(accept, /waiting_heartbeat_at < now\(\) - interval '30 seconds'/);
  assert.match(accept, /SET status = 'expired'/);
  assert.match(accept, /SET search_path = public/);
  assert.doesNotMatch(accept, /p_rated|isFriend|p_is_friend/);
  assert.doesNotMatch(accept, /winner_delta|settle_match_global_rp|_global_rp_elo_delta/);
}

{
  const send = latestFn("send_friend_match_invite(p_invitee_id uuid, p_ruleset_id text)");
  assert.match(send, /VALUES \(p_ruleset_id, 'friend', p_invitee_id\)/);
  assert.doesNotMatch(send, /waiting_heartbeat_at/);
}

console.log("  ✓ public request availability SQL contract");
