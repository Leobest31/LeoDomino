/**
 * Staff-only admin_get_player_email SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminPlayerEmail.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905130000_admin_get_player_email.sql"),
  "utf8"
);
const staffSql = readFileSync(
  join(root, "supabase/migrations/20260828280000_staff_roles.sql"),
  "utf8"
);
const rankingsSql = readFileSync(
  join(root, "supabase/migrations/20260903200000_admin_player_rankings.sql"),
  "utf8"
);
const progressionRankings = readFileSync(
  join(root, "supabase/migrations/20260905120000_player_progression_foundation.sql"),
  "utf8"
);

function sliceFn(source, name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/);
assert.doesNotMatch(sql, /GRANT SELECT ON TABLE|GRANT INSERT|GRANT UPDATE|GRANT DELETE/);
assert.doesNotMatch(sql, /^\s*GRANT SELECT ON (TABLE )?auth\.users/im);
assert.doesNotMatch(sql, /ALTER TABLE|ADD COLUMN|CREATE TABLE|CREATE POLICY/);
assert.doesNotMatch(sql, /INSERT INTO public\.profiles|UPDATE public\.profiles/);
assert.doesNotMatch(sql, /SERVICE_ROLE|service_role_key|VITE_/);
assert.doesNotMatch(sql, /TO anon;/);
assert.doesNotMatch(sql, /ALTER PUBLICATION|FORCE ROW LEVEL SECURITY/);

const fn = sliceFn(sql, "admin_get_player_email(");
assert.match(fn, /SECURITY DEFINER/);
assert.match(fn, /SET search_path = public/);
assert.match(fn, /STABLE/);
assert.match(fn, /authentication required/);
assert.match(fn, /ERRCODE = '28000'/);
assert.match(fn, /staff required/);
assert.match(fn, /ERRCODE = '42501'/);
assert.match(fn, /public\.is_staff\('moderator'\)/);
assert.match(fn, /FROM auth\.users u/);
assert.match(fn, /NULLIF\(btrim\(u\.email\), ''\)/);
assert.match(fn, /jsonb_build_object\('email', v_email\)/);
assert.doesNotMatch(fn, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
assert.doesNotMatch(fn, /phone|password|token|raw_user_meta_data|jwt/i);
assert.doesNotMatch(fn, /GRANT SELECT/);

assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_get_player_email\(uuid\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_player_email\(uuid\) TO authenticated/);

const originalRankings = sliceFn(rankingsSql, "admin_list_player_rankings(");
assert.doesNotMatch(originalRankings, /auth\.users|email/i);
const liveRankings = sliceFn(progressionRankings, "admin_list_player_rankings(");
assert.doesNotMatch(liveRankings, /auth\.users|email/i);

console.log("  ✓ sqlAdminPlayerEmail contract");
