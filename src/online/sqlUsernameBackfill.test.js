/**
 * Backfill profiles.username from auth metadata — repo contract only.
 * Does not connect to Supabase. Run: node src/online/sqlUsernameBackfill.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260828210000_backfill_username_from_auth_metadata.sql"),
  "utf8"
);

const body = sql
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

assert.match(sql, /raw_user_meta_data->>'username'/, "reads signup metadata username only");
assert.match(body, /normalize_player_username/, "only valid handles");
assert.match(body, /p\.username IS NULL/, "does not overwrite a claimed username");
assert.match(body, /ROW_NUMBER\(\) OVER \(PARTITION BY handle/, "one claimant per handle");
assert.match(body, /NOT EXISTS/, "does not collide with an already-claimed username");
assert.doesNotMatch(body, /SET\s+display_name|display_name\s*=/, "does not copy display_name");
assert.doesNotMatch(body, /\bDELETE\b/i, "does not delete rows");
assert.doesNotMatch(body, /\bfriendships\b|\bfriend_messages\b|\bmatches\b|\brating_points\b|\breferral/i, "does not touch other product tables");

console.log("  ✓ username metadata backfill SQL contract");
