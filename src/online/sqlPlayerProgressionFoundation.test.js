/**
 * Contract tests for player progression SQL foundation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905120000_player_progression_foundation.sql"),
  "utf8"
);

assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.player_progression/);
assert.match(sql, /qualifying_public_completed_wins/);
assert.match(sql, /lifetime_xp/);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.player_progression_awards/);
assert.match(sql, /UNIQUE \(player_id, match_id\)/);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.player_level_up_events/);
assert.match(sql, /UNIQUE \(player_id, level\)/);
assert.match(sql, /progression_settings/);
assert.match(sql, /activated_at/);
assert.match(sql, /before_activation/);
assert.match(sql, /progression_level_from_wins/);
assert.match(sql, /LEAST\(100/);
assert.match(sql, /FLOOR\(GREATEST\(COALESCE\(p_wins, 0\), 0\) \/ 10\.0\)/);
assert.match(sql, /WHEN p_level <= 19 THEN 'BRONZE'/);
assert.match(sql, /WHEN p_level <= 49 THEN 'GOLD'/);
assert.match(sql, /ELSE 'DIAMOND'/);
assert.match(sql, /xp := CASE WHEN p_did_win THEN 25 ELSE 10 END/);
assert.match(sql, /xp := CASE WHEN p_did_win THEN 10 ELSE 5 END/);
assert.match(sql, /finish_reason IS DISTINCT FROM 'completed'/);
assert.match(sql, /_progression_award_finished_match/);
assert.match(sql, /progression := public\._progression_award_finished_match/);
assert.match(sql, /consume_my_level_up_event/);
assert.match(sql, /level_xp_available', true/);
assert.match(sql, /LEFT JOIN public\.player_progression pr/);
assert.doesNotMatch(sql, /UPDATE public\.player_leopips_wallets/);
assert.doesNotMatch(sql, /initial_grant/);
assert.doesNotMatch(sql, /FROM public\.matches[\s\S]{0,200}INSERT INTO public\.player_progression_awards/);

console.log("  ✓ sql player progression foundation contract");
