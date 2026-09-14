/**
 * Admin player messages SQL security/contract. No network.
 * Run: node src/online/sqlAdminPlayerMessages.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905160000_admin_player_messages.sql"),
  "utf8"
);
const staffSql = readFileSync(
  join(root, "supabase/migrations/20260828280000_staff_roles.sql"),
  "utf8"
);
const emailSql = readFileSync(
  join(root, "supabase/migrations/20260905140000_admin_get_player_email.sql"),
  "utf8"
);

function sliceFn(source, name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.match(staffSql, /CREATE OR REPLACE FUNCTION public\.is_staff/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.match(sql, /CREATE TABLE public\.admin_player_messages/);
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /admin_player_messages_select_own/);
assert.match(sql, /target_player_id = auth\.uid\(\)/);
assert.match(sql, /REVOKE ALL ON TABLE public\.admin_player_messages FROM PUBLIC, anon, authenticated/);
assert.match(sql, /GRANT SELECT ON TABLE public\.admin_player_messages TO authenticated/);
assert.doesNotMatch(sql, /GRANT INSERT ON TABLE public\.admin_player_messages/);
assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.admin_player_messages/);
assert.doesNotMatch(sql, /GRANT DELETE ON TABLE public\.admin_player_messages/);
assert.match(sql, /char_length\(message_text\) BETWEEN 1 AND 500/);
assert.match(sql, /message_text = btrim\(message_text\)/);
assert.match(sql, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.admin_player_messages/);

for (const name of [
  "admin_send_player_message(",
  "admin_list_player_messages(",
  "list_my_unread_admin_messages(",
  "mark_my_admin_message_read(",
]) {
  const fn = sliceFn(sql, name);
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path = public/);
  assert.match(fn, /authentication required/);
  assert.match(fn, /ERRCODE = '28000'/);
  assert.doesNotMatch(fn, /service_role|SERVICE_ROLE|VITE_/);
}

{
  const send = sliceFn(sql, "admin_send_player_message(");
  assert.match(send, /public\.is_staff\('moderator'\)/);
  assert.match(send, /staff required/);
  assert.match(send, /ERRCODE = '42501'/);
  assert.match(send, /player not found/);
  assert.match(send, /message required/);
  assert.match(send, /message too long/);
  assert.match(send, /char_length\(body\) > 500/);
  assert.match(send, /_admin_write_audit/);
  assert.match(send, /send_player_message/);
  assert.doesNotMatch(send, /leopips|wallet|progression|matchmaking|game_sessions/i);
}

{
  const list = sliceFn(sql, "admin_list_player_messages(");
  assert.match(list, /public\.is_staff\('moderator'\)/);
  assert.match(list, /target_player_id = p_player_id/);
}

{
  const unread = sliceFn(sql, "list_my_unread_admin_messages(");
  assert.doesNotMatch(unread, /is_staff/);
  assert.match(unread, /target_player_id = caller/);
  assert.match(unread, /read_at IS NULL/);
}

{
  const mark = sliceFn(sql, "mark_my_admin_message_read(");
  assert.doesNotMatch(mark, /is_staff/);
  assert.match(mark, /target_player_id = caller/);
  assert.match(mark, /COALESCE\(m\.read_at, now\(\)\)/);
  assert.match(mark, /message not found/);
}

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_send_player_message\(uuid, text\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_list_player_messages\(uuid, integer\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_my_unread_admin_messages\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_my_admin_message_read\(uuid\) TO authenticated/);
assert.doesNotMatch(sql, /TO anon;/);

assert.doesNotMatch(emailSql, /admin_player_messages|admin_send_player_message/);

console.log("  ✓ sqlAdminPlayerMessages contract");
