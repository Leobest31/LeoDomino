/**
 * Admin Dashboard V1 Phase 2A Live Matches SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminLiveMatches.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828300000_admin_live_matches_phase2a.sql");
const staffSql = read("supabase/migrations/20260828280000_staff_roles.sql");
const staleSql = read("supabase/migrations/20260827200000_stale_match_occupancy.sql");

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(staleSql, /interval '5 minutes'/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_list_live_matches\(/);
assert.match(sql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|ADD TABLE/);
assert.doesNotMatch(sql, /INSERT INTO public\.staff_roles/);
assert.doesNotMatch(sql, /settle_match_global_rp|get_game_view|install_online_game|commit_online_game_transition/);
assert.doesNotMatch(sql, /cleanup_stale_occupied_matches\(/);
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/);
assert.doesNotMatch(sql, /accountAge|account_age/i);
assert.doesNotMatch(sql, /VITE_|SERVICE_ROLE|service_role_key/i);
assert.doesNotMatch(sql, /auth\.users|auth\.emails|phone/);
assert.doesNotMatch(sql, /password|refresh_token|access_token/i);
assert.doesNotMatch(sql, /FROM public\.staff_roles/);
assert.doesNotMatch(sql, /game_secrets|engine_state|deal_seed|myHand|my_hand/);
assert.doesNotMatch(sql, /gs\.board|game_sessions\.board|spinner/);

{
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_live_matches");
  assert.ok(start >= 0);
  const fn = sql.slice(start);
  assert.match(fn, /p_limit integer DEFAULT 25/);
  assert.match(fn, /p_offset integer DEFAULT 0/);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /STABLE/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.match(fn, /staff required/);
  assert.match(fn, /ERRCODE = '42501'/);
  assert.match(fn, /public\.is_staff\('moderator'\)/);
  assert.match(fn, /LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 50\)/);
  assert.match(fn, /FROM public\.active_match_players/);
  assert.match(fn, /COUNT\(DISTINCT amp\.match_id\)/);
  assert.match(fn, /INNER JOIN public\.matches m/);
  assert.match(fn, /LEFT JOIN public\.game_sessions gs/);
  assert.match(fn, /LEFT JOIN public\.profiles pa/);
  assert.match(fn, /LEFT JOIN public\.profiles pb/);
  assert.match(fn, /LEFT JOIN public\.player_global_ratings ra/);
  assert.match(fn, /LEFT JOIN public\.player_global_ratings rb/);
  assert.match(fn, /interval '5 minutes'/);
  assert.match(fn, /'admin_status'/);
  assert.match(fn, /THEN 'disconnected'/);
  assert.match(fn, /THEN 'waiting'/);
  assert.match(fn, /THEN 'live'/);
  assert.match(fn, /'match_id', m\.id/);
  assert.match(fn, /'ruleset_id', m\.ruleset_id/);
  assert.match(fn, /'rated', m\.rated/);
  assert.match(fn, /'match_kind', m\.match_kind/);
  assert.match(fn, /'match_status', m\.status/);
  assert.match(fn, /'created_at', m\.created_at/);
  assert.match(fn, /'player_a'/);
  assert.match(fn, /'player_b'/);
  assert.match(fn, /'rp', COALESCE\(ra\.rp, 1000\)/);
  assert.match(fn, /'rp', COALESCE\(rb\.rp, 1000\)/);
  assert.match(fn, /'score_a'/);
  assert.match(fn, /'score_b'/);
  assert.match(fn, /'round', gs\.round/);
  assert.match(fn, /'current_seat', gs\.current_seat/);
  assert.match(fn, /'current_player_id'/);
  assert.match(fn, /WHEN 0 THEN m\.player_a/);
  assert.match(fn, /WHEN 1 THEN m\.player_b/);
  assert.match(fn, /'session_status', gs\.status/);
  assert.match(fn, /'hand_count_a'/);
  assert.match(fn, /'hand_count_b'/);
  assert.match(fn, /'reserve_count', gs\.reserve_count/);
  assert.match(fn, /gs\.hand_counts/);
  assert.match(fn, /gs\.scores/);
  assert.match(fn, /LIMIT safe_limit/);
  assert.match(fn, /OFFSET safe_offset/);
  assert.doesNotMatch(fn, /SELECT \*/);
  assert.doesNotMatch(fn, /email|phone|password|token|raw_user_meta_data/i);
  assert.doesNotMatch(fn, /UPDATE |INSERT |DELETE /);
}

assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.admin_list_live_matches\(integer, integer\) FROM PUBLIC, anon/
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_list_live_matches\(integer, integer\) TO authenticated/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);
assert.doesNotMatch(sql, /TO anon;/);

const client = read("src/online/supabaseClient.js");
assert.doesNotMatch(client, /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i);

console.log("  ✓ admin live matches phase 2A SQL contract");
