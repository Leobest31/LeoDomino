/**
 * Authoritative forfeit + friend-invite SQL contract.
 * Run: node src/online/sqlForfeitInvites.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260827120000_online_forfeit_friend_invites.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS invitee_id uuid/);
assert.match(sql, /CHECK \(status IN \('open', 'accepted', 'cancelled', 'expired', 'declined'\)\)/);
assert.match(sql, /match_requests_one_open_public_per_creator/);
assert.match(sql, /match_requests_one_open_friend_pair/);
assert.match(sql, /DROP INDEX IF EXISTS public\.match_requests_one_open_per_creator/);

{
  const trigger = sliceFn("match_requests_before_insert()");
  assert.match(trigger, /cannot invite yourself/);
  assert.match(trigger, /not friends/);
  assert.match(trigger, /PLAYER_BUSY/);
  assert.match(trigger, /NEW\.visibility := 'public'/);
  assert.doesNotMatch(trigger, /allFives|'classic'/);
}

{
  const accept = sliceFn("accept_match_request(p_request_id uuid)");
  assert.match(accept, /only the invitee may accept/);
  assert.match(accept, /not friends/);
  assert.match(accept, /PLAYER_BUSY/);
  assert.match(accept, /REQUEST_ALREADY_ACCEPTED/);
  assert.match(accept, /invitee_id IN \(request\.creator_id, caller\)/);
  assert.match(accept, /WHEN unique_violation THEN/);
}

{
  const send = sliceFn("send_friend_match_invite(p_invitee_id uuid, p_ruleset_id text)");
  assert.match(send, /visibility, invitee_id/);
  assert.match(send, /'friend'/);
  assert.match(send, /_matchmaking_lock_player/);
  assert.match(send, /PLAYER_BUSY/);
  assert.match(send, /cannot invite yourself/);
}

{
  const decline = sliceFn("decline_friend_match_invite(p_request_id uuid)");
  assert.match(decline, /invitee_id = caller/);
  assert.match(decline, /status = 'declined'/);
  assert.match(decline, /visibility = 'friend'/);
  assert.doesNotMatch(decline, /INSERT INTO public\.matches/);
}

{
  const count = sliceFn("count_joinable_open_match_requests()");
  assert.match(count, /COALESCE\(r\.visibility, 'public'\) = 'public'/);
}

{
  const policy = sql.slice(sql.indexOf("CREATE POLICY match_requests_select_relevant"));
  assert.match(policy, /invitee_id = auth\.uid\(\)/);
  assert.match(policy, /COALESCE\(visibility, 'public'\) = 'public'/);
}

{
  const forfeit = sliceFn("forfeit_online_match(p_match_id uuid)");
  assert.match(forfeit, /FOR UPDATE/);
  assert.match(forfeit, /not a seated player/);
  assert.match(forfeit, /winner_seat := CASE WHEN match_row\.player_a = caller THEN 1 ELSE 0 END/);
  assert.doesNotMatch(forfeit, /p_winner/);
  assert.match(forfeit, /SET status = 'finished'/);
  assert.match(forfeit, /status = 'match_over'/);
  assert.match(forfeit, /phase = 'matchOver'/);
  assert.match(forfeit, /reason', 'forfeit'/);
  assert.match(forfeit, /engine_state/);
  assert.match(forfeit, /idempotent', true/);
}

{
  const abort = sliceFn("abort_online_match(p_match_id uuid)");
  assert.match(abort, /PERFORM public\.forfeit_online_match/);
  assert.doesNotMatch(abort, /SET status = 'aborted'/);
}

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.forfeit_online_match\(uuid\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.send_friend_match_invite\(uuid, text\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.decline_friend_match_invite\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /TO anon;/);

console.log("  ✓ forfeit + friend invite SQL contract");
