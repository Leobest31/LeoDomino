/**
 * Admin Dashboard V1 remaining sections SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminV1.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const auditSql = read("supabase/migrations/20260828330000_admin_audit_log.sql");
const readersSql = read("supabase/migrations/20260828340000_admin_v1_readers.sql");
const restSql = read("supabase/migrations/20260828350000_admin_reports_challenge.sql");
const phase3 = read("supabase/migrations/20260828320000_admin_top_rp.sql");
const liveSql = read("supabase/migrations/20260828300000_admin_live_matches_phase2a.sql");
const specSql = read("supabase/migrations/20260828310000_admin_live_match_spectator.sql");

assert.match(phase3, /admin_list_top_rp/);
assert.match(liveSql, /admin_list_live_matches/);
assert.match(specSql, /admin_get_live_match_view/);

function assertStaffReader(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, name);
  const fn = sql.slice(start, start + 3500);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.match(fn, /staff required/);
  assert.match(fn, /ERRCODE = '42501'/);
  assert.doesNotMatch(fn, /GRANT SELECT/);
  assert.doesNotMatch(fn, /game_secrets|engine_state|deal_seed|myHand/);
}

{
  assert.match(auditSql, /CREATE TABLE public\.admin_audit_log/);
  assert.match(auditSql, /FORCE ROW LEVEL SECURITY/);
  assert.match(auditSql, /REVOKE ALL ON TABLE public\.admin_audit_log FROM PUBLIC, anon, authenticated/);
  assert.match(auditSql, /CREATE OR REPLACE FUNCTION public\._admin_write_audit\(/);
  assert.match(auditSql, /REVOKE ALL ON FUNCTION public\._admin_write_audit/);
  assert.doesNotMatch(auditSql, /GRANT EXECUTE ON FUNCTION public\._admin_write_audit/);
  assertStaffReader(auditSql, "admin_list_audit(");
  assert.match(auditSql, /GRANT EXECUTE ON FUNCTION public\.admin_list_audit\(integer, integer\) TO authenticated/);
  assert.doesNotMatch(auditSql, /TO anon;/);
  assert.doesNotMatch(auditSql, /ALTER PUBLICATION/);
}

{
  assertStaffReader(readersSql, "admin_get_user(");
  assertStaffReader(readersSql, "admin_list_feedback(");
  assertStaffReader(readersSql, "admin_get_invite_win(");
  assert.match(readersSql, /friend_count/);
  assert.match(readersSql, /match_last_seen_at/);
  assert.match(readersSql, /mrr\.rated = true/);
  assert.doesNotMatch(readersSql, /email|phone|raw_user_meta_data/);
  assert.doesNotMatch(readersSql, /apply_referral_code|refresh_my_referral_progress/);
  assert.match(readersSql, /GRANT EXECUTE ON FUNCTION public\.admin_get_invite_win\(\) TO authenticated/);
}

{
  assert.match(restSql, /CREATE TABLE public\.player_reports/);
  assert.match(restSql, /CREATE TABLE public\.challenge_config/);
  assert.match(restSql, /CREATE TABLE public\.league_config/);
  assert.match(restSql, /cp_earning_enabled boolean NOT NULL DEFAULT false/);
  assert.match(restSql, /CONSTRAINT challenge_config_cp_off CHECK \(cp_earning_enabled = false\)/);
  assert.match(restSql, /qualification_cp = 5000/);
  assert.match(restSql, /season_days = 60/);
  assert.match(restSql, /'qualified_players', '\[\]'::jsonb/);
  assert.match(restSql, /'leaderboard', '\[\]'::jsonb/);
  assertStaffReader(restSql, "admin_list_reports(");
  assertStaffReader(restSql, "admin_get_challenge(");
  assertStaffReader(restSql, "admin_get_league(");
  const mutate = restSql.slice(restSql.indexOf("admin_update_report_status"));
  assert.match(mutate, /VOLATILE/);
  assert.match(mutate, /char_length\(why\) < 8/);
  assert.match(mutate, /_admin_write_audit/);
  assert.match(mutate, /is_staff\('moderator'\)/);
  const challengeMut = restSql.slice(restSql.indexOf("admin_update_challenge"));
  assert.match(challengeMut, /is_staff\('admin'\)/);
  assert.match(challengeMut, /cp_earning_enabled = false/);
  assert.match(challengeMut, /_admin_write_audit/);
  assert.doesNotMatch(restSql, /GRANT SELECT/);
  assert.doesNotMatch(restSql, /CREATE OR REPLACE FUNCTION public\.(ban_player|suspend_account|admin_ban|admin_suspend)/i);
  assert.doesNotMatch(restSql, /ALTER PUBLICATION|ADD TABLE/);
  assert.doesNotMatch(restSql, /get_game_view|submit_game_action|settle_match_global_rp/);
  assert.doesNotMatch(restSql, /submit_my_report|admin_submit_report|player_submit_report/);
  assert.match(restSql, /REVOKE ALL ON TABLE public\.player_reports FROM PUBLIC, anon, authenticated/);
  assert.match(restSql, /REVOKE ALL ON TABLE public\.challenge_config FROM PUBLIC, anon, authenticated/);
  assert.match(restSql, /REVOKE ALL ON TABLE public\.league_config FROM PUBLIC, anon, authenticated/);
  assert.match(restSql, /GRANT EXECUTE ON FUNCTION public\.admin_update_report_status\(uuid, text, text\) TO authenticated/);
  assert.match(restSql, /GRANT EXECUTE ON FUNCTION public\.admin_update_challenge\(text, timestamptz, timestamptz, text\) TO authenticated/);
  assert.doesNotMatch(restSql, /GRANT EXECUTE ON FUNCTION public\._admin_write_audit/);
}

console.log("  ✓ admin v1 remaining SQL contract");
