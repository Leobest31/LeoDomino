/**
 * Occupancy lifecycle SQL contract.
 * Run: node src/online/sqlOccupancyLifecycle.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260826160000_match_occupancy_lifecycle.sql"),
  "utf8"
);
const occupancy = readFileSync(
  join(root, "supabase/migrations/20260826120000_one_active_match.sql"),
  "utf8"
);

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.player_in_active_match\(p_player uuid\)/);
{
  const busyFn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.player_in_active_match"),
    sql.indexOf("COMMENT ON FUNCTION public.player_in_active_match")
  );
  assert.match(busyFn, /FROM public\.active_match_players/);
  assert.doesNotMatch(busyFn, /FROM public\.matches/);
}
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.abort_online_match\(p_match_id uuid\)/);
assert.match(sql, /SET status = 'aborted'/);
assert.match(sql, /player_a = caller OR player_b = caller/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.abort_online_match\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.match(sql, /expire_stale_open_match_requests/);
assert.match(sql, /AND expires_at <= now\(\)/);
assert.match(occupancy, /FOR UPDATE/);
assert.match(occupancy, /PLAYER_BUSY/);

console.log("  ✓ occupancy lifecycle SQL contract");
