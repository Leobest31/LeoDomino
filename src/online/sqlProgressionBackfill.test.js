/**
 * Historical progression backfill SQL contract. No network.
 * Run: node src/online/sqlProgressionBackfill.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905150000_player_progression_historical_backfill.sql"),
  "utf8"
);

assert.match(sql, /_progression_backfill_historical\(p_dry_run boolean/);
assert.match(sql, /SECURITY DEFINER/);
assert.match(sql, /finish_reason = 'completed'/);
assert.match(sql, /match_winner_seat IN \(0, 1\)/);
assert.match(sql, /ON CONFLICT \(player_id, match_id\) DO NOTHING/);
assert.match(sql, /progression_level_from_wins/);
assert.match(sql, /SUM\(a\.xp_awarded\)/);
assert.match(sql, /qualifying_win_awarded/);
assert.match(sql, /emits_level_up_events', false/);
assert.match(sql, /uses_leopips_balance', false/);
assert.match(sql, /uses_rp', false/);
assert.doesNotMatch(sql, /player_level_up_events/);
assert.doesNotMatch(sql, /leopips_wallets|wallet_ledger|player_global_ratings\.rp/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._progression_backfill_historical\(boolean\) TO service_role/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._progression_backfill_historical\(boolean\) TO authenticated/);
assert.doesNotMatch(sql, /TO anon/);

console.log("  ✓ sql progression historical backfill contract");
