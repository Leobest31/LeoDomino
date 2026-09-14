/**
 * Ranked Find Match pair-limit SQL contract. Concatenates all migrations.
 * Does not connect to Supabase. Run: node src/online/sqlRankedFindMatchPairLimit.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase/migrations");
const rel = "supabase/migrations/20260901120000_ranked_find_match_pair_limit.sql";
const sql = readFileSync(join(root, rel), "utf8");
const allSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
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
  return bodyEnd > start ? allSql.slice(start, bodyEnd + 3) : allSql.slice(start);
}

assert.doesNotMatch(sql, /db push|cron\.schedule|ALTER SYSTEM/);
assert.match(sql, /interval '24 hours'/);
assert.match(sql, /COUNT\(\*\)::integer/);
assert.match(sql, />= 3/);

{
  const count = latestFn("ranked_find_match_qualifying_count(p_a uuid, p_b uuid)");
  assert.match(count, /LANGUAGE sql\s+STABLE/);
  assert.match(count, /m\.rated = true/);
  assert.match(count, /m\.match_kind = 'public'/);
  assert.match(count, /m\.finish_reason = 'completed'/);
  assert.match(count, /uuid_pair_low\(m\.player_a, m\.player_b\)/);
  assert.match(count, /uuid_pair_high\(m\.player_a, m\.player_b\)/);
  assert.match(count, /m\.created_at >= now\(\) - interval '24 hours'/);
  assert.doesNotMatch(count, /game_sessions/);
  assert.doesNotMatch(count, /INNER JOIN/);
  assert.doesNotMatch(count, /finish_reason = 'timeout'/);
  assert.doesNotMatch(count, /finish_reason = 'forfeit'/);
  assert.doesNotMatch(count, /join_timeout/);
  assert.doesNotMatch(count, /status = 'completed'/);
  assert.doesNotMatch(count, /winner|score/);
  assert.doesNotMatch(count, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(count, /FOR UPDATE/);
  assert.doesNotMatch(count, /Date\.now|phone|timezone/);
  assert.match(
    allSql,
    /20260904230000_ranked_pair_limit_completed_only|finish_reason = 'completed'/
  );
}

{
  const reached = latestFn("ranked_find_match_pair_limit_reached(p_a uuid, p_b uuid)");
  assert.match(reached, /_players_are_friends\(p_a, p_b\)/);
  assert.match(reached, /ranked_find_match_qualifying_count/);
  assert.match(reached, />= 3/);
}

{
  const blocked = latestFn("list_ranked_find_match_blocked_opponents()");
  assert.match(blocked, /LANGUAGE plpgsql\s+STABLE/);
  assert.match(blocked, /auth\.uid\(\)/);
  assert.match(blocked, /HAVING COUNT\(\*\) >= 3/);
  assert.match(blocked, /m\.finish_reason = 'completed'/);
  assert.match(blocked, /m\.created_at >= now\(\) - interval '24 hours'/);
  assert.doesNotMatch(blocked, /game_sessions/);
  assert.doesNotMatch(blocked, /FOR UPDATE/);
  assert.doesNotMatch(blocked, /cleanup_stale_occupied_matches/);
}

{
  const joinable = latestFn("count_joinable_open_match_requests()");
  assert.match(joinable, /LANGUAGE plpgsql\s+STABLE/);
  assert.match(joinable, /ranked_find_match_pair_limit_reached\(r\.creator_id, caller\)/);
  assert.doesNotMatch(joinable, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(joinable, /FOR UPDATE/);
  assert.match(joinable, /COALESCE\(r\.visibility, 'public'\) = 'public'/);
}

{
  const accept = latestFn("accept_match_request(p_request_id uuid)");
  const lockA = accept.indexOf("_matchmaking_lock_player(first_player)");
  const lockB = accept.indexOf("_matchmaking_lock_player(second_player)");
  const busy = accept.indexOf("PLAYER_BUSY");
  const pair = accept.indexOf("RANKED_PAIR_LIMIT");
  const insert = accept.indexOf("INSERT INTO public.matches");
  assert.ok(lockA >= 0 && lockB > lockA, "locks both players in UUID order");
  assert.ok(busy > lockB, "PLAYER_BUSY after locks");
  assert.ok(pair > busy, "pair limit after PLAYER_BUSY");
  assert.ok(insert > pair, "pair limit before match INSERT — concurrent accepts cannot bypass");
  assert.match(accept, /visibility, 'public'\) IS DISTINCT FROM 'friend'/);
  assert.match(
    accept,
    /COALESCE\(request\.visibility, 'public'\) IS DISTINCT FROM 'friend'\s+AND public\.ranked_find_match_pair_limit_reached/
  );
  assert.match(accept, /player_in_active_match\(request\.creator_id\)/);
  assert.match(accept, /player_in_active_match\(caller\)/);
  assert.match(
    accept,
    /INSERT INTO public\.matches \(request_id, ruleset_id, player_a, player_b, status, match_kind, rated\)/
  );
  assert.match(sql, /RAISE EXCEPTION 'RANKED_PAIR_LIMIT' USING ERRCODE = 'P0004'/);
  assert.doesNotMatch(accept, /p_rated|isFriend|p_is_friend/);
  assert.doesNotMatch(accept, /winner_delta|settle_match_global_rp|_global_rp_elo_delta/);
  assert.doesNotMatch(accept, /interval '60 seconds'|turn_deadline/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.ranked_find_match_qualifying_count\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_ranked_find_match_blocked_opponents\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.accept_match_request\(uuid\) TO authenticated/);

console.log("  ✓ ranked Find Match pair-limit SQL contract");
