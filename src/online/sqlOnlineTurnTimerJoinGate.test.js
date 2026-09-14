/**
 * Turn timer must not arm until both seats have joined (active_match_players
 * .joined_at set for both). SQL contract only, does not connect to Supabase.
 * Run: node src/online/sqlOnlineTurnTimerJoinGate.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260907010000_online_turn_timer_requires_both_present.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

{
  const ready = sliceFn("_online_turn_timer_ready(p_match_id uuid)");
  assert.match(ready, /COUNT\(\*\) >= 2/);
  assert.match(ready, /FROM public\.active_match_players a/);
  assert.match(ready, /a\.joined_at IS NOT NULL/);
  assert.match(ready, /STABLE/);
}
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\._online_turn_timer_ready\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/
);

{
  const install = sliceFn("install_online_game(");
  assert.match(
    install,
    /v_status = 'playing' AND v_phase = 'playing' AND public\._online_turn_timer_ready\(p_match_id\)/
  );
  assert.match(install, /v_deadline := now\(\) \+ interval '30 seconds'/);
  assert.match(install, /ELSE\s*\n\s*v_deadline := NULL/);
  // Still requires both LeoPips stake debits — unrelated invariant, unchanged.
  assert.match(install, /_leopips_require_both_match_stakes/);
}

{
  const commit = sliceFn("commit_online_game_transition(");
  // The re-arm branch is gated; the carry-forward branch is untouched.
  assert.match(commit, /v_rearm := COALESCE\(\(p_public->>'resetTurnDeadline'\)::boolean, false\)/);
  assert.match(commit, /IF v_rearm THEN\s*\n\s*IF public\._online_turn_timer_ready\(p_match_id\) THEN/);
  assert.match(commit, /v_next_deadline := now\(\) \+ interval '30 seconds';\s*\n\s*ELSE\s*\n\s*v_next_deadline := NULL;/);
  assert.match(commit, /ELSE\s*\n\s*v_next_deadline := session_row\.turn_deadline_at;/);
  // Timeout-commit gate is unchanged: still requires a non-null, due deadline.
  assert.match(commit, /session_row\.turn_deadline_at IS NULL\s*\n\s*OR session_row\.turn_deadline_at > now\(\)/);
  assert.match(commit, /'code', 'TIMEOUT_NOT_DUE'/);
}

{
  const touch = sliceFn("touch_my_match_presence(p_match_id uuid)");
  assert.match(touch, /joined_at = COALESCE\(joined_at, now\(\)\)/);
  assert.match(touch, /IF touched > 0 THEN/);
  assert.match(touch, /turn_deadline_at = now\(\) \+ interval '30 seconds'/);
  // Idempotency + race-safety: only arms a still-null deadline, only once ready.
  assert.match(touch, /turn_deadline_at IS NULL\s*\n\s*AND public\._online_turn_timer_ready\(p_match_id\)/);
  assert.match(touch, /cleanup_stale_occupied_matches/);
}

// The sweep discovery query and its "ignore until due" gate are untouched —
// a null deadline already falls outside `turn_deadline_at IS NOT NULL AND <= now()`.
const sweep = readFileSync(
  join(root, "supabase/migrations/20260905010000_timeout_sweep_due_without_dual_occupancy.sql"),
  "utf8"
);
assert.match(sweep, /s\.turn_deadline_at IS NOT NULL/);
assert.match(sweep, /s\.turn_deadline_at <= now\(\)/);

console.log("  ✓ online turn timer join-gate SQL contract");
