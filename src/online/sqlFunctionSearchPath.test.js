/**
 * Contract test for the Phase 1 function search_path pin migration.
 * Does not connect to Supabase. Run: node src/online/sqlFunctionSearchPath.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260902120000_function_search_path.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");

const pgCatalog = [
  ["public._matchmaking_lock_player", "p_player uuid"],
  ["public.set_updated_at", ""],
  ["public.uuid_pair_low", "a uuid, b uuid"],
  ["public.uuid_pair_high", "a uuid, b uuid"],
  ["public.prevent_profile_id_change", ""],
  ["public.friend_conversations_protect_identity", ""],
  ["public.matches_stamp_terminal", ""],
  ["public.referral_seasons_protect_immutable", ""],
  ["public.player_referral_codes_protect_immutable", ""],
  ["public.referrals_protect_lifecycle", ""],
  ["public.matches_protect_ruleset", ""],
  ["public.match_requests_protect_immutable", ""],
  ["public.match_rp_results_protect_immutable", ""],
  ["public.game_sessions_protect_immutable", ""],
  ["public.game_actions_append_only", ""],
];

const publicPath = [
  ["public.friend_messages_before_insert", ""],
  ["public.friend_messages_protect_immutable", ""],
  ["public.require_service_role", ""],
  ["public.matches_reject_deleted_players", ""],
  ["public.profiles_protect_deleted", ""],
  ["public.assert_caller_not_deleted", ""],
];

function alterStmt(name, args, path) {
  const ident = args ? `${name}(${args})` : `${name}()`;
  return new RegExp(
    `ALTER FUNCTION ${ident.replace(/[().]/g, "\\$&")}\\s+SET search_path = ${path}\\s*;`
  );
}

const executable = sql
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

assert.match(executable, /BEGIN;/);
assert.match(executable, /COMMIT;/);
assert.doesNotMatch(executable, /CREATE OR REPLACE FUNCTION/, "does not recreate bodies");
assert.doesNotMatch(executable, /DROP FUNCTION/, "does not drop functions");
assert.doesNotMatch(executable, /rls_auto_enable/, "does not alter Supabase rls_auto_enable");
assert.doesNotMatch(executable, /ALTER FUNCTION auth\./, "does not touch auth schema");
assert.doesNotMatch(executable, /ALTER FUNCTION extensions\./, "does not touch extensions schema");
assert.doesNotMatch(executable, /ALTER FUNCTION storage\./, "does not touch storage schema");
assert.doesNotMatch(executable, /GRANT |REVOKE /, "does not change EXECUTE grants");
assert.match(sql, /Intentionally NOT altered:[\s\S]*rls_auto_enable/, "documents rls_auto_enable exclusion");

for (const [name, args] of pgCatalog) {
  assert.match(sql, alterStmt(name, args, "pg_catalog"), `${name} pinned to pg_catalog`);
  assert.match(sql, new RegExp(`ALTER FUNCTION ${name.replace(".", "\\.")}\\([^)]*\\) RESET search_path;`));
}

for (const [name, args] of publicPath) {
  assert.match(sql, alterStmt(name, args, "public"), `${name} pinned to public`);
  assert.match(sql, new RegExp(`ALTER FUNCTION ${name.replace(".", "\\.")}\\([^)]*\\) RESET search_path;`));
}

assert.equal(pgCatalog.length + publicPath.length, 21, "exactly the 21 advisor search_path functions");

console.log("  ✓ function search_path pin migration contract");
