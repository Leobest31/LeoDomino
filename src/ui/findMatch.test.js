/**
 * Find Match UI contract — style pick, public requests, accept/cancel.
 * Run: node src/ui/findMatch.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listV1GameStyles } from "../data/gameStyles.js";
import {
  canAcceptMatchRequest,
  isOwnMatchRequest,
  toFindMatchRulesetId,
} from "../online/matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("pages/FindMatchPage.jsx");
const app = read("App.jsx");
const home = read("pages/HomePage.jsx");
const css = read("pages/FindMatchPage.css");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");

assert.match(app, /"intro" \| "home" \| "gameStyle" \| "findMatch" \| "friends" \| "game"/);
assert.match(app, /<FindMatchPage/);
assert.match(app, /onFindMatch=\{\(\) => setPhase\("findMatch"\)\}/);
assert.match(app, /phase === "findMatch"/);

{
  const slice = home.slice(
    home.indexOf("const handlePlayOnline"),
    home.indexOf("const goToStore")
  );
  assert.match(slice, /onFindMatch/);
  assert.doesNotMatch(slice, /showComingSoon/);
}

assert.match(page, /listV1GameStyles/, "Find Match picker is Classic/Haitian/American");
assert.match(page, /data-find-match-style/, "style buttons are marked");
assert.match(page, /createMatchRequest/, "create uses the matchmaking adapter");
assert.match(page, /acceptMatchRequest/, "accept uses the RPC adapter");
assert.match(page, /cancelMatchRequest/, "cancel uses the RPC adapter");
assert.match(page, /subscribeMatchRequests/, "subscribes to match_requests");
assert.match(page, /loadFindMatchBoard/, "loads open + own requests");

{
  const home = read("pages/HomePage.jsx");
  assert.match(home, /useFindMatchAvailability/, "Home reads live Find Match availability");
  assert.match(home, /data-find-match-available/, "Home Find Match button has an availability light");
  assert.doesNotMatch(home, /acceptMatchRequest/, "Home does not accept requests");
}

assert.doesNotMatch(page, /supabaseClient|@supabase\/supabase-js/, "page does not import the client");
assert.doesNotMatch(page, /track\(|channel\("presence"|Presence/, "no Presence");
assert.doesNotMatch(page, /chat|sendMessage/, "no live chat");
assert.match(page, /onEnterMatch/, "Match ready can enter the accepted match");
assert.match(page, /matchId: matched\.id/, "uses the accepted match id");
assert.match(page, /data-find-match-friend=\{matched\.opponent\.playerId\}/, "Add Friend uses opponent profile id");
assert.match(page, /matched\.opponent\.playerId !== playerId/, "cannot add self from Find Match");
assert.match(page, /useFriendsBoard\(\{ watchOnline: false \}\)/, "Find Match does not listen to friend presence");
assert.doesNotMatch(
  page,
  /enterOnlineMatch|getGameView|submitGameAction|game_sessions|game_secrets/,
  "Find Match delegates live table entry to App"
);
assert.doesNotMatch(page, /insert\(\{[^}]*creator_id/, "does not write creator_id");
assert.doesNotMatch(page, /from\("match_requests"\)/, "no direct table writes in the page");

{
  const createBlock = page.slice(
    page.indexOf("const handleCreate"),
    page.indexOf("const handleAccept")
  );
  assert.match(createBlock, /createMatchRequest\(selectedId\)/);
}

{
  const acceptBlock = page.slice(
    page.indexOf("const handleAccept"),
    page.indexOf("const handleCancel")
  );
  assert.match(acceptBlock, /acceptMatchRequest\(/);
  assert.doesNotMatch(acceptBlock, /rulesetId|selectedId|styleId/);
  assert.match(acceptBlock, /canAcceptMatchRequest/);
  assert.match(acceptBlock, /isStaleMatchAcceptError/);
  assert.match(acceptBlock, /const key = errorMessageKey\(error\)/);
  assert.match(acceptBlock, /await refresh\(\)/);
  assert.match(acceptBlock, /setErrorKey\(key\)/);
  assert.match(acceptBlock, /setMatched\(null\)/);
  assert.doesNotMatch(acceptBlock, /onEnterMatch/);
}

assert.match(page, /canAcceptMatchRequest\(request, playerId\)/);
assert.match(page, /data-find-match-accept/);
assert.match(page, /data-find-match-cancel/);
assert.match(page, /data-find-match-ruleset/);
assert.match(page, /data-find-match-state/);
assert.match(page, /findMatch\.creating/);
assert.match(page, /findMatch\.accepting/);
assert.match(page, /findMatch\.empty/);
assert.match(page, /findMatch\.loading/);
assert.match(page, /findMatch\.error/);
assert.match(page, /findMatch\.unavailable/);
assert.match(page, /findMatch\.matchReady/);
assert.match(page, /findMatch\.statusOpen/);
assert.match(page, /findMatch\.cannotAcceptOwn/);
assert.match(page, /findMatch\.styleLocked/);
assert.match(page, /findMatch\.enterTable/);

assert.match(css, /max-width:\s*26\.5rem|width:\s*min\(100%,\s*26\.5rem\)/);
assert.match(css, /env\(safe-area-inset-bottom/);
assert.match(css, /100svh|100dvh|flex:\s*1/);

assert.match(en, /findMatch:\s*\{/);
assert.match(ht, /findMatch:\s*\{/);
assert.match(page, /findMatch\.playerUnavailable/);
assert.match(page, /findMatch\.alreadyInMatch/);
assert.match(en, /playerUnavailable:/);
assert.match(ht, /playerUnavailable:/);
assert.match(en, /styleLocked:/);

const styles = listV1GameStyles();
assert.deepEqual(
  styles.map((entry) => entry.id),
  ["classic", "haitian", "american"]
);
assert.equal(toFindMatchRulesetId("classic"), "legacy");
assert.equal(canAcceptMatchRequest({ creatorId: "a", status: "open" }, "a"), false);
assert.equal(canAcceptMatchRequest({ creatorId: "a", status: "open" }, "b"), true);
assert.equal(
  canAcceptMatchRequest(
    { creatorId: "a", status: "open", expiresAt: "2020-01-01T00:00:00.000Z" },
    "b"
  ),
  false
);
assert.equal(isOwnMatchRequest({ creatorId: "a" }, "a"), true);

console.log("  ✓ Find Match UI contract");
