/**
 * Local timeout-sweep SQL contract. Do not apply hosted.
 * Run: node src/online/sqlOnlineTimeoutSweep.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(join(root, "supabase/migrations/20260904120000_online_timeout_sweep.sql"), "utf8");
const occupancySql = readFileSync(
  join(root, "supabase/migrations/20260904130000_timeout_sweep_occupancy_discovery.sql"),
  "utf8"
);
const held = readFileSync(
  join(root, "supabase/held/20260904121000_online_timeout_sweep_cron.WITHHELD.sql"),
  "utf8"
);
const cronSql = readFileSync(
  join(root, "supabase/migrations/20260904140000_online_timeout_sweep_cron.sql"),
  "utf8"
);

assert.match(sql, /Do NOT apply to hosted Supabase until explicitly approved/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_due_timeout_matches/);
assert.match(sql, /PERFORM public\.require_service_role\(\)/);
assert.match(sql, /STABLE/);
assert.match(sql, /SECURITY DEFINER/);
assert.match(sql, /search_path = public/);
assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit, 8\), 1\), 8\)/);
assert.match(sql, /turn_deadline_at <= now\(\)/);
assert.match(sql, /m\.status = 'playing'/);
assert.match(sql, /s\.status = 'playing'/);
assert.match(sql, /s\.phase = 'playing'/);
assert.doesNotMatch(sql, /applyTimeoutResolution|legalMoves|playTile/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+FROM PUBLIC, anon, authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+TO service_role/);
assert.match(sql, /game_sessions_due_turn_deadline_idx/);
assert.doesNotMatch(sql, /cron\.schedule|CREATE EXTENSION|pg_cron|pg_net|vault\./);
assert.doesNotMatch(sql, /eyJ|sb_secret|TIMEOUT_SWEEP_SECRET\s*=/);

assert.match(occupancySql, /CREATE OR REPLACE FUNCTION public\.list_due_timeout_matches/);
assert.match(occupancySql, /PERFORM public\.require_service_role\(\)/);
assert.match(occupancySql, /STABLE/);
assert.match(occupancySql, /SECURITY DEFINER/);
assert.match(occupancySql, /search_path = public/);
assert.match(occupancySql, /LEAST\(GREATEST\(COALESCE\(p_limit, 8\), 1\), 8\)/);
assert.match(
  occupancySql,
  /AND EXISTS \(\s*SELECT 1\s*FROM public\.active_match_players a\s*WHERE a\.match_id = s\.match_id\s*AND a\.player_id = m\.player_a\s*\)/
);
assert.match(
  occupancySql,
  /AND EXISTS \(\s*SELECT 1\s*FROM public\.active_match_players b\s*WHERE b\.match_id = s\.match_id\s*AND b\.player_id = m\.player_b\s*\)/
);
assert.doesNotMatch(occupancySql, /created_at >=|engine_version|interval '/);
assert.doesNotMatch(occupancySql, /cron\.schedule|CREATE EXTENSION|pg_cron|pg_net|vault\./);
assert.match(occupancySql, /REVOKE ALL ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+FROM PUBLIC, anon, authenticated/);
assert.match(occupancySql, /GRANT EXECUTE ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+TO service_role/);

assert.match(held, /WITHHELD/);
assert.match(held, /'10 seconds'/);
assert.doesNotMatch(held, /cron\.schedule\([\s\S]*'5 seconds'/);
assert.match(held, /online-timeout-sweep/);
assert.match(held, /timeout_sweep_secret/);
assert.doesNotMatch(held, /eyJ|sb_secret/);
assert.match(held, /-- CREATE EXTENSION IF NOT EXISTS pg_cron;/);

assert.match(cronSql, /CREATE EXTENSION IF NOT EXISTS pg_cron;/);
assert.match(cronSql, /CREATE EXTENSION IF NOT EXISTS pg_net;/);
assert.match(cronSql, /cron\.schedule\(/);
assert.match(cronSql, /'online-timeout-sweep'/);
assert.match(cronSql, /'10 seconds'/);
assert.doesNotMatch(cronSql, /'5 seconds'/);
assert.match(cronSql, /net\.http_post/);
assert.match(cronSql, /online-timeout-sweep/);
assert.match(cronSql, /timeout_sweep_secret/);
assert.match(cronSql, /project_url/);
assert.doesNotMatch(cronSql, /applyTimeoutResolution|legalMoves|playTile/);
assert.doesNotMatch(cronSql, /eyJ|sb_secret|TIMEOUT_SWEEP_SECRET\s*=/);
assert.doesNotMatch(cronSql, /online-game/);

const freezeFixSql = readFileSync(
  join(root, "supabase/migrations/20260905010000_timeout_sweep_due_without_dual_occupancy.sql"),
  "utf8"
);
assert.match(freezeFixSql, /CREATE OR REPLACE FUNCTION public\.list_due_timeout_matches/);
assert.match(freezeFixSql, /PERFORM public\.require_service_role\(\)/);
assert.match(freezeFixSql, /occupancy_seats/);
assert.match(freezeFixSql, /COUNT\(\*\)::integer/);
assert.match(freezeFixSql, /turn_deadline_at <= now\(\)/);
assert.match(freezeFixSql, /m\.status = 'playing'/);
assert.match(freezeFixSql, /s\.status = 'playing'/);
assert.match(freezeFixSql, /s\.phase = 'playing'/);
assert.match(freezeFixSql, /m\.player_a IS NOT NULL/);
assert.match(freezeFixSql, /m\.player_b IS NOT NULL/);
assert.doesNotMatch(
  freezeFixSql,
  /AND EXISTS \(\s*SELECT 1\s*FROM public\.active_match_players a\s*WHERE a\.match_id = s\.match_id\s*AND a\.player_id = m\.player_a\s*\)/
);
assert.doesNotMatch(
  freezeFixSql,
  /AND EXISTS \(\s*SELECT 1\s*FROM public\.active_match_players b\s*WHERE b\.match_id = s\.match_id\s*AND b\.player_id = m\.player_b\s*\)/
);
assert.doesNotMatch(freezeFixSql, /applyTimeoutResolution|legalMoves|playTile/);
assert.doesNotMatch(freezeFixSql, /cron\.schedule|CREATE EXTENSION|pg_cron|pg_net|vault\./);
assert.doesNotMatch(freezeFixSql, /eyJ|sb_secret|TIMEOUT_SWEEP_SECRET\s*=/);
assert.match(freezeFixSql, /REVOKE ALL ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+FROM PUBLIC, anon, authenticated/);
assert.match(freezeFixSql, /GRANT EXECUTE ON FUNCTION public\.list_due_timeout_matches\(integer\)\s+TO service_role/);

const matchesSelectSql = readFileSync(
  join(root, "supabase/migrations/20260906010000_service_role_matches_select_for_timeout_sweep.sql"),
  "utf8"
);
assert.match(matchesSelectSql, /Approved for hosted apply as the definitive privilege fix/);
assert.match(matchesSelectSql, /GRANT SELECT ON TABLE public\.matches TO service_role/);
assert.doesNotMatch(matchesSelectSql, /REVOKE SELECT ON TABLE public\.matches/);
assert.doesNotMatch(matchesSelectSql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.matches TO service_role/);
assert.doesNotMatch(matchesSelectSql, /eyJ|sb_secret|TIMEOUT_SWEEP_SECRET\s*=/);
assert.doesNotMatch(matchesSelectSql, /cron\.schedule|pg_cron|pg_net/);

const scanSql = readFileSync(
  join(root, "supabase/migrations/20260906020000_timeout_sweep_scan_limit_anti_starvation.sql"),
  "utf8"
);
assert.match(scanSql, /CREATE OR REPLACE FUNCTION public\.list_due_timeout_matches/);
assert.match(scanSql, /LEAST\(GREATEST\(COALESCE\(p_limit, 24\), 1\), 24\)/);
assert.match(scanSql, /PERFORM public\.require_service_role\(\)/);
assert.doesNotMatch(scanSql, /LEAST\(GREATEST\(COALESCE\(p_limit, 8\), 1\), 8\)/);
assert.doesNotMatch(scanSql, /eyJ|sb_secret|TIMEOUT_SWEEP_SECRET\s*=/);

console.log("  ✓ timeout sweeper SQL contract");
