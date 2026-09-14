/**
 * Phase 1 client traffic contracts — no 8s friends poll, no SQL/deploy.
 * Run: node src/online/friendsTraffic.phase1.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const hook = read("hooks/useFriends.js");
const adapter = read("online/friends.js");
const guarded = read("online/guardedRefresh.js");
const findMatch = read("pages/FindMatchPage.jsx");
const online = read("pages/OnlineGamePage.jsx");
const home = read("pages/HomePage.jsx");
const friendsPage = read("pages/FriendsPage.jsx");
const chatHook = read("hooks/useFriendChat.js");
const availability = read("hooks/useFindMatchAvailability.js");
const activeMatch = read("hooks/useActiveOnlineMatch.js");
const invites = read("hooks/useFriendMatchInvites.js");
const matchmaking = read("online/matchmaking.js");
const app = read("App.jsx");

{
  assert.doesNotMatch(hook, /8000/);
  assert.doesNotMatch(hook, /setInterval\([^,]+,\s*8\s*\*\s*1000/);
  assert.match(hook, /FRIENDS_FALLBACK_REFRESH_MS/);
  assert.match(hook, /Number\(fallbackMs\) >= 60000/);
  assert.match(hook, /visibilityState !== "visible"/);
  assert.match(hook, /createGuardedRefresh/);
  assert.match(hook, /refresh\(\{ force: true \}\)/);
  console.log("  ✓ friends board does not poll every 8s; initial load remains");
}

{
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /visibilityState === "visible"/);
  assert.match(guarded, /isHidden\(\)/);
  assert.match(guarded, /documentIsHidden/);
  console.log("  ✓ hidden page skips friends refresh; visible triggers one");
}

{
  assert.match(guarded, /if \(inFlight\)/);
  assert.match(guarded, /queued = true/);
  console.log("  ✓ in-flight refresh prevents overlap");
}

{
  assert.match(guarded, /REST_EVENT_COALESCE_MS/);
  assert.match(hook, /guard\.schedule\(\)/);
  console.log("  ✓ Realtime events coalesce");
}

{
  assert.match(guarded, /noteServiceFailure/);
  assert.match(guarded, /planOutageHealthTick/);
  assert.match(guarded, /classifyFriendsOutage/);
  assert.match(guarded, /httpStatusFromError\(error\) === 500/);
  console.log("  ✓ 503/500 outage suppresses friends storms");
}

{
  assert.match(online, /useFriendsBoard\(\{ watchOnline: false, fallbackMs: 0 \}\)/);
  assert.doesNotMatch(online, /setInterval[\s\S]{0,80}loadFriendsBoard/);
  assert.doesNotMatch(online, /fallbackMs:\s*FRIENDS/);
  console.log("  ✓ OnlineGamePage has no periodic friends-board RPC");
}

{
  assert.match(findMatch, /useFriendsBoard\(\{ watchOnline: false, fallbackMs: 0 \}\)/);
  assert.match(findMatch, /createGuardedRefresh/);
  assert.match(findMatch, /FriendButton|data-find-match-friend/);
  console.log("  ✓ Find Match does not use aggressive friend polling");
}

{
  assert.match(hook, /friendIdsKey/);
  assert.match(hook, /stableIdKey/);
  assert.match(hook, /\[onlineReady, watchOnline, friendIdsKey\]/);
  assert.doesNotMatch(hook, /subscribeFriendsPresence\(ids[\s\S]{0,40}listFriendsInActiveMatch/);
  console.log("  ✓ presence subscription depends on stable friend IDs");
}

{
  assert.match(hook, /guard\.dispose/);
  assert.match(hook, /clearInterval\(fallback\)/);
  assert.match(hook, /for \(const stop of stops\) stop\?\.\(\)/);
  assert.match(hook, /removeEventListener\("visibilitychange"/);
  console.log("  ✓ logout/navigation cleanup of timers and channels");
}

{
  assert.match(hook, /respondToFriendRequest\(requestId, "accept"\)/);
  assert.match(hook, /respondToFriendRequest\(requestId, "decline"\)/);
  assert.match(friendsPage, /friends\.accept/);
  assert.match(invites, /acceptMatchRequest/);
  assert.match(home, /useFriendMatchInvites/);
  assert.match(home, /inboxBadgeCount/);
  assert.match(chatHook, /subscribeFriendMessages/);
  assert.match(chatHook, /subscribeFriendships\(\(\) => \{[\s\S]*playerId/);
  console.log("  ✓ accept/decline, invites, inbox, live chat remain wired");
}

{
  assert.match(adapter, /leo-friend-requests:in:\$\{playerId\}/);
  assert.match(adapter, /leo-friend-requests:out:\$\{playerId\}/);
  assert.match(adapter, /receiver_id=eq\.\$\{playerId\}/);
  assert.match(adapter, /sender_id=eq\.\$\{playerId\}/);
  assert.match(adapter, /leo-friendships:a:\$\{playerId\}/);
  assert.match(adapter, /leo-friendships:b:\$\{playerId\}/);
  assert.match(adapter, /user_a=eq\.\$\{playerId\}/);
  assert.match(adapter, /user_b=eq\.\$\{playerId\}/);
  assert.match(hook, /friendRequestConcernsPlayer/);
  assert.match(hook, /friendshipConcernsPlayer/);
  console.log("  ✓ friend Realtime is filtered to the current player");
}

{
  assert.match(matchmaking, /matchRequestSubs = new WeakMap/);
  assert.match(availability, /guard\.schedule\(\)/);
  assert.match(activeMatch, /guard\.schedule\(\)/);
  assert.match(invites, /guard\.schedule\(\)/);
  assert.match(app, /useActiveOnlineMatch/);
  assert.match(home, /useFindMatchAvailability/);
  console.log("  ✓ match_requests subscriptions multiplex and coalesce");
}
