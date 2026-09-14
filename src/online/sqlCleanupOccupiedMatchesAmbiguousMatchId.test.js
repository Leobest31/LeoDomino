/**
 * cleanup_stale_occupied_matches() must not use an ambiguous bare match_id
 * reference against public.game_sessions (SQLSTATE 42702, reproduced live
 * on POST /rest/v1/rpc/join_or_create_public_match_request).
 * Run: node src/online/sqlCleanupOccupiedMatchesAmbiguousMatchId.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fix = readFileSync(
  join(root, "supabase/migrations/20260910120000_fix_cleanup_occupied_matches_ambiguous_match_id.sql"),
  "utf8"
);

assert.match(fix, /CREATE OR REPLACE FUNCTION public\.cleanup_stale_occupied_matches/);

// The exact ambiguous statement must now be alias-qualified.
assert.match(fix, /FROM public\.game_sessions gs\s*\n\s*WHERE gs\.match_id = rec\.id\s*\n\s*FOR UPDATE SKIP LOCKED/);

// The previous, unqualified form must not be present anywhere in the fix.
assert.doesNotMatch(
  fix,
  /FROM public\.game_sessions\s*\n\s*WHERE match_id = rec\.id/
);

// Every other occupancy/timeout helper this function calls must be untouched
// by name — proves the fix didn't drop or rename any branch.
for (const helper of [
  "resolve_join_timeout",
  "_occupancy_presence_action",
  "_abort_stale_match",
  "_forfeit_match_player",
]) {
  assert.match(fix, new RegExp(`public\\.${helper}\\(`));
}

// Signature and return semantics unchanged.
assert.match(fix, /RETURNS integer/);
assert.match(fix, /RETURN n;/);

// Anti-starvation / re-entrancy safety preserved: still skip-locked, never
// blocks behind an in-flight commit_online_game_transition.
assert.match(fix, /FOR UPDATE SKIP LOCKED/);

assert.doesNotMatch(fix, /eyJ|sb_secret/);

console.log("  ✓ cleanup_stale_occupied_matches ambiguous match_id fix SQL contract");
