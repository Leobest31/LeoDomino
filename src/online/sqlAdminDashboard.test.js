/**
 * Admin Dashboard V1 Phase 1 SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminDashboard.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828290000_admin_dashboard_phase1.sql");
const staffSql = read("supabase/migrations/20260828280000_staff_roles.sql");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(sql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
assert.doesNotMatch(sql, /INSERT INTO public\.staff_roles/);
assert.doesNotMatch(sql, /settle_match_global_rp|get_game_view|install_online_game/);
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/);
assert.doesNotMatch(sql, /accountAge|account_age/i);
assert.doesNotMatch(sql, /VITE_|SERVICE_ROLE|service_role_key/i);
assert.doesNotMatch(sql, /auth\.users|auth\.emails|phone/);
assert.doesNotMatch(sql, /password|refresh_token|access_token/i);
assert.doesNotMatch(sql, /FROM public\.staff_roles/);

{
  const overview = sliceFn("admin_get_overview()");
  assert.match(overview, /SECURITY DEFINER/);
  assert.match(overview, /SET search_path = public/);
  assert.match(overview, /STABLE/);
  assert.match(overview, /authentication required/);
  assert.match(overview, /ERRCODE = '28000'/);
  assert.match(overview, /staff required/);
  assert.match(overview, /ERRCODE = '42501'/);
  assert.match(overview, /public\.is_staff\('moderator'\)/);
  assert.match(overview, /total_active_accounts/);
  assert.match(overview, /total_deleted_accounts/);
  assert.match(overview, /accounts_created_today/);
  assert.match(overview, /accounts_created_7d/);
  assert.match(overview, /accounts_created_30d/);
  assert.match(overview, /active_match_player_count/);
  assert.match(overview, /active_match_count/);
  assert.match(overview, /FROM public\.active_match_players/);
  assert.match(overview, /COUNT\(DISTINCT match_id\)/);
  assert.match(overview, /'global_online_user_count', NULL/);
  assert.doesNotMatch(overview, /presence|realtime/i);
  assert.doesNotMatch(overview, /email|phone|password|token/i);
  assert.doesNotMatch(overview, /cleanup_stale_occupied_matches/);
}

{
  const list = sliceFn("admin_list_users(");
  assert.match(list, /p_search text DEFAULT NULL/);
  assert.match(list, /p_limit integer DEFAULT 25/);
  assert.match(list, /p_offset integer DEFAULT 0/);
  assert.match(list, /SECURITY DEFINER/);
  assert.match(list, /SET search_path = public/);
  assert.match(list, /STABLE/);
  assert.match(list, /caller uuid := auth\.uid\(\)/);
  assert.match(list, /authentication required/);
  assert.match(list, /staff required/);
  assert.match(list, /public\.is_staff\('moderator'\)/);
  assert.match(list, /ILIKE pattern ESCAPE/);
  assert.match(list, /p\.username ILIKE/);
  assert.match(list, /p\.display_name ILIKE/);
  assert.match(list, /LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 50\)/);
  assert.match(list, /ORDER BY p\.created_at DESC, p\.id DESC/);
  assert.match(list, /LIMIT safe_limit/);
  assert.match(list, /OFFSET safe_offset/);
  assert.match(list, /LEFT JOIN public\.player_global_ratings/);
  assert.match(list, /FROM public\.active_match_players amp/);
  assert.match(list, /amp\.player_id = p\.id/);
  assert.match(list, /'player_id', p\.id/);
  assert.match(list, /'display_name', p\.display_name/);
  assert.match(list, /'username', p\.username/);
  assert.match(list, /'country_code', p\.country_code/);
  assert.match(list, /'avatar_id', p\.avatar_id/);
  assert.match(list, /'created_at', p\.created_at/);
  assert.match(list, /'deleted_at', p\.deleted_at/);
  assert.match(list, /'rp', COALESCE\(r\.rp, 1000\)/);
  assert.match(list, /'wins', COALESCE\(r\.wins, 0\)/);
  assert.match(list, /'losses', COALESCE\(r\.losses, 0\)/);
  assert.match(list, /'matches_played', COALESCE\(r\.matches_played, 0\)/);
  assert.match(list, /'in_active_match'/);
  assert.doesNotMatch(list, /cleanup_stale_occupied_matches|player_in_active_match\(/);
  assert.doesNotMatch(list, /email|phone|password|token|raw_user_meta_data|accountAge/i);
  assert.doesNotMatch(list, /SELECT \*/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_overview\(\) FROM PUBLIC, anon/);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.admin_list_users\(text, integer, integer\) FROM PUBLIC, anon/
);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_overview\(\) TO authenticated/);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_list_users\(text, integer, integer\) TO authenticated/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);
assert.doesNotMatch(sql, /TO anon/);

const client = read("src/online/supabaseClient.js");
assert.doesNotMatch(client, /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i);

console.log("  ✓ admin dashboard phase 1 SQL contract");
