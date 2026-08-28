/**
 * Home notification bell — derived from friend requests, match invites, unread chat.
 * Run: node src/ui/inbox.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const home = read("pages/HomePage.jsx");
const panel = read("components/NotificationsPanel.jsx");
const adapter = read("online/friendChat.js");
const en = read("i18n/locales/en.js");

const header = home.slice(home.indexOf("home__header-end"), home.indexOf("home__avatar-btn"));
assert.match(header, /data-home-cta="notifications"/);
assert.doesNotMatch(header, /showComingSoon/);
assert.doesNotMatch(header, /HOME_PREVIEW\.notices/);
assert.match(header, /data-home-badge="true"/);
assert.match(home, /inboxBadgeCount/);
assert.match(home, /useFriendsBoard\(\{ watchOnline: false \}\)/);
assert.match(home, /useFriendMatchInvites/);
assert.match(home, /useFriendChat/);
assert.match(home, /<NotificationsPanel/);
assert.doesNotMatch(home, /CREATE TABLE.*notifications/i);

assert.match(panel, /data-inbox="true"/);
assert.match(panel, /data-inbox-friend-request/);
assert.match(panel, /data-inbox-match-invite/);
assert.match(panel, /data-inbox-chat/);
assert.match(panel, /friends\.accept/);
assert.match(panel, /invites\.accept/);
assert.match(panel, /onOpenChat/);

assert.match(adapter, /inboxBadgeCount/);
assert.match(adapter, /incomingFriendRequests/);
assert.match(adapter, /incomingMatchInvites/);
assert.match(adapter, /unreadMessageCount/);
assert.match(en, /inbox:\s*\{/);
assert.match(en, /friendRequestBody:/);
assert.match(en, /matchInviteBody:/);

console.log("  ✓ notification inbox UI contract");
