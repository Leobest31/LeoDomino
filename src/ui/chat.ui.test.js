/**
 * Live Chat UI contract — standalone page, not inside Profile.
 * Run: node src/ui/chat.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const home = read("pages/HomePage.jsx");
const page = read("pages/ChatPage.jsx");
const css = read("pages/ChatPage.css");
const friends = read("pages/FriendsPage.jsx");
const profile = read("components/ProfilePanel.jsx");
const adapter = read("online/friendChat.js");
const hook = read("hooks/useFriendChat.js");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");

assert.match(app, /"intro" \| "home" \| "gameStyle" \| "findMatch" \| "friends" \| "chat" \| "game"/);
assert.match(app, /<ChatPage/);
assert.match(app, /phase === "chat" && playable/);
assert.match(app, /onChat=\{\(\) => openChat\(null, "home"\)\}/);
assert.match(home, /data-home-cta="liveChat"/);
assert.match(home, /onChat\?\.\(\)/);
assert.doesNotMatch(profile, /data-chat|ChatPage|onOpenChat|liveChat/);
assert.doesNotMatch(profile, /sendFriendMessage|list_friend_messages/);

assert.match(page, /data-chat="true"/);
assert.match(page, /data-chat-list="true"/);
assert.match(page, /data-chat-thread="true"/);
assert.match(page, /data-chat-send="true"/);
assert.match(page, /data-chat-composer="true"/);
assert.match(page, /useFriendChat/);
assert.doesNotMatch(page, /type="file"|<input[^>]*file|video|audio\/|image\//);

assert.match(friends, /data-friends-message="true"/);
assert.match(friends, /onOpenChat/);
assert.match(css, /safe-area-inset/);
assert.match(css, /26\.5rem/);

assert.match(adapter, /rpc\("send_friend_message"/);
assert.match(adapter, /rpc\("list_my_friend_conversations"/);
assert.match(adapter, /rpc\("list_friend_messages"/);
assert.match(adapter, /rpc\("mark_friend_conversation_read"/);
assert.match(adapter, /rpc\("get_my_unread_message_count"/);
assert.match(adapter, /subscribeFriendMessages/);
assert.match(adapter, /table: "friend_messages"/);
assert.match(hook, /subscribeFriendMessages/);
assert.match(hook, /subscribeFriendships/);
assert.match(hook, /markFriendConversationRead/);
assert.match(hook, /chat\.notFriends/);

for (const catalog of [en, ht]) {
  assert.match(catalog, /chat:\s*\{/);
  assert.match(catalog, /linksBlocked:/);
  assert.match(catalog, /entry:/);
}

console.log("  ✓ Live Chat UI contract");
