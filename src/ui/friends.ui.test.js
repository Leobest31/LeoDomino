/**
 * Friends UI contract — search, requests, status, Find Match Add Friend.
 * Run: node src/ui/friends.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const home = read("pages/HomePage.jsx");
const page = read("pages/FriendsPage.jsx");
const css = read("pages/FriendsPage.css");
const findMatch = read("pages/FindMatchPage.jsx");
const online = read("pages/OnlineGamePage.jsx");
const button = read("components/FriendButton.jsx");
const profile = read("components/ProfilePanel.jsx");
const hook = read("hooks/useFriends.js");
const adapter = read("online/friends.js");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");
const fr = read("i18n/locales/fr.js");
const es = read("i18n/locales/es.js");
const pt = read("i18n/locales/pt.js");

assert.match(app, /<FriendsPage/);
assert.match(app, /useOwnFriendsPresence/);
assert.match(app, /onFriends=\{\(\) => setPhase\("friends"\)\}/);
assert.match(home, /onOpenFriends/);
assert.match(profile, /data-profile-friends="true"/);
assert.doesNotMatch(home, /data-home-nav-item="friends"/);

assert.match(page, /data-friends="true"/);
assert.match(page, /data-friends-search="true"/);
assert.match(page, /data-friends-incoming="true"/);
assert.match(page, /data-friends-outgoing="true"/);
assert.match(page, /data-friends-list="true"/);
assert.match(page, /data-friends-play="true"/);
assert.match(page, /onPlayWithFriend/);
assert.doesNotMatch(page, /home\.comingSoonNotice/);
assert.match(page, /friends\.wantsToPlay/);
assert.match(page, /data-friend-match-invites="true"/);
assert.match(page, /data-friend-invite-accept="true"/);
assert.match(page, /data-friend-invite-decline="true"/);
assert.match(app, /sendFriendMatchInvite/);
assert.match(app, /onEnterMatch=\{handleEnterOnlineMatch\}/);
assert.match(page, /friends\.statusOnline/);
assert.match(page, /friends\.statusInMatch/);
assert.match(page, /friends\.statusOffline/);
assert.match(css, /friends__status--online/);
assert.match(css, /friends__status--inMatch/);
assert.match(css, /#5dff9a|#3de08c/);

assert.match(button, /data-friend-add="true"/);
assert.match(button, /data-friend-relation="friends"/);
assert.match(button, /data-friend-relation="outgoing"/);
assert.match(button, /data-friend-accept="true"/);
assert.match(button, /data-friend-decline="true"/);
assert.match(button, /data-friend-cancel="true"/);
assert.match(button, /FRIEND_RELATIONS\.self/);

assert.match(findMatch, /data-find-match-friend=\{matched\.opponent\.playerId\}/);
assert.match(findMatch, /matched\.opponent\.playerId !== playerId/);
assert.match(findMatch, /friends\.relationFor\(matched\.opponent\.playerId\)/);
assert.match(findMatch, /friends\.sendTo\(matched\.opponent\.playerId\)/);
assert.match(findMatch, /useFriendsBoard\(\{ watchOnline: false \}\)/);
assert.doesNotMatch(findMatch, /track\(|channel\("presence"|Presence/);
assert.doesNotMatch(
  findMatch.slice(findMatch.indexOf("const handleAccept"), findMatch.indexOf("const handleCancel")),
  /sendFriendRequest|FriendButton/
);

assert.match(online, /data-online-rival-friend=\{rival\.playerId\}/);
assert.match(online, /friends\.relationFor\(rival\.playerId\)/);
assert.match(online, /useFriendsBoard\(\{ watchOnline: false \}\)/);
assert.doesNotMatch(online, /submitGameAction[\s\S]{0,80}sendFriendRequest/);

assert.match(adapter, /PROFILE_PUBLIC_SELECT = "id, display_name, avatar_id, country_code"/);
assert.doesNotMatch(adapter, /email|phone|raw_user_meta/);
assert.match(adapter, /rpc\("send_friend_request"/);
assert.match(adapter, /rpc\("cancel_friend_request"/);
assert.match(adapter, /rpc\("respond_to_friend_request"/);
assert.match(adapter, /subscribeFriendRequests/);
assert.match(adapter, /leo-presence:/);
assert.match(hook, /startOwnFriendsPresence/);
assert.match(hook, /subscribeFriendsPresence/);
assert.match(hook, /listFriendsInActiveMatch/);

for (const catalog of [en, ht, fr, es, pt]) {
  assert.match(catalog, /friends:\s*\{/);
  assert.match(catalog, /addFriend:/);
  assert.match(catalog, /pending:/);
  assert.match(catalog, /incoming:/);
  assert.match(catalog, /outgoing:/);
  assert.match(catalog, /statusOnline:/);
  assert.match(catalog, /statusInMatch:/);
  assert.match(catalog, /statusOffline:/);
  assert.match(catalog, /wantsToPlay:/);
  assert.match(catalog, /inviteSent:/);
  assert.match(catalog, /searchPlaceholder:/);
}

console.log("  ✓ Friends UI contract");
