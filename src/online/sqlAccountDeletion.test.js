/**
 * Account deletion SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAccountDeletion.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  authLookupResult,
  canReturnOk,
  isAlreadyGone,
  isPrepareSuccess,
  isTombstoneVerified,
} from "../../supabase/functions/delete-account/guards.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = [
  readFileSync(join(root, "supabase/migrations/20260828230000_account_deletion.sql"), "utf8"),
  readFileSync(join(root, "supabase/migrations/20260828240000_account_deletion_forfeit.sql"), "utf8"),
].join("\n");
const backfill = readFileSync(
  join(root, "supabase/migrations/20260828210000_backfill_username_from_auth_metadata.sql"),
  "utf8"
);
const fn = readFileSync(join(root, "supabase/functions/delete-account/index.js"), "utf8");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.lastIndexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /ADD COLUMN IF NOT EXISTS deleted_at timestamptz/, "tombstone column");
assert.match(sql, /DROP CONSTRAINT IF EXISTS profiles_id_fkey/, "auth cascade FK dropped");
assert.doesNotMatch(sql, /settle_match_global_rp|_global_rp_elo_delta/, "does not rewrite Elo settlement");
assert.doesNotMatch(sql, /DELETE FROM public\.matches/, "does not delete matches");
assert.doesNotMatch(sql, /DELETE FROM public\.match_rp_results/, "does not delete RP ledger");
assert.doesNotMatch(sql, /DELETE FROM public\.game_actions/, "does not delete audit actions");
assert.doesNotMatch(sql, /DELETE FROM public\.friend_messages/, "keeps historical chat");
assert.doesNotMatch(sql, /UPDATE public\.player_global_ratings SET rp/, "does not rewrite RP values");
assert.doesNotMatch(sql, /raw_user_meta_data/, "does not apply username backfill");
assert.doesNotMatch(backfill, /prepare_my_account_deletion/, "backfill file is unchanged");

{
  const prepare = sliceFn("prepare_my_account_deletion()");
  assert.match(prepare, /caller uuid := auth\.uid\(\)/, "self only");
  assert.doesNotMatch(prepare, /p_user_id|p_player_id/, "no client-supplied target id");
  assert.doesNotMatch(prepare, /MATCH_ACTIVE/, "does not block on live matches");
  assert.match(prepare, /_forfeit_match_player\(live_match, caller\)/, "forfeits live seats");
  assert.match(prepare, /status IN \('ready', 'playing'\)/, "finds live matches to close");
  assert.match(prepare, /username = NULL/, "releases username");
  assert.match(prepare, /Deleted player/, "anonymized display name");
  assert.match(prepare, /deleted_at = now\(\)/, "sets tombstone");
  assert.match(prepare, /DELETE FROM public\.friendships/, "removes friends");
  assert.match(prepare, /DELETE FROM public\.friend_requests/, "removes requests");
  assert.match(prepare, /DELETE FROM public\.friend_conversation_reads/, "clears unread");
  assert.match(prepare, /DELETE FROM public\.player_referral_codes/, "drops invite code");
  assert.match(prepare, /status = 'cancelled'/, "cancels open requests/invites");
  assert.match(prepare, /DELETE FROM public\.active_match_players/, "clears leftover occupancy");
  assert.ok(
    prepare.indexOf("_forfeit_match_player") < prepare.indexOf("DELETE FROM public.active_match_players"),
    "forfeit runs before leftover occupancy delete"
  );
  assert.match(prepare, /already_tombstoned/, "retryable if already tombstoned");
  assert.ok(
    prepare.indexOf("_forfeit_match_player") < prepare.indexOf("already_tombstoned"),
    "live seats close even on tombstone retry"
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.prepare_my_account_deletion\(\) TO authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.prepare_my_account_deletion\(\) FROM PUBLIC, anon/);
}

{
  const rank = sliceFn("get_my_global_rating()");
  assert.match(rank, /p\.deleted_at IS NULL/, "current rank ignores tombstones");
  assert.match(rank, /ACCOUNT_DELETED/, "tombstoned caller cannot use ranking");
  assert.match(rank, /1 \+ COUNT\(\*\)/, "rank formula unchanged");
  assert.doesNotMatch(rank, /UPDATE public\.player_global_ratings SET rp/, "read path still does not write RP");
}

{
  const search = sliceFn("search_players_by_username");
  assert.match(search, /p\.deleted_at IS NULL/, "search hides deleted users");
}

{
  const friends = sliceFn("send_friend_request");
  assert.match(friends, /deleted_at IS NULL/, "cannot add a deleted player");
  assert.match(friends, /ACCOUNT_DELETED/, "tombstoned caller cannot send requests");
}

assert.match(sql, /NEW\.deleted_at IS NULL/, "username clear allowed only while tombstoning");
assert.match(sql, /profiles_protect_deleted/, "cannot un-delete from the client");
assert.match(sql, /matches_reject_deleted_players/, "new matches cannot seat tombstones");
assert.match(sql, /assert_caller_not_deleted/, "tombstoned JWT cannot write leftovers");
assert.match(sql, /friend_messages_reject_deleted/, "tombstone cannot send chat");
assert.match(sql, /player_referral_codes_reject_deleted/, "tombstone cannot recreate an invite code");

assert.match(fn, /getUser\(userJwt\)/, "verifies JWT");
assert.match(fn, /signInWithPassword/, "re-authenticates with password");
assert.match(fn, /INVALID_PASSWORD/, "wrong password is a dedicated reason");
assert.doesNotMatch(fn, /MATCH_ACTIVE/, "function does not return MATCH_ACTIVE");
assert.doesNotMatch(fn, /body\.user_id|body\.userId|p_user_id/, "ignores client target ids");
assert.match(fn, /\+ "\/rest\/v1"/, "PostgREST rest/v1 base");
assert.match(fn, /\/rpc\/prepare_my_account_deletion/, "tombstone via raw PostgREST RPC");
assert.match(fn, /apikey: anonKey/, "RPC uses anon apikey");
assert.match(fn, /Authorization: "Bearer " \+ userJwt/, "RPC forwards the user JWT");
assert.doesNotMatch(fn, /\.rpc\(\s*["']prepare_my_account_deletion/, "does not use supabase-js rpc()");
assert.doesNotMatch(fn, /accessToken/, "does not set accessToken on the getUser client");
assert.doesNotMatch(fn, /GRANT EXECUTE/, "does not grant the RPC to anon");
assert.doesNotMatch(fn, /createClient\(supabaseUrl, serviceKey/, "admin delete is not createClient(serviceKey)");
assert.doesNotMatch(fn, /auth\.admin\.deleteUser/, "does not use supabase-js admin.deleteUser");
assert.match(fn, /\+ "\/auth\/v1"/, "Auth Admin v1 base");
assert.match(fn, /\/admin\/users\//, "raw Auth Admin user path");
assert.match(fn, /should_soft_delete: false/, "hard delete");
assert.match(fn, /startsWith\("sb_"\)/, "opaque service keys follow online-game");
assert.match(fn, /select=deleted_at/, "re-reads tombstone");
assert.match(fn, /isPrepareSuccess/, "prepare payload must include already_tombstoned");
assert.match(fn, /isTombstoneVerified/, "deleted_at must be proven");
assert.match(fn, /adminLookupUser|authLookupResult/, "Auth absence is verified");
assert.match(fn, /AUTH_DELETE_FAILED/, "Auth failure is not success");
assert.doesNotMatch(fn, /message\.includes\("not found"\)/, "generic not found is not success");
assert.ok(
  fn.indexOf("await userClient.auth.getUser(userJwt)") < fn.indexOf("signInWithPassword"),
  "JWT user is verified before password check"
);
assert.ok(
  fn.indexOf("signInWithPassword") < fn.indexOf("await prepareMyAccountDeletion("),
  "password is verified before tombstone RPC"
);
assert.ok(
  fn.indexOf("if (!tombstoneVerified)") < fn.indexOf("await adminDeleteUser("),
  "Auth delete runs only after tombstone verification"
);
assert.ok(
  fn.indexOf("await adminLookupUser(") < fn.lastIndexOf("return json({ ok: true })"),
  "Auth absence is proven before ok"
);
assert.doesNotMatch(fn, /console\.log\(userJwt|console\.log\(user\.email|friend_messages/, "does not log secrets");
assert.doesNotMatch(fn, /console\.log\(.*password/, "does not log the password");
assert.match(config, /\[functions\.delete-account\]/);
assert.match(config, /verify_jwt = true/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.prepare_my_account_deletion\(\) FROM PUBLIC, anon/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.prepare_my_account_deletion\(\) TO authenticated/);

assert.equal(isPrepareSuccess({ ok: true, already_tombstoned: false }), true);
assert.equal(isPrepareSuccess({ ok: true, already_tombstoned: true }), true);
assert.equal(isPrepareSuccess({ ok: true }), false, "missing already_tombstoned is not success");
assert.equal(isPrepareSuccess({ ok: true, already_tombstoned: "false" }), false);
assert.equal(isPrepareSuccess(null), false);

assert.equal(isTombstoneVerified({ deleted_at: "2026-08-28T11:00:00Z" }), true);
assert.equal(isTombstoneVerified([{ deleted_at: "2026-08-28T11:00:00Z" }]), true);
assert.equal(isTombstoneVerified({ deleted_at: null }), false, "tombstone verification failure");
assert.equal(isTombstoneVerified([]), false);
assert.equal(isTombstoneVerified(null), false);

assert.equal(isAlreadyGone({ code: "user_not_found" }), true, "exact user_not_found");
assert.equal(isAlreadyGone({ error_code: "user_not_found" }), true);
assert.equal(isAlreadyGone({ code: 404, message: "Not Found" }), false, "generic not found is not success");
assert.equal(isAlreadyGone({ message: "requested path not found" }), false);
assert.equal(isAlreadyGone({ code: "404" }), false);

assert.equal(authLookupResult(200, { id: "user-1" }, "user-1"), "exists");
assert.equal(
  authLookupResult(200, { id: "user-1" }, "user-1") === "exists" &&
    canReturnOk({ tombstoneVerified: true, authState: "exists" }) === false,
  true,
  "Auth user still exists after delete → not ok"
);
assert.equal(authLookupResult(404, { error_code: "user_not_found" }, "user-1"), "absent");
assert.equal(authLookupResult(404, { msg: "Not Found" }, "user-1"), "unknown", "generic 404 is not absence");
assert.equal(authLookupResult(401, { message: "invalid JWT" }, "user-1"), "unknown");
assert.equal(canReturnOk({ tombstoneVerified: true, authState: "absent" }), true);
assert.equal(canReturnOk({ tombstoneVerified: false, authState: "absent" }), false);
assert.equal(canReturnOk({ tombstoneVerified: true, authState: "unknown" }), false);
assert.equal(canReturnOk({ tombstoneVerified: true, authState: "exists" }), false);

console.log("  ✓ account deletion SQL + function contract");
