/**
 * Friends Live Chat client — mocked Supabase, no network.
 * Run: node src/online/friendChat.test.js
 */
import assert from "node:assert/strict";
import {
  FRIEND_MESSAGE_MAX,
  FriendChatError,
  chatErrorKey,
  conversationForFriend,
  formatInboxBadge,
  getMyUnreadMessageCount,
  inboxBadgeCount,
  listFriendMessages,
  listMyFriendConversations,
  markFriendConversationRead,
  messageContainsLink,
  normalizeConversation,
  sendFriendMessage,
  subscribeFriendMessages,
  throwFromChatError,
  unreadConversations,
  validateMessageBody,
} from "./friendChat.js";

{
  assert.equal(inboxBadgeCount({ incomingFriendRequests: 1, incomingMatchInvites: 1, unreadMessageCount: 3 }), 5);
  assert.equal(inboxBadgeCount({ incomingFriendRequests: 0, incomingMatchInvites: 0, unreadMessageCount: 0 }), 0);
  assert.equal(formatInboxBadge(0), "");
  assert.equal(formatInboxBadge(4), "4");
  assert.equal(formatInboxBadge(100), "99+");
}

{
  assert.equal(validateMessageBody("  hello  "), "");
  assert.equal(validateMessageBody("   "), "EMPTY");
  assert.equal(validateMessageBody("x".repeat(FRIEND_MESSAGE_MAX + 1)), "TOO_LONG");
  assert.equal(validateMessageBody("see https://example.com"), "LINKS");
  assert.equal(messageContainsLink("www.example.com"), true);
  assert.equal(messageContainsLink("hello friend"), false);
}

{
  const row = normalizeConversation({
    conversation_id: "c1",
    other_player_id: "p2",
    display_name: "Marie",
    avatar_id: "amina",
    country_code: "HT",
    last_message_preview: "hello",
    last_message_at: "2026-01-01T00:00:00Z",
    unread_count: 2,
    is_friend: true,
  });
  assert.equal(row.conversationId, "c1");
  assert.equal(row.otherPlayerId, "p2");
  assert.equal(row.unreadCount, 2);
  assert.equal(row.isFriend, true);
  assert.equal(unreadConversations([row, { ...row, conversationId: "c2", unreadCount: 0 }]).length, 1);
  assert.equal(conversationForFriend([row], "p2")?.conversationId, "c1");
}

{
  assert.equal(chatErrorKey({ code: "LINKS" }), "chat.linksBlocked");
  assert.equal(chatErrorKey({ code: "NOT_FRIENDS" }), "chat.notFriends");
  assert.throws(
    () => throwFromChatError({ message: "not friends" }),
    (error) => error instanceof FriendChatError && error.code === "NOT_FRIENDS"
  );
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.name = name;
      capture.args = args;
      return Promise.resolve({
        data: [
          {
            conversation_id: "c1",
            other_player_id: "p2",
            display_name: "Marie",
            unread_count: 1,
            is_friend: true,
          },
        ],
        error: null,
      });
    },
  };
  const rows = await listMyFriendConversations(client);
  assert.equal(capture.name, "list_my_friend_conversations");
  assert.equal(rows[0].displayName, "Marie");
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.name = name;
      capture.args = args;
      return Promise.resolve({
        data: [{ id: "m1", conversation_id: "c1", sender_id: "p2", body: "hi", created_at: "t" }],
        error: null,
      });
    },
  };
  const rows = await listFriendMessages("c1", { limit: 20 }, client);
  assert.equal(capture.name, "list_friend_messages");
  assert.equal(capture.args.p_conversation_id, "c1");
  assert.equal(rows[0].body, "hi");
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.name = name;
      capture.args = args;
      return Promise.resolve({
        data: { id: "m2", conversation_id: "c1", sender_id: "me", body: "hello", created_at: "t" },
        error: null,
      });
    },
  };
  const saved = await sendFriendMessage("p2", "  hello  ", client);
  assert.equal(capture.name, "send_friend_message");
  assert.equal(capture.args.p_friend_id, "p2");
  assert.equal(capture.args.p_body, "hello");
  assert.equal(saved.body, "hello");
  await assert.rejects(
    () => sendFriendMessage("p2", "https://bad.example", client),
    (error) => error instanceof FriendChatError && error.code === "LINKS"
  );
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.name = name;
      capture.args = args;
      return Promise.resolve({ data: null, error: null });
    },
  };
  await markFriendConversationRead("c1", client);
  assert.equal(capture.name, "mark_friend_conversation_read");
  assert.equal(capture.args.p_conversation_id, "c1");
}

{
  const client = {
    rpc(name) {
      assert.equal(name, "get_my_unread_message_count");
      return Promise.resolve({ data: 4, error: null });
    },
  };
  assert.equal(await getMyUnreadMessageCount(client), 4);
}

{
  const events = [];
  const removed = [];
  const channel = {
    on(kind, filter, handler) {
      assert.equal(kind, "postgres_changes");
      assert.equal(filter.table, "friend_messages");
      assert.equal(filter.event, "INSERT");
      channel.handler = handler;
      return channel;
    },
    subscribe() {
      return "SUBSCRIBED";
    },
  };
  const client = {
    channel(name) {
      assert.equal(name, "leo-friend-messages");
      return channel;
    },
    removeChannel(ch) {
      removed.push(ch);
    },
  };
  const stop = subscribeFriendMessages((payload) => events.push(payload), client);
  channel.handler({ new: { id: "m1" } });
  stop();
  assert.equal(events.length, 1);
  assert.equal(removed[0], channel);
}

console.log("  ✓ friend chat client");
