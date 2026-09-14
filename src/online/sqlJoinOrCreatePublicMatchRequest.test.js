/**
 * Contract: join_or_create_public_match_request migration.
 * Does not connect to Supabase. Run: node src/online/sqlJoinOrCreatePublicMatchRequest.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = "supabase/migrations/20260905210000_join_or_create_public_match_request.sql";
const sql = readFileSync(join(root, rel), "utf8");

assert.equal(existsSync(join(root, rel)), true);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.join_or_create_public_match_request\(/);
assert.match(sql, /RETURNS jsonb/);
assert.match(sql, /SECURITY DEFINER/);
assert.match(sql, /SET search_path = public/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /leo:public_lobby:/);
assert.match(sql, /p_ruleset_id NOT IN \('legacy', 'haitian', 'american'\)/);
assert.match(sql, /p_stake_pips NOT IN \(20, 50, 100, 150\)/);
assert.match(sql, /expire_stale_open_match_requests/);
assert.match(sql, /_matchmaking_lock_player\(caller\)/);
assert.match(sql, /player_in_active_match\(caller\)/);
assert.match(sql, /PLAYER_BUSY/);
assert.match(sql, /ranked_find_match_pair_limit_reached/);
assert.match(sql, /waiting_heartbeat_at >= now\(\) - interval '5 minutes'/);
assert.match(sql, /r\.creator_id <> caller/);
assert.match(sql, /r\.ruleset_id = p_ruleset_id/);
assert.match(sql, /r\.stake_pips = p_stake_pips/);
assert.match(sql, /COALESCE\(r\.visibility, 'public'\) = 'public'/);
assert.match(sql, /ORDER BY r\.created_at ASC/);
assert.match(sql, /accept_match_request\(peer_id, p_ruleset_id, p_stake_pips\)/);
assert.match(sql, /'outcome', 'accepted'/);
assert.match(sql, /'outcome', 'created'/);
assert.match(sql, /'outcome', 'already_open'/);
assert.match(sql, /INSERT INTO public\.match_requests \(ruleset_id, stake_pips, visibility\)/);
assert.match(sql, /Does not debit LeoPips/);
assert.doesNotMatch(sql, /_leopips_debit/);
assert.doesNotMatch(sql, /visibility = 'friend'/);
assert.match(
  sql,
  /GRANT EXECUTE ON FUNCTION public\.join_or_create_public_match_request\(text, integer\) TO authenticated/
);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.join_or_create_public_match_request\(text, integer\) FROM PUBLIC, anon/);

console.log("  ✓ join_or_create_public_match_request SQL contract");
