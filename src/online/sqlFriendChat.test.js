/**
 * V1 friends-only Live Chat SQL contract.
 * Does not connect to Supabase. Run: node src/online/sqlFriendChat.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260828120000_friend_chat.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");
const foundation = readFileSync(
  join(root, "supabase/migrations/20260823120000_find_match_friends_foundation.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.friend_conversations/, "friend_conversations table");
mustInclude(/CREATE TABLE public\.friend_messages/, "friend_messages table");
mustInclude(/CREATE TABLE public\.friend_conversation_reads/, "friend_conversation_reads table");

mustInclude(
  /CONSTRAINT friend_conversations_ordered_pair CHECK \(user_a < user_b\)/,
  "canonical user_a < user_b"
);
mustInclude(
  /CONSTRAINT friend_conversations_unique_pair UNIQUE \(user_a, user_b\)/,
  "unique conversation per friend pair"
);
mustInclude(
  /user_a uuid NOT NULL REFERENCES public\.profiles\(id\)/,
  "conversations.user_a -> profiles"
);
mustInclude(
  /user_b uuid NOT NULL REFERENCES public\.profiles\(id\)/,
  "conversations.user_b -> profiles"
);
mustInclude(/created_at timestamptz NOT NULL DEFAULT now\(\)/, "conversation created_at");
mustInclude(/last_message_at timestamptz/, "last_message_at");
assert.doesNotMatch(
  sql,
  /friend_conversations[\s\S]{0,800}REFERENCES public\.friendships/,
  "durable chat identity is not friendships.id"
);

mustInclude(
  /conversation_id uuid NOT NULL REFERENCES public\.friend_conversations\(id\) ON DELETE CASCADE/,
  "messages belong to a conversation"
);
mustInclude(
  /sender_id uuid NOT NULL REFERENCES public\.profiles\(id\)/,
  "messages.sender_id -> profiles"
);
mustInclude(/body text NOT NULL/, "message body");
mustInclude(
  /CONSTRAINT friend_messages_body_len CHECK \(char_length\(body\) BETWEEN 1 AND 1000\)/,
  "1–1000 characters after trim"
);
mustInclude(
  /CONSTRAINT friend_messages_body_trimmed CHECK \(body = btrim\(body\)\)/,
  "stored body is trimmed"
);

mustInclude(
  /PRIMARY KEY \(conversation_id, player_id\)/,
  "one read-state row per participant"
);
mustInclude(/last_read_message_id uuid/, "last_read_message_id");
mustInclude(/last_read_at timestamptz/, "last_read_at");

mustInclude(
  /INSERT INTO public\.friend_conversations \(user_a, user_b\)[\s\S]*SELECT[\s\S]*FROM public\.friendships[\s\S]*ON CONFLICT \(user_a, user_b\) DO NOTHING/,
  "backfill conversations for existing friendships"
);
mustInclude(
  /INSERT INTO public\.friend_conversation_reads/,
  "backfill read-state rows"
);
{
  const backfillStart = sql.indexOf("-- Existing-friend backfill");
  const backfillEnd = sql.indexOf("-- Client RPCs");
  assert.ok(backfillStart >= 0 && backfillEnd > backfillStart, "backfill section exists");
  const backfill = sql.slice(backfillStart, backfillEnd);
  assert.doesNotMatch(backfill, /DELETE FROM public\.friendships/, "backfill does not delete friendships");
  assert.doesNotMatch(backfill, /UPDATE public\.friendships/, "backfill does not alter friendships");
}
assert.doesNotMatch(sql, /UPDATE public\.friendships/, "does not alter friendship rows");
assert.doesNotMatch(sql, /ALTER TABLE public\.friendships/, "does not alter friendships schema");
assert.doesNotMatch(sql, /DROP TABLE public\.friendships/, "does not drop friendships");
assert.doesNotMatch(
  sql,
  /CREATE OR REPLACE FUNCTION public\.respond_to_friend_request/,
  "does not rewrite respond_to_friend_request; uses friendships INSERT trigger"
);

{
  const can = sliceFn("_can_friend_message(p_a uuid, p_b uuid)");
  assert.match(can, /FROM public\.friendships/, "authoritative friendship table");
  assert.match(can, /uuid_pair_low/, "canonical pair low");
  assert.match(can, /uuid_pair_high/, "canonical pair high");
  assert.match(can, /SET search_path = public/, "trusted search_path");
  assert.doesNotMatch(can, /friend_requests/, "pending/declined/cancelled requests are not friendship");
  assert.doesNotMatch(can, /isFriend|p_is_friend|p_sender_id/, "does not trust client flags");
  assert.doesNotMatch(can, /blocked_users|player_blocks|is_blocked/, "blocking not implemented yet");
  assert.match(
    sql,
    /COMMENT ON FUNCTION public\._can_friend_message/,
    "future blocked-user hook is documented on the helper"
  );
}

{
  const ensure = sliceFn("_ensure_friend_conversation(p_user_a uuid, p_user_b uuid)");
  assert.match(ensure, /uuid_pair_low/, "orders the pair");
  assert.match(ensure, /ON CONFLICT \(user_a, user_b\) DO NOTHING/, "no duplicate conversations");
  assert.match(ensure, /INSERT INTO public\.friend_conversation_reads/, "creates read-state rows");
  assert.match(ensure, /SET search_path = public/, "trusted search_path");
}

{
  const trigger = sliceFn("friendships_ensure_conversation()");
  assert.match(trigger, /_ensure_friend_conversation\(NEW\.user_a, NEW\.user_b\)/, "new friends get a conversation");
  assert.match(sql, /AFTER INSERT ON public\.friendships/, "conversation created when friendship is inserted");
}

{
  const send = sliceFn("send_friend_message(p_friend_id uuid, p_body text)");
  assert.match(send, /SECURITY DEFINER/, "send is SECURITY DEFINER");
  assert.match(send, /SET search_path = public/, "trusted search_path");
  assert.match(send, /caller uuid := auth\.uid\(\)/, "actor is auth.uid()");
  assert.match(send, /authentication required/, "rejects anon");
  assert.match(send, /cannot message yourself/, "self-message cannot send");
  assert.match(send, /_can_friend_message\(caller, p_friend_id\)/, "accepted friends can send");
  assert.match(send, /not friends/, "stranger / pending / declined / cancelled / unfriended cannot send");
  assert.match(send, /btrim\(COALESCE\(p_body, ''\)\)/, "body is trimmed");
  assert.match(send, /message is empty/, "whitespace-only message rejected");
  assert.match(send, /char_length\(body_text\) > 1000/, "over 1000 rejected");
  assert.match(send, /message is too long/, "too-long error");
  assert.match(send, /_friend_message_contains_link\(body_text\)/, "obvious links rejected server-side");
  assert.match(send, /links are not allowed/, "link error");
  assert.match(send, /sender_id = caller/, "rate limit is per sender");
  assert.match(send, /created_at > now\(\) - interval '5 seconds'/, "5-second window");
  assert.match(send, /recent_count >= 5/, "6th rapid message rejected");
  assert.match(send, /too many messages/, "rate-limit error");
  assert.match(send, /prev_body = body_text/, "identical repeated body");
  assert.match(send, /repeated message/, "identical-body cooldown error");
  assert.match(send, /_ensure_friend_conversation\(caller, p_friend_id\)/, "lazy conversation for existing friends");
  assert.match(
    send,
    /INSERT INTO public\.friend_messages \(conversation_id, sender_id, body\)/,
    "inserts authoritative message"
  );
  assert.match(send, /VALUES \(conv_id, caller, body_text\)/, "sender_id comes from auth.uid()");
  assert.match(send, /last_message_at = inserted\.created_at/, "updates last_message_at");
  assert.doesNotMatch(send, /p_sender_id|p_conversation_id|p_is_friend|p_unread/, "RPC accepts no spoofable extras");
  assert.doesNotMatch(send, /friend_requests/, "does not treat pending/declined requests as sendable");
}

{
  const links = sliceFn("_friend_message_contains_link(p_body text)");
  assert.match(links, /https\?:\/\//, "http:// and https://");
  assert.match(links, /www\\\./, "www.");
  assert.match(links, /:\/\//, "://");
  assert.match(links, /\(com\|net\|org\|io\|app\|gg\|co\)/, "common domain suffixes");
}

{
  const list = sliceFn("list_my_friend_conversations()");
  assert.match(list, /caller uuid := auth\.uid\(\)/, "authenticated-only");
  assert.match(list, /authentication required/, "rejects anon");
  assert.match(list, /c\.user_a = caller OR c\.user_b = caller/, "participant can read own conversation");
  assert.match(list, /display_name/, "other player display name");
  assert.match(list, /avatar_id/, "other player avatar");
  assert.match(list, /country_code/, "other player country");
  assert.match(list, /last_message_preview/, "last message preview");
  assert.match(list, /unread_count/, "unread count");
  assert.match(list, /is_friend/, "currently friends flag for UI Send");
  assert.match(list, /m\.sender_id <> caller|m\.sender_id IS DISTINCT FROM caller/, "unread is inbound only");
  assert.match(list, /last_message_at DESC NULLS LAST/, "newest conversation first");
  assert.doesNotMatch(list, /FROM public\.friendships f[\s\S]*JOIN public\.friend_conversations/, "historical conversation remains after unfriend");
}

{
  const messages = sliceFn("list_friend_messages(");
  assert.match(messages, /authentication required/, "authenticated-only");
  assert.match(messages, /not a conversation participant/, "unrelated player cannot read messages");
  assert.match(messages, /m\.created_at DESC, m\.id DESC/, "keyset pagination (created_at, id)");
  assert.match(messages, /effective_limit := 50/, "default 50");
  assert.match(messages, /LEAST\(p_limit, 50\)/, "pagination capped at 50");
  assert.match(messages, /LIMIT effective_limit/, "never unlimited history");
  assert.doesNotMatch(messages, /LIMIT ALL/, "no unlimited LIMIT");
}

{
  const mark = sliceFn("mark_friend_conversation_read(p_conversation_id uuid)");
  assert.match(mark, /authentication required/, "authenticated-only");
  assert.match(mark, /not a conversation participant/, "participant-only");
  assert.match(mark, /last_read_message_id/, "server sets last_read_message_id");
  assert.match(mark, /last_read_at = now\(\)|last_read_at = EXCLUDED\.last_read_at/, "server-controlled timestamp");
  assert.doesNotMatch(mark, /p_unread|p_last_read_message_id|p_last_read_at|p_count/, "client cannot submit unread counts");
  assert.match(mark, /player_id = caller|player_id,[\s\S]*caller/, "unread state is participant-scoped");
}

{
  const unread = sliceFn("get_my_unread_message_count()");
  assert.match(unread, /authentication required/, "authenticated-only");
  assert.match(unread, /sender_id <> caller|sender_id IS DISTINCT FROM caller/, "inbound messages only");
  assert.match(unread, /COUNT\(/, "computes total unread; no client-writable counter");
  assert.doesNotMatch(unread, /UPDATE public\.friend_conversation_reads|p_unread_count/, "does not store a client counter");
}

{
  const unfriend = sliceFn("unfriend_player(p_friend_id uuid)");
  assert.match(unfriend, /SECURITY DEFINER/, "unfriend is SECURITY DEFINER");
  assert.match(unfriend, /SET search_path = public/, "trusted search_path");
  assert.match(unfriend, /caller uuid := auth\.uid\(\)/, "actor is auth.uid()");
  assert.match(unfriend, /DELETE FROM public\.friendships/, "deletes only the friendship row");
  assert.match(unfriend, /cannot unfriend yourself/, "no self-unfriend");
  assert.doesNotMatch(unfriend, /DELETE FROM public\.friend_conversations/, "does not delete conversation");
  assert.doesNotMatch(unfriend, /DELETE FROM public\.friend_messages/, "old messages remain readable after unfriend");
  assert.doesNotMatch(unfriend, /DELETE FROM public\.friend_conversation_reads/, "does not delete historical read state");
}

{
  const protect = sliceFn("friend_messages_protect_immutable()");
  assert.match(protect, /friend_messages is immutable/, "message UPDATE/DELETE is blocked");
  assert.match(protect, /TG_OP = 'UPDATE'/, "UPDATE blocked");
  assert.match(protect, /TG_OP = 'DELETE'/, "client DELETE blocked");
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.friend_messages/, "append-only trigger");
}

{
  const before = sliceFn("friend_messages_before_insert()");
  assert.match(before, /NEW\.sender_id := auth\.uid\(\)/, "insert cannot spoof sender_id");
  assert.match(before, /NEW\.body := btrim\(NEW\.body\)/, "insert trims body");
}

mustInclude(/ENABLE ROW LEVEL SECURITY/, "RLS enabled");
mustInclude(/friend_conversations_select_participants/, "conversation SELECT is participant-authorized");
mustInclude(/friend_messages_select_participants/, "message SELECT is participant-authorized");
mustInclude(/friend_conversation_reads_select_own/, "read-state SELECT is participant-scoped");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR INSERT[\s\S]*friend_messages/, "no client INSERT policy on messages");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR UPDATE[\s\S]*friend_messages/, "no client UPDATE policy on messages");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR DELETE[\s\S]*friend_messages/, "no client DELETE policy on messages");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR INSERT[\s\S]*friend_conversations/, "no client INSERT policy on conversations");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR INSERT[\s\S]*friend_conversation_reads/, "no client INSERT policy on reads");

mustInclude(
  /REVOKE ALL ON TABLE public\.friend_conversations FROM PUBLIC, anon, authenticated/,
  "conversations fail closed"
);
mustInclude(
  /REVOKE ALL ON TABLE public\.friend_messages FROM PUBLIC, anon, authenticated/,
  "messages fail closed"
);
mustInclude(
  /REVOKE ALL ON TABLE public\.friend_conversation_reads FROM PUBLIC, anon, authenticated/,
  "reads fail closed"
);
mustInclude(/GRANT SELECT ON TABLE public\.friend_conversations TO authenticated/, "participants may SELECT conversations");
mustInclude(/GRANT SELECT ON TABLE public\.friend_messages TO authenticated/, "participants may SELECT messages");
mustInclude(
  /GRANT SELECT ON TABLE public\.friend_conversation_reads TO authenticated/,
  "participants may SELECT own read-state"
);
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.friend_conversations/, "no client write grants on conversations");
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.friend_messages/, "client roles cannot INSERT/UPDATE/DELETE message rows");
assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.friend_conversation_reads/, "no client write grants on reads");

mustInclude(
  /REVOKE ALL ON FUNCTION public\._can_friend_message\(uuid, uuid\) FROM PUBLIC, anon, authenticated/,
  "internal helper unavailable to client roles"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\._ensure_friend_conversation\(uuid, uuid\) FROM PUBLIC, anon, authenticated/,
  "ensure helper unavailable to client roles"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\._friend_message_contains_link\(text\) FROM PUBLIC, anon, authenticated/,
  "link helper unavailable to client roles"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\.send_friend_message\(uuid, text\) FROM PUBLIC/,
  "revoke send from PUBLIC"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\.send_friend_message\(uuid, text\) FROM anon/,
  "revoke send from anon"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.send_friend_message\(uuid, text\) TO authenticated/,
  "grant send to authenticated"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.list_my_friend_conversations\(\) TO authenticated/,
  "grant list conversations"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.list_friend_messages\(uuid, timestamptz, uuid, integer\) TO authenticated/,
  "grant list messages"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.mark_friend_conversation_read\(uuid\) TO authenticated/,
  "grant mark read"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.get_my_unread_message_count\(\) TO authenticated/,
  "grant unread count"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.unfriend_player\(uuid\) TO authenticated/,
  "grant unfriend"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\.unfriend_player\(uuid\) FROM PUBLIC/,
  "revoke unfriend from PUBLIC"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\.unfriend_player\(uuid\) FROM anon/,
  "revoke unfriend from anon"
);

mustInclude(/ALTER TABLE public\.friend_messages REPLICA IDENTITY FULL/, "Realtime replica identity");
mustInclude(/ADD TABLE public\.friend_messages/, "publish friend_messages");
assert.doesNotMatch(sql, /ADD TABLE public\.friend_conversations/, "do not publish conversations");
assert.doesNotMatch(sql, /ADD TABLE public\.friend_conversation_reads/, "do not publish read-state");

assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/, "does not touch Find Match accept");
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.commit_online_game_transition/, "does not touch gameplay");
assert.doesNotMatch(sql, /settle_match_global_rp|player_global_ratings|get_my_global_rating/, "does not touch Global RP");
assert.doesNotMatch(sql, /referral_qualifying_matches|ensure_my_referral_code|_generate_referral_code/, "does not touch Invite & Win");
assert.doesNotMatch(sql, /challenge_cp|league_lp|leo_coins|LeoCoins/i, "does not touch Challenge/League/LeoCoins");
assert.doesNotMatch(sql, /leo_best|LeoBest/i, "does not touch LeoBest");
assert.doesNotMatch(sql, /startOwnFriendsPresence|leo-presence/, "does not change Presence");
assert.doesNotMatch(sql, /notification_bell|push_token|player_push/i, "does not implement Notifications");

assert.match(
  foundation,
  /CONSTRAINT friendships_ordered_pair CHECK \(user_a < user_b\)/,
  "existing friendships canonical pair is unchanged"
);

console.log("  ✓ friend chat SQL contract");
