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
const fr = read("i18n/locales/fr.js");
const es = read("i18n/locales/es.js");
const pt = read("i18n/locales/pt.js");

assert.match(app, /"intro" \| "home" \| "gameStyle" \| "leopipsStake" \| "findMatch" \| "friends" \| "chat" \| "game"/);
assert.match(app, /<FindMatchPage/);
assert.match(app, /<LeoPipsAuthenticatedStake/);
assert.match(app, /onFindMatch=\{\(\) => setPhase\("leopipsStake"\)\}/);
assert.match(app, /phase === "findMatch"/);

{
  const slice = home.slice(
    home.indexOf("const handlePlayOnline"),
    home.indexOf("const goToStore")
  );
  assert.match(slice, /onFindMatch/);
  assert.doesNotMatch(slice, /showComingSoon/);
}

{
  const liveHome = read("pages/LeoPipsAuthenticatedHome.jsx");
  assert.match(liveHome, /onFindMatch/);
  assert.match(liveHome, /if \(resumeOnline\) onEnterMatch/);
  assert.doesNotMatch(liveHome, /LeoPipsStakePage|LEOPIPS_STAKE_TIERS|canEnterLeoPipsFindMatch/);
  assert.doesNotMatch(liveHome, /acceptMatchRequest/);
  assert.match(page, /lockedStyleId = ""/);
  assert.match(page, /lockedStake = null/);
  assert.match(app, /lockedStake=\{leopipsPick\?\.stake \?\? null\}/);
  assert.match(page, /data-find-match-style-picker=\{lockedId \? "hidden" : "visible"\}/);
  assert.match(page, /data-find-match-choose-style=\{lockedId \? "bypassed" : "visible"\}/);
  assert.match(app, /lockedStyleId=\{leopipsPick\?\.styleId/);
}

assert.match(page, /listV1GameStyles/, "Find Match picker is Classic/Haitian/American");
assert.match(page, /data-find-match-style/, "style buttons are marked");
assert.match(page, /createMatchRequest/, "create uses the matchmaking adapter");
assert.match(page, /acceptMatchRequest/, "accept uses the RPC adapter");
assert.match(page, /cancelMatchRequest/, "cancel uses the RPC adapter");
assert.match(page, /subscribeMatchRequests/, "subscribes to match_requests");
assert.match(page, /loadFindMatchBoard/, "loads open + own requests");
assert.match(page, /visibilitychange/, "F. Find Match refreshes on visibilitychange");
assert.match(page, /addEventListener\("focus"/, "F. Find Match refreshes on focus");
assert.match(page, /visibleFindMatchRequests/, "accepted requests cannot stay Waiting");
assert.match(page, /shouldPromoteAcceptedToMatchReady/);
assert.match(page, /FIND_MATCH_OPEN_POLL_MS/, "creator open-request poll fallback");
assert.match(page, /shouldPollOpenRequest/);
assert.match(page, /planOpenRequestPollTick/);
assert.match(page, /refreshInFlightRef/);
assert.match(page, /subscribeMatchRequests/, "Realtime remains the fast path");
assert.match(page, /findMatchDiag|buildFindMatchDiagSnapshot/, "temporary phone-repro diag");
assert.match(page, /noteFindMatchDiagTitleTap/, "hidden 5-tap title gesture");
assert.match(page, /data-find-match-diag/);
assert.doesNotMatch(page, /access_token|refresh_token|service_role/);

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
  assert.match(createBlock, /joinOrCreatePublicMatchRequest\(selectedId, lockedStakePips\)/);
  assert.doesNotMatch(createBlock, /createMatchRequest\(selectedId, lockedStakePips\)/);
  assert.match(createBlock, /createMatchRequest\(selectedId\)/);
  assert.match(createBlock, /joined\.outcome === "accepted"/);
  assert.doesNotMatch(createBlock, /Hosted RPC not applied yet|fall through to insert/i);
}
assert.match(page, /liveAcceptedPending/);
assert.doesNotMatch(page, /own\?\.status === "accepted" && !matched/);

{
  const acceptBlock = page.slice(
    page.indexOf("const handleAccept"),
    page.indexOf("const handleCancel")
  );
  assert.match(acceptBlock, /acceptMatchRequest\(/);
  assert.match(acceptBlock, /styleId: selectedId, stakePips: lockedStakePips/);
  assert.doesNotMatch(acceptBlock, /p_stake_pips\s*:/);
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
assert.match(page, /findMatch\.rankedPairLimit/);
assert.match(page, /case "RANKED_PAIR_LIMIT"/);
assert.match(page, /case "RANKED_PAIR_LIMIT":\s*return "findMatch\.rankedPairLimit"/);
assert.doesNotMatch(page, /case "RANKED_PAIR_LIMIT":\s*return "findMatch\.acceptError"/);
assert.match(en, /rankedPairLimit: "You already played this opponent 3 times in the last 24 hours\. Try again later\."/);
assert.match(ht, /rankedPairLimit: "Ou deja jwe ak advèsè sa a 3 fwa nan 24 èdtan ki sot pase yo\. Eseye ankò pita\."/);
assert.match(fr, /rankedPairLimit: "Vous avez déjà joué 3 fois contre cet adversaire au cours des 24 dernières heures\. Réessayez plus tard\."/);
assert.match(es, /rankedPairLimit: "Ya jugaste 3 veces contra este rival en las últimas 24 horas\. Inténtalo de nuevo más tarde\."/);
assert.match(pt, /rankedPairLimit: "Já jogou 3 vezes contra este adversário nas últimas 24 horas\. Tente novamente mais tarde\."/);
assert.match(page, /findMatch\.styleLocked/);
assert.match(page, /findMatch\.stakePips/);
assert.match(page, /findMatch\.lobbyMismatch/);
assert.match(page, /findMatch\.invalidStake/);
assert.match(en, /stakePips: "\{\{n\}\} LEOPIPS"/);
assert.match(ht, /stakePips: "\{\{n\}\} LEOPIPS"/);
assert.match(fr, /stakePips: "\{\{n\}\} LEOPIPS"/);
assert.match(es, /stakePips: "\{\{n\}\} LEOPIPS"/);
assert.match(pt, /stakePips: "\{\{n\}\} LEOPIPS"/);
assert.match(page, /data-find-match-lobby/);
assert.match(page, /board\.source !== "lobby-rpc"/);
assert.match(page, /request\.visibility !== "friend" && request\.stakePips != null/);
assert.doesNotMatch(
  page.slice(page.indexOf("const lobbyOk"), page.indexOf("const canAccept")),
  /request\.stakePips == null/
);
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
assert.equal(
  canAcceptMatchRequest(
    { creatorId: "a", status: "open", waitingHeartbeatAt: new Date().toISOString() },
    "b"
  ),
  true
);
assert.equal(
  canAcceptMatchRequest(
    { creatorId: "a", status: "open", expiresAt: "2020-01-01T00:00:00.000Z" },
    "b"
  ),
  false
);
assert.equal(isOwnMatchRequest({ creatorId: "a" }, "a"), true);

assert.match(page, /touchMyOpenPublicRequest/);
assert.match(page, /PUBLIC_REQUEST_HEARTBEAT_MS/);
assert.match(page, /findMatchDocumentIsHidden\(\)/);
assert.match(page, /cancelOwnOpenBestEffort/);
assert.match(page, /case "CREATOR_UNAVAILABLE"/);
assert.match(page, /case "CREATOR_UNAVAILABLE":\s*return "findMatch\.playerUnavailable"/);
assert.doesNotMatch(page, /pagehide|beforeunload/, "brief background must not cancel; heartbeat TTL is the fallback");
assert.match(en, /playerUnavailable: "Sorry, this player is no longer available\."/);

console.log("  ✓ Find Match UI contract");
