/**
 * Global signed-in presence SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlPlayerPresence.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(join(root, "supabase/migrations/20260828370000_player_presence.sql"), "utf8");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /CREATE TABLE public\.player_presence/);
assert.match(sql, /player_id uuid PRIMARY KEY REFERENCES public\.profiles \(id\) ON DELETE CASCADE/);
assert.match(sql, /last_seen_at timestamptz NOT NULL/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /REVOKE ALL ON TABLE public\.player_presence FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /CREATE POLICY/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|supabase_realtime/);
assert.doesNotMatch(sql, /email|phone|password|token|raw_user_meta_data/i);
assert.doesNotMatch(sql, /challenge_config|settle_match_global_rp|get_game_view/);
assert.doesNotMatch(sql, /cleanup_stale_occupied_matches/);

{
  const touch = sliceFn("touch_my_presence()");
  assert.match(touch, /SECURITY DEFINER/);
  assert.match(touch, /SET search_path = public/);
  assert.match(touch, /VOLATILE/);
  assert.match(touch, /caller uuid := auth\.uid\(\)/);
  assert.match(touch, /authentication required/);
  assert.match(touch, /ERRCODE = '28000'/);
  assert.match(touch, /INSERT INTO public\.player_presence/);
  assert.match(touch, /ON CONFLICT \(player_id\)/);
  assert.match(touch, /VALUES \(caller, now\(\), now\(\)\)/);
  assert.doesNotMatch(touch, /p_player_id|player_id\s*=\s*p_/);
  assert.doesNotMatch(touch, /p_last_seen|last_seen_at\s*=\s*p_/);
  assert.doesNotMatch(touch, /FROM PUBLIC, anon, authenticated/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.touch_my_presence\(\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.touch_my_presence\(\) TO authenticated/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.touch_my_presence\(\) TO anon/);

{
  const overview = sliceFn("admin_get_overview()");
  assert.match(overview, /SECURITY DEFINER/);
  assert.match(overview, /is_staff\('moderator'\)/);
  assert.match(overview, /interval '75 seconds'/);
  assert.match(overview, /FROM public\.player_presence pr/);
  assert.match(overview, /p\.deleted_at IS NULL/);
  assert.match(overview, /pr\.last_seen_at <= now\(\)/);
  assert.doesNotMatch(overview, /UNION/);
  assert.doesNotMatch(
    overview.slice(overview.indexOf("'global_online_user_count'")),
    /active_match_players/
  );
  assert.doesNotMatch(overview, /'global_online_user_count', NULL/);
}

{
  const list = sliceFn("admin_list_users(");
  assert.match(list, /'presence_last_seen_at'/);
  assert.match(list, /'match_last_seen_at'/);
  assert.match(list, /'in_active_match'/);
  assert.match(list, /FROM public\.player_presence pr/);
  assert.doesNotMatch(list, /GRANT SELECT/);
}

{
  const detail = sliceFn("admin_get_user(");
  assert.match(detail, /'presence_last_seen_at'/);
  assert.match(detail, /is_staff\('moderator'\)/);
  assert.match(detail, /mrr\.rated = true/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_overview\(\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_overview\(\) TO authenticated/);
assert.doesNotMatch(sql, /TO anon;/);

console.log("  ✓ player presence SQL contract");
