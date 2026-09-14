/**
 * Staff ranking RPC contract. Original migration kept; progression migration
 * replaces admin_list_player_rankings with real Level/XP.
 * Run: node src/online/sqlAdminPlayerRankings.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const liveRel = "supabase/migrations/20260903200000_admin_player_rankings.sql";
const progressionRel = "supabase/migrations/20260905120000_player_progression_foundation.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const progressionSql = readFileSync(join(root, progressionRel), "utf8");

function sliceFn(source, name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.equal(existsSync(join(root, liveRel)), true);
assert.equal(existsSync(join(root, progressionRel)), true);
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /ALTER TABLE|DROP TABLE|TRUNCATE/);
assert.doesNotMatch(sql, /player_xp|player_levels|award_xp/);

const original = sliceFn(sql, "admin_list_player_rankings(");
assert.match(original, /'level', NULL/);
assert.match(original, /level_xp_available', false/);

const fn = sliceFn(progressionSql, "admin_list_player_rankings(");
assert.match(fn, /SECURITY DEFINER/);
assert.match(fn, /SET search_path = public/);
assert.match(fn, /STABLE/);
assert.match(fn, /is_staff\('moderator'\)/);
assert.match(fn, /LEFT JOIN public\.player_progression pr/);
assert.match(fn, /COALESCE\(pr\.level, 0\)/);
assert.match(fn, /COALESCE\(pr\.lifetime_xp, 0\)/);
assert.match(fn, /progression_rank/);
assert.match(fn, /level_xp_available', true/);
assert.match(fn, /jsonb_build_array\('level', 'xp', 'wins', 'name'\)/);
assert.doesNotMatch(fn, /email|phone|password|token|raw_user_meta_data/i);

console.log("  ✓ sqlAdminPlayerRankings (original + progression override)");
