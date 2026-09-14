/**
 * Admin player message client + merge/queue helpers. No network.
 * Run: node src/online/adminPlayerMessages.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";
import {
  ADMIN_PLAYER_MESSAGE_MAX,
  fetchAdminPlayerMessages,
  isLeoPipsVictoryOverlayOpen,
  listMyUnreadAdminMessages,
  markMyAdminMessageRead,
  mergeAdminMessageQueue,
  normalizeAdminPlayerMessage,
  sendAdminPlayerMessage,
  subscribeMyAdminPlayerMessages,
  trimAdminPlayerMessage,
  validateAdminPlayerMessage,
} from "./adminPlayerMessages.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = readFileSync(join(root, "src/pages/AdminPage.jsx"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");
const overlay = readFileSync(join(root, "src/components/AdminPlayerMessageOverlay.jsx"), "utf8");
const onlineGame = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
const gameplay = readFileSync(join(root, "src/online/gameplayHandler.js"), "utf8");
const matchmaking = readFileSync(join(root, "src/online/matchmaking.js"), "utf8");
const emailClient = readFileSync(join(root, "src/online/adminV1.js"), "utf8");

assert.equal(validateAdminPlayerMessage(""), "EMPTY");
assert.equal(validateAdminPlayerMessage("   \n\t  "), "EMPTY");
assert.equal(validateAdminPlayerMessage("hi"), "");
assert.equal(validateAdminPlayerMessage("a".repeat(ADMIN_PLAYER_MESSAGE_MAX)), "");
assert.equal(validateAdminPlayerMessage("a".repeat(ADMIN_PLAYER_MESSAGE_MAX + 1)), "TOO_LONG");
assert.equal(trimAdminPlayerMessage("  hello   world  "), "hello world");

{
  const row = normalizeAdminPlayerMessage({
    id: "m1",
    target_player_id: "p1",
    created_by: "staff",
    message_text: "Hello",
    created_at: "2026-09-05T12:00:00Z",
    read_at: null,
  });
  assert.equal(row.seen, false);
  assert.equal(row.messageText, "Hello");
  const seen = normalizeAdminPlayerMessage({ ...row, read_at: "2026-09-05T12:01:00Z" });
  assert.equal(seen.seen, true);
}

{
  const calls = [];
  const client = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        data: {
          id: "m1",
          target_player_id: payload.p_player_id,
          created_by: "staff",
          message_text: payload.p_message,
          created_at: "2026-09-05T12:00:00Z",
          read_at: null,
        },
        error: null,
      };
    },
  };
  const out = await sendAdminPlayerMessage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "  Hi  ", client);
  assert.equal(calls[0].name, "admin_send_player_message");
  assert.equal(calls[0].payload.p_message, "Hi");
  assert.equal(out.messageText, "Hi");
}

await assert.rejects(
  () => sendAdminPlayerMessage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "   ", { rpc: async () => ({}) }),
  (error) => error instanceof AdminError && error.code === ADMIN_ERROR.GENERIC
);

await assert.rejects(
  () =>
    sendAdminPlayerMessage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "x".repeat(501), {
      rpc: async () => ({}),
    }),
  (error) => error instanceof AdminError && /too long/i.test(error.message)
);

{
  const client = {
    rpc: async (name) => {
      assert.equal(name, "admin_list_player_messages");
      return {
        data: {
          player_id: "p1",
          items: [
            {
              id: "m1",
              target_player_id: "p1",
              message_text: "A",
              created_at: "2026-09-05T12:00:00Z",
              read_at: null,
            },
          ],
        },
        error: null,
      };
    },
  };
  const pageOut = await fetchAdminPlayerMessages("p1", 20, client);
  assert.equal(pageOut.items.length, 1);
  assert.equal(pageOut.items[0].seen, false);
}

{
  const client = {
    rpc: async (name) => {
      assert.equal(name, "list_my_unread_admin_messages");
      return {
        data: [
          {
            id: "m2",
            target_player_id: "me",
            message_text: "Unread",
            created_at: "2026-09-05T12:00:00Z",
            read_at: null,
          },
        ],
        error: null,
      };
    },
  };
  const rows = await listMyUnreadAdminMessages(client);
  assert.equal(rows[0].id, "m2");
}

{
  const client = {
    rpc: async (name, payload) => {
      assert.equal(name, "mark_my_admin_message_read");
      assert.equal(payload.p_message_id, "m2");
      return { data: { ok: true, id: "m2", read_at: "2026-09-05T12:05:00Z" }, error: null };
    },
  };
  const out = await markMyAdminMessageRead("m2", client);
  assert.equal(out.ok, true);
  assert.equal(out.readAt, "2026-09-05T12:05:00Z");
}

{
  const client = {
    rpc: async () => ({
      data: null,
      error: { message: "staff required", code: "42501" },
    }),
  };
  await assert.rejects(
    () => sendAdminPlayerMessage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "x", client),
    (error) => error instanceof AdminError && error.code === ADMIN_ERROR.FORBIDDEN
  );
}

{
  const client = {
    rpc: async () => ({
      data: null,
      error: { message: "message not found", code: "P0002" },
    }),
  };
  await assert.rejects(
    () => markMyAdminMessageRead("other-players-message", client),
    (error) => error instanceof AdminError
  );
}

{
  const a = {
    id: "m1",
    targetPlayerId: "p",
    messageText: "one",
    createdAt: "2026-09-05T12:00:01Z",
  };
  const b = {
    id: "m0",
    targetPlayerId: "p",
    messageText: "zero",
    createdAt: "2026-09-05T12:00:00Z",
  };
  const merged = mergeAdminMessageQueue([a], [a, b]);
  assert.deepEqual(
    merged.map((row) => row.id),
    ["m0", "m1"]
  );
}

{
  let filter = null;
  const client = {
    channel(name) {
      assert.match(name, /^leo-admin-player-messages:/);
      return {
        on(_type, spec, _cb) {
          filter = spec;
          return this;
        },
        subscribe() {
          return this;
        },
      };
    },
    removeChannel() {},
  };
  const stop = subscribeMyAdminPlayerMessages("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", () => {}, client);
  assert.equal(filter.table, "admin_player_messages");
  assert.equal(filter.event, "INSERT");
  assert.match(filter.filter, /target_player_id=eq\.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  stop();
}

{
  const fake = {
    querySelector(sel) {
      return sel === "[data-leopips-victory]" ? { tag: "div" } : null;
    },
  };
  assert.equal(isLeoPipsVictoryOverlayOpen(fake), true);
  assert.equal(isLeoPipsVictoryOverlayOpen({ querySelector: () => null }), false);
}

assert.match(page, /data-admin-send-message/);
assert.match(page, /data-admin-message-compose/);
assert.match(page, /data-admin-message-history/);
assert.match(page, /sendAdminPlayerMessage/);
assert.match(page, /fetchAdminPlayerMessages/);
assert.match(page, /data-admin-player-email/);
assert.match(app, /useAdminPlayerMessages/);
assert.match(app, /AdminPlayerMessageOverlay/);
assert.match(overlay, /adminMessage\.title/);
assert.match(overlay, /data-admin-player-message-overlay/);
assert.match(overlay, /z-index: 15000|createPortal/);
assert.doesNotMatch(onlineGame, /adminPlayerMessages|AdminPlayerMessageOverlay|useAdminPlayerMessages/);
assert.doesNotMatch(gameplay, /admin_player_messages|admin_send_player_message/);
assert.doesNotMatch(matchmaking, /admin_player_messages|admin_send_player_message/);
assert.doesNotMatch(emailClient, /admin_send_player_message|admin_player_messages/);

console.log("  ✓ adminPlayerMessages client contract");
