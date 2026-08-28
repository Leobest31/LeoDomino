/**
 * Admin Dashboard V1 Phase 3 Top RP SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminTopRp.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828320000_admin_top_rp.sql");
const staffSql = read("supabase/migrations/20260828280000_staff_roles.sql");
const rpSql = read("supabase/migrations/20260827220000_global_rp.sql");

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(rpSql, /CREATE TABLE public\.match_rp_results/);
assert.match(rpSql, /settled_at timestamptz NOT NULL DEFAULT now\(\)/);
assert.match(rpSql, /winner_old_rp integer NOT NULL/);
assert.match(rpSql, /winner_new_rp integer NOT NULL/);
assert.match(rpSql, /winner_delta integer NOT NULL/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_list_top_rp\(/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_list_player_rp_history\(/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|ADD TABLE/);
assert.doesNotMatch(sql, /INSERT INTO public\.staff_roles/);
assert.doesNotMatch(sql, /settle_match_global_rp|get_game_view|install_online_game|commit_online_game_transition/);
assert.doesNotMatch(sql, /game_secrets|engine_state|deal_seed|myHand|my_hand/);
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/);
assert.doesNotMatch(sql, /VITE_|SERVICE_ROLE|service_role_key/i);
assert.doesNotMatch(sql, /auth\.users|auth\.emails|phone/);
assert.doesNotMatch(sql, /password|refresh_token|access_token/i);
assert.doesNotMatch(sql, /FROM public\.staff_roles/);
assert.doesNotMatch(sql, /UPDATE public\.player_global_ratings|UPDATE public\.match_rp_results/);

{
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_top_rp");
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_player_rp_history");
  const fn = sql.slice(start, next);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /STABLE/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.match(fn, /staff required/);
  assert.match(fn, /ERRCODE = '42501'/);
  assert.match(fn, /public\.is_staff\('moderator'\)/);
  assert.match(fn, /ORDER BY r\.rp DESC, r\.player_id ASC/);
  assert.match(fn, /r\.matches_played > 0/);
  assert.match(fn, /p\.deleted_at IS NULL/);
  assert.match(fn, /r2\.rp > r\.rp/);
  assert.match(fn, /'rank'/);
  assert.match(fn, /'wins'/);
  assert.match(fn, /'losses'/);
  assert.match(fn, /'matches_played'/);
  assert.doesNotMatch(fn, /SELECT \*/);
  assert.doesNotMatch(fn, /UPDATE |INSERT |DELETE /);
}

{
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_list_player_rp_history");
  const fn = sql.slice(start);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /mrr\.rated = true/);
  assert.match(fn, /mrr\.settled_at/);
  assert.match(fn, /'settled_at', mrr\.settled_at/);
  assert.doesNotMatch(fn, /now\(\)/);
  assert.doesNotMatch(fn, /match_kind = 'friend'/);
  assert.match(fn, /'rp_before'/);
  assert.match(fn, /'rp_delta'/);
  assert.match(fn, /'rp_after'/);
  assert.match(fn, /THEN 'win' ELSE 'loss'/);
  assert.match(fn, /ORDER BY mrr\.settled_at DESC, mrr\.match_id DESC/);
  assert.match(fn, /m\.finished_at/);
  assert.match(fn, /mrr\.ruleset_id/);
  assert.doesNotMatch(fn, /mrr\.rated = false|rated IS DISTINCT FROM true/);
  assert.doesNotMatch(fn, /SELECT \*/);
  assert.doesNotMatch(fn, /UPDATE |INSERT |DELETE /);
  assert.doesNotMatch(fn, /game_secrets|engine_state|deal_seed|myHand/);
}

assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.admin_list_top_rp\(integer, integer\) FROM PUBLIC, anon/
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_list_top_rp\(integer, integer\) TO authenticated/
);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.admin_list_player_rp_history\(uuid, integer, integer\) FROM PUBLIC, anon/
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_list_player_rp_history\(uuid, integer, integer\) TO authenticated/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);
assert.doesNotMatch(sql, /TO anon;/);

console.log("  ✓ admin top RP phase 3 SQL contract");
