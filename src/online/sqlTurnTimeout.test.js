/**
 * Authoritative online turn-timeout SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlTurnTimeout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260828380000_online_turn_timeout.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /ADD COLUMN IF NOT EXISTS turn_deadline_at timestamptz/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS timeout_strikes jsonb NOT NULL DEFAULT '\[0,0\]'/);
assert.match(sql, /now\(\) \+ interval '60 seconds'/);
assert.match(sql, /action_type IN \('play', 'draw', 'pass', 'advance_round', 'timeout'\)/);
assert.match(sql, /finish_reason IN \('completed', 'forfeit', 'aborted', 'timeout'\)/);
assert.match(sql, /finish_reason IN \('completed', 'forfeit', 'timeout'\)/);
assert.doesNotMatch(sql, /challenge_schedule|challenge_cp|friend_invites|queue_rated/);
assert.doesNotMatch(sql, /cleanup_stale_occupied_matches|_abort_stale_match/);
assert.doesNotMatch(sql, /DROP FUNCTION IF EXISTS public\.commit_online_game_transition/);
assert.doesNotMatch(sql, /p_finish_reason/);

{
  const install = sliceFn("install_online_game(");
  assert.match(install, /turn_deadline_at/);
  assert.match(install, /timeout_strikes/);
  assert.match(install, /now\(\) \+ interval '60 seconds'/);
  assert.match(install, /ON CONFLICT \(match_id\) DO NOTHING/);
  assert.doesNotMatch(install, /p_turn_deadline|client.*deadline/);
}

{
  const commit = sliceFn("commit_online_game_transition(");
  assert.match(commit, /FOR UPDATE/);
  assert.match(commit, /stale expected_version/);
  assert.match(commit, /p_action_type = 'timeout'/);
  assert.match(commit, /timeout not due/);
  assert.match(commit, /turn_deadline_at > now\(\)/);
  assert.match(commit, /timeout_strikes/);
  assert.match(commit, /now\(\) \+ interval '60 seconds'/);
  assert.match(commit, /resetTurnDeadline/);
  assert.match(commit, /p_public->>'finishReason' IN \('timeout', 'completed', 'forfeit'\)/);
  assert.match(commit, /settle_match_global_rp\(p_match_id\)/);
  assert.match(commit, /'turnDeadlineAt', v_next_deadline/);
  assert.doesNotMatch(commit, /p_winner|p_loser|p_new_rp|p_delta|p_rated/);
  assert.doesNotMatch(commit, /auth\.uid\(\)/);
}

{
  const spectator = sliceFn("admin_get_live_match_view(p_match_id uuid)");
  assert.match(spectator, /'turn_deadline_at', gs\.turn_deadline_at/);
  assert.match(spectator, /'server_now', now\(\)/);
  assert.match(spectator, /STABLE/);
  assert.match(spectator, /is_staff\('moderator'\)/);
  assert.doesNotMatch(spectator, /game_secrets|engine_state|myHand|deal_seed/);
  assert.doesNotMatch(spectator, /UPDATE |INSERT |DELETE /);
}

console.log("  ✓ online turn-timeout SQL contract");
