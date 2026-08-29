/**
 * Public Challenge schedule SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlPublicChallengeSchedule.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828360000_public_challenge_schedule.sql");
const configSql = read("supabase/migrations/20260828350000_admin_reports_challenge.sql");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

const fn = sliceFn("get_public_challenge_schedule");

assert.match(fn, /SECURITY DEFINER/);
assert.match(fn, /STABLE/);
assert.match(fn, /SET search_path = public/);
assert.match(fn, /auth\.uid\(\) IS NULL/);
assert.match(fn, /authentication required/);
assert.match(fn, /ERRCODE = '28000'/);
assert.doesNotMatch(fn, /is_staff/);
assert.doesNotMatch(fn, /staff required/);
assert.doesNotMatch(fn, /UPDATE public\.challenge_config/);
assert.doesNotMatch(fn, /INSERT INTO public\.challenge_config/);
assert.doesNotMatch(fn, /now\(\)|CURRENT_TIMESTAMP|clock_timestamp/);
assert.doesNotMatch(fn, /status = 'live'|status := 'live'/);
assert.doesNotMatch(fn, /qualified_players|admin_audit|email|phone|engine_state|legalMoves|game_secrets/);
assert.match(fn, /'status', c\.status/);
assert.match(fn, /'starts_at', c\.starts_at/);
assert.match(fn, /'ends_at', c\.ends_at/);
assert.match(fn, /'qualification_cp', c\.qualification_cp/);
assert.match(fn, /'first_prize_usd', c\.first_prize_usd/);
assert.match(fn, /'second_prize_usd', c\.second_prize_usd/);
assert.match(fn, /'cp_earning_enabled', false/);
assert.doesNotMatch(fn, /'cp_earning_enabled', c\.cp_earning_enabled/);

assert.match(sql, /REVOKE ALL ON TABLE public\.challenge_config FROM PUBLIC, anon, authenticated/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_public_challenge_schedule\(\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_public_challenge_schedule\(\) TO authenticated/);
assert.doesNotMatch(sql, /TO anon;/);
assert.doesNotMatch(sql, /GRANT SELECT/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|ADD TABLE/);
assert.doesNotMatch(sql, /CREATE POLICY/);
assert.doesNotMatch(sql, /admin_get_challenge|admin_update_challenge/);
assert.doesNotMatch(sql, /cp_earning_enabled = true/);
assert.doesNotMatch(sql, /DROP CONSTRAINT challenge_config_cp_off/);

assert.match(configSql, /CONSTRAINT challenge_config_cp_off CHECK \(cp_earning_enabled = false\)/);
assert.match(configSql, /is_staff\('moderator'\)/);
assert.match(configSql, /admin_get_challenge/);
assert.match(configSql, /admin_update_challenge/);

console.log("  ✓ public challenge schedule SQL contract");
