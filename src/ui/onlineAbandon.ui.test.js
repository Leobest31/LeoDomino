/**
 * Online abandon confirmation + friend PLAY wiring.
 * Run: node src/ui/onlineAbandon.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const onlinePage = read("pages/OnlineGamePage.jsx");
const hook = read("hooks/useOnlineMatch.js");
const app = read("App.jsx");
const friends = read("pages/FriendsPage.jsx");
const dialog = read("components/AbandonMatchDialog.jsx");
const modal = read("components/MatchOverModal.jsx");
const en = read("i18n/locales/en.js");

assert.match(onlinePage, /AbandonMatchDialog/);
assert.match(onlinePage, /const \[abandonIntent, setAbandonIntent\]/);
assert.match(onlinePage, /requestLeave/);
assert.match(onlinePage, /handleAbandonCancel/);
assert.match(onlinePage, /handleAbandonLeave/);
assert.match(onlinePage, /onMainMenu=\{requestLeave\}/);
assert.match(onlinePage, /onNewGame=\{\(\) => requestLeave\("home"\)\}/);
assert.match(onlinePage, /isForfeitView\(view\)/);
assert.match(onlinePage, /online\.matchWonForfeit/);
assert.match(onlinePage, /online\.matchLostForfeit/);
assert.match(
  onlinePage.slice(onlinePage.indexOf("const handleAbandonCancel"), onlinePage.indexOf("const handleAbandonLeave")),
  /setAbandonIntent\(null\)/
);
assert.doesNotMatch(
  onlinePage.slice(onlinePage.indexOf("const handleAbandonCancel"), onlinePage.indexOf("const handleAbandonLeave")),
  /leave\(|onMainMenu/
);
assert.doesNotMatch(
  onlinePage.slice(onlinePage.indexOf("const handleAbandonLeave"), onlinePage.indexOf("const tableEpochRef")),
  /onMainMenu/,
  "abandon confirm stays on the table for the match report"
);
assert.match(dialog, /game\.abandonBody/);
assert.match(dialog, /common\.cancel/);
assert.match(dialog, /data-abandon-leave="true"/);
assert.match(dialog, /disabled=\{busy\}/);
assert.match(dialog, /data-abandon-error=\{errorKey\}/);
assert.match(dialog, /stopPropagation/);
assert.match(modal, /message/);
assert.match(en, /matchWonForfeit:/);
assert.match(en, /matchLostForfeit:/);
assert.match(en, /forfeitFailed:/);

assert.match(onlinePage, /leavingRef\.current = true/);
assert.match(onlinePage, /\.finally\(/);
assert.match(onlinePage, /busy=\{leaving\}/);
assert.match(onlinePage, /errorKey=\{errorKey\}/);
assert.match(onlinePage, /if \(!ok\) return/);

assert.match(hook, /forfeitOnlineMatch/);
assert.match(hook, /forfeitOnlineMatch\(id\)/);
assert.match(hook, /reportError\(error/);
assert.match(hook, /online forfeit failed/);
assert.match(hook, /FORFEIT_FAILED/);
assert.doesNotMatch(
  hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {")),
  /error\?\.code === "NOT_FOUND"/
);
assert.doesNotMatch(
  hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {")),
  /unmountedRef\.current = true[\s\S]*forfeitOnlineMatch/
);
assert.match(hook, /clearOnlineSession\(\)/);
assert.match(hook, /touchMyMatchPresence/);
assert.match(hook, /MATCH_PRESENCE_HEARTBEAT_MS/);
assert.match(hook, /visibilitychange/);
assert.doesNotMatch(hook, /beforeunload/);
assert.match(app, /match.status === "aborted"/);
assert.doesNotMatch(app, /match.status === "aborted" \|\| match.status === "finished"/);
assert.match(app, /cleanupStaleOccupiedMatches/);
assert.match(app, /clearOnlineSession/);

assert.match(friends, /onPlayWithFriend\?\.\(person\)/);
assert.doesNotMatch(friends, /home\.comingSoonNotice/);
assert.match(friends, /data-friend-match-invites/);
assert.match(friends, /friends\.wantsToPlay/);
assert.match(friends, /data-friend-invite-accept/);
assert.match(friends, /data-friend-invite-decline/);
assert.match(app, /sendFriendMatchInvite/);
assert.match(app, /setFriendInvitee\(person\)/);
assert.match(app, /onEnterMatch=\{handleEnterOnlineMatch\}/);
assert.doesNotMatch(app, /rulesetId: "classic"/);
assert.doesNotMatch(app, /allFives/);

console.log("  ✓ online abandon + friend invite UI contract");
