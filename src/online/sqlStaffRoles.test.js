/**
 * Staff authorization SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlStaffRoles.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const sql = read("supabase/migrations/20260828280000_staff_roles.sql");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /CREATE TABLE public\.staff_roles/);
assert.match(sql, /user_id uuid PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/);
assert.match(sql, /role IN \('owner', 'admin', 'moderator'\)/);
assert.match(sql, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /REVOKE ALL ON TABLE public\.staff_roles FROM PUBLIC, anon, authenticated/);

assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.staff_roles/, "players cannot list staff");
assert.doesNotMatch(sql, /GRANT INSERT ON TABLE public\.staff_roles/, "players cannot insert a role");
assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.staff_roles/, "players cannot update a role");
assert.doesNotMatch(sql, /GRANT DELETE ON TABLE public\.staff_roles/, "players cannot delete staff rows");
assert.doesNotMatch(sql, /^\s*CREATE POLICY/m, "no authenticated table policies");
assert.doesNotMatch(sql, /INSERT INTO public\.staff_roles/, "does not bootstrap an owner");
assert.doesNotMatch(sql, /user_metadata|raw_user_meta_data|app_metadata/);
assert.doesNotMatch(sql, /email|password|token|jwt/i);
assert.doesNotMatch(sql, /VITE_|SERVICE_ROLE|service_role_key/i);
assert.doesNotMatch(sql, /ALTER TABLE public\.(profiles|matches|game_sessions|player_global_ratings|match_rp_results)/);
assert.doesNotMatch(sql, /DROP POLICY|CREATE POLICY[\s\S]*ON public\.(profiles|matches|game_sessions)/);
assert.doesNotMatch(sql, /settle_match_global_rp|get_game_view|install_online_game/);

{
  const isStaff = sliceFn("is_staff(required_role text DEFAULT NULL)");
  assert.match(isStaff, /SECURITY DEFINER/);
  assert.match(isStaff, /SET search_path = public/);
  assert.match(isStaff, /caller uuid := auth\.uid\(\)/);
  assert.match(isStaff, /FROM public\.staff_roles r/);
  assert.match(isStaff, /r\.user_id = caller/);
  assert.match(isStaff, /WHEN 'owner' THEN 3/);
  assert.match(isStaff, /WHEN 'admin' THEN 2/);
  assert.match(isStaff, /WHEN 'moderator' THEN 1/);
  assert.match(isStaff, /held_rank >= need_rank/);
  assert.doesNotMatch(isStaff, /user_metadata|raw_user_meta_data/);
}

{
  const probe = sliceFn("am_i_staff()");
  assert.match(probe, /SECURITY DEFINER/);
  assert.match(probe, /SET search_path = public/);
  assert.match(probe, /caller uuid := auth\.uid\(\)/);
  assert.match(probe, /'is_staff', false/);
  assert.match(probe, /'is_staff', true/);
  assert.match(probe, /'role', held/);
  assert.doesNotMatch(probe, /json_agg|SELECT \* FROM public\.staff_roles/);
  assert.doesNotMatch(probe, /user_metadata|raw_user_meta_data/);
}

assert.match(sql, /REVOKE ALL ON FUNCTION public\.is_staff\(text\) FROM PUBLIC, anon, authenticated/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.am_i_staff\(\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.am_i_staff\(\) TO authenticated/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.is_staff/);

const client = read("src/online/supabaseClient.js");
assert.doesNotMatch(client, /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i);

console.log("  ✓ staff roles SQL contract");
