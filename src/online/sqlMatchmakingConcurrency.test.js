/**
 * Contract test for one-active-match SQL.
 * Does not connect to Supabase. Run: node src/online/sqlMatchmakingConcurrency.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260826120000_one_active_match.sql"),
  "utf8"
);

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.active_match_players/, "occupancy table");
mustInclude(/player_id uuid PRIMARY KEY/, "one row per player");
mustInclude(/status IN \('ready', 'playing'\)/, "only live matches occupy a seat");
mustInclude(/CREATE TRIGGER matches_sync_active_players/, "occupancy stays in sync");
mustInclude(/SECURITY DEFINER/, "occupancy writes are not client RLS");
mustInclude(/pg_advisory_xact_lock/, "per-player advisory locks");
mustInclude(/_matchmaking_lock_player/, "sorted player locks");
mustInclude(/PLAYER_BUSY/, "busy players rejected");
mustInclude(/REQUEST_UNAVAILABLE/, "gone requests rejected");
mustInclude(/REQUEST_ALREADY_ACCEPTED/, "double accept rejected");
mustInclude(/FOR UPDATE/, "request row locked at commit");
mustInclude(
  /creator_id IN \(request\.creator_id, caller\)/,
  "sibling OPEN rows of both seats are locked/cancelled"
);
mustInclude(
  /SET status = 'cancelled'[\s\S]*id <> request\.id[\s\S]*creator_id IN \(request\.creator_id, caller\)/,
  "other OPEN requests of both players are cancelled in the same transaction"
);
mustInclude(
  /VALUES \(request\.id, request\.ruleset_id, request\.creator_id, caller, 'ready'\)/,
  "accept still copies the creator ruleset"
);
mustInclude(/PLAYER_BUSY/, "insert of a request while seated is blocked");
mustInclude(/REVOKE ALL ON TABLE public\.active_match_players/, "occupancy is not client-writable");
assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.active_match_players TO authenticated/);
assert.doesNotMatch(sql, /ruleset_id IN \('classic'/);
assert.doesNotMatch(sql, /allFives/);

mustInclude(/GRANT EXECUTE ON FUNCTION public\.accept_match_request\(uuid\) TO authenticated/);
mustInclude(
  /CREATE OR REPLACE FUNCTION public\.count_joinable_open_match_requests\(\)/,
  "informational joinable OPEN count"
);
mustInclude(/NOT public\.player_in_active_match\(r\.creator_id\)/, "busy creators are not counted");
mustInclude(/r\.creator_id <> caller/, "own requests are not counted");
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.count_joinable_open_match_requests\(\) TO authenticated/,
  "authenticated clients can read the count"
);
assert.doesNotMatch(
  sql,
  /count_joinable_open_match_requests[\s\S]*UPDATE public\.match_requests/,
  "availability count does not mutate requests"
);

console.log("  ✓ one-active-match SQL contract");
