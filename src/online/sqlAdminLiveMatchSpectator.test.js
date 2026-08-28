/**
 * Admin Dashboard V1 Phase 2B Live Match Spectator SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminLiveMatchSpectator.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828310000_admin_live_match_spectator.sql");
const staffSql = read("supabase/migrations/20260828280000_staff_roles.sql");

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_get_live_match_view\(p_match_id uuid\)/);
assert.match(sql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/);
assert.doesNotMatch(sql, /GRANT SELECT|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|ADD TABLE/);
assert.doesNotMatch(sql, /INSERT INTO public\.staff_roles/);
assert.doesNotMatch(sql, /settle_match_global_rp|get_game_view|install_online_game|commit_online_game_transition/);
assert.doesNotMatch(sql, /submit_game_action|forfeit_online_match|cleanup_stale_occupied_matches\(/);
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/);
assert.doesNotMatch(sql, /accountAge|account_age/i);
assert.doesNotMatch(sql, /VITE_|SERVICE_ROLE|service_role_key/i);
assert.doesNotMatch(sql, /auth\.users|auth\.emails|phone/);
assert.doesNotMatch(sql, /password|refresh_token|access_token/i);
assert.doesNotMatch(sql, /FROM public\.staff_roles/);
assert.doesNotMatch(sql, /game_secrets|engine_state|deal_seed|myHand|my_hand/);
assert.doesNotMatch(sql, /players\[|hand_ids|reserve_ids|boneyard/);

{
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_get_live_match_view");
  assert.ok(start >= 0);
  const fn = sql.slice(start);
  assert.match(fn, /p_match_id uuid/);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /STABLE/);
  assert.match(fn, /RETURNS jsonb/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.match(fn, /staff required/);
  assert.match(fn, /ERRCODE = '42501'/);
  assert.match(fn, /public\.is_staff\('moderator'\)/);
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /FROM public\.matches m/);
  assert.match(fn, /LEFT JOIN public\.game_sessions gs ON gs\.match_id = m\.id/);
  assert.match(fn, /LEFT JOIN public\.profiles pa/);
  assert.match(fn, /LEFT JOIN public\.profiles pb/);
  assert.match(fn, /LEFT JOIN public\.player_global_ratings ra/);
  assert.match(fn, /LEFT JOIN public\.player_global_ratings rb/);
  assert.match(fn, /LEFT JOIN public\.active_match_players occ_a/);
  assert.match(fn, /LEFT JOIN public\.active_match_players occ_b/);
  assert.match(fn, /interval '5 minutes'/);
  assert.match(fn, /'board', COALESCE\(gs\.board, '\[\]'::jsonb\)/);
  assert.match(fn, /'spinner', gs\.spinner/);
  assert.match(fn, /'hand_count_a'/);
  assert.match(fn, /'hand_count_b'/);
  assert.match(fn, /gs\.hand_counts/);
  assert.match(fn, /'reserve_count', gs\.reserve_count/);
  assert.match(fn, /'last_play_points', gs\.last_play_points/);
  assert.match(fn, /'last_play_score_terminals'/);
  assert.match(fn, /'match_winner_seat', gs\.match_winner_seat/);
  assert.match(fn, /'finish_reason', m\.finish_reason/);
  assert.match(fn, /THEN 'forfeit'/);
  assert.match(fn, /THEN 'finished'/);
  assert.match(fn, /THEN 'aborted'/);
  assert.match(fn, /THEN 'disconnected'/);
  assert.match(fn, /THEN 'waiting'/);
  assert.match(fn, /THEN 'live'/);
  assert.match(fn, /match not found/);
  assert.match(fn, /ERRCODE = 'P0002'/);
  assert.doesNotMatch(fn, /SELECT \*/);
  assert.doesNotMatch(fn, /email|phone|password|token|raw_user_meta_data/i);
  assert.doesNotMatch(fn, /UPDATE |INSERT |DELETE /);
  assert.doesNotMatch(fn, /gs\.hand_counts\s*[,)]/);
}

assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.admin_get_live_match_view\(uuid\) FROM PUBLIC, anon/
);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.admin_get_live_match_view\(uuid\) TO authenticated/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);
assert.doesNotMatch(sql, /TO anon;/);

const client = read("src/online/supabaseClient.js");
assert.doesNotMatch(client, /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i);

console.log("  ✓ admin live match spectator phase 2B SQL contract");
