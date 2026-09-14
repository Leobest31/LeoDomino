/**
 * Creator Find Match poll fallback — occupancy wins without Realtime.
 * Run: node src/online/findMatchPoll.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIND_MATCH_OPEN_POLL_MS,
  applyCreatorDiscoverySnapshot,
  documentIsHidden,
  planOpenRequestPollTick,
  shouldPollOpenRequest,
} from "./findMatchPoll.js";
import { shouldPromoteAcceptedToMatchReady } from "./matchRecovery.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "pages", "FindMatchPage.jsx"), "utf8");

const MATCH_ID = "05f85dc2-d19d-41be-a446-aa6eca180f1f";
const OPEN_OWN = { id: "req-1", status: "open", creatorId: "creator-a" };
const ACCEPTED_OWN = { id: "req-1", status: "accepted", matchId: MATCH_ID, creatorId: "creator-a" };
const LIVE = { id: MATCH_ID, status: "playing" };

{
  assert.equal(FIND_MATCH_OPEN_POLL_MS, 2500, "poll interval is 2.5s");
  assert.ok(FIND_MATCH_OPEN_POLL_MS >= 2000 && FIND_MATCH_OPEN_POLL_MS <= 3000);
}

{
  const created = applyCreatorDiscoverySnapshot({ localOwn: OPEN_OWN, occupancyMatch: null });
  assert.equal(created.showWaiting, true, "A. local own open shows YOUR REQUEST");
  assert.equal(created.showCancel, true, "A. Cancel stays while waiting");
  assert.equal(created.showMatchReady, false);
  assert.equal(created.poll, true, "A. poll arms while locally open");
}

{
  const beforeRealtime = applyCreatorDiscoverySnapshot({
    localOwn: OPEN_OWN,
    occupancyMatch: LIVE,
    occupancyUnknown: false,
  });
  assert.equal(beforeRealtime.showMatchReady, true, "B/C. occupancy without Realtime promotes Match Ready");
  assert.equal(beforeRealtime.matchId, MATCH_ID, "E. same match_id");
  assert.equal(beforeRealtime.showWaiting, false, "D. YOUR REQUEST disappears");
  assert.equal(beforeRealtime.showCancel, false, "D. Cancel disappears");
  assert.equal(beforeRealtime.poll, false, "G. poll stops after discovery");
}

{
  assert.equal(planOpenRequestPollTick({ ownStatus: "open", hasMatched: false }).action, "refresh", "C. open tick refreshes");
  assert.equal(
    planOpenRequestPollTick({ ownStatus: "open", hasMatched: true }).action,
    "stop",
    "G. matched stops polling"
  );
  assert.equal(planOpenRequestPollTick({ ownStatus: "accepted", hasMatched: false }).action, "refresh");
  assert.equal(shouldPollOpenRequest({ onlineReady: true, ownStatus: "open", hasMatched: false }), true);
  assert.equal(shouldPollOpenRequest({ onlineReady: true, ownStatus: "open", hasMatched: true }), false);
  assert.equal(shouldPollOpenRequest({ onlineReady: true, ownStatus: "accepted", hasMatched: false }), true);
  assert.equal(shouldPollOpenRequest({ onlineReady: true, ownStatus: "accepted", hasMatched: true }), false);
}

{
  const hiddenDoc = { visibilityState: "hidden" };
  const visibleDoc = { visibilityState: "visible" };
  assert.equal(documentIsHidden(hiddenDoc), true, "H. hidden document");
  assert.equal(documentIsHidden(visibleDoc), false);
  assert.equal(
    planOpenRequestPollTick({
      hidden: documentIsHidden(hiddenDoc),
      ownStatus: "open",
      hasMatched: false,
    }).action,
    "skip",
    "H. hidden tick does not refresh"
  );
}

{
  assert.equal(
    shouldPromoteAcceptedToMatchReady(OPEN_OWN, LIVE),
    true,
    "J. occupancy wins over stale own.status === open"
  );
  const accepted = applyCreatorDiscoverySnapshot({ localOwn: ACCEPTED_OWN, occupancyMatch: LIVE });
  assert.equal(accepted.showMatchReady, true);
  assert.equal(accepted.matchId, MATCH_ID);
}

{
  const acceptedWaiting = applyCreatorDiscoverySnapshot({
    localOwn: ACCEPTED_OWN,
    occupancyMatch: null,
    hydratedAcceptedMatch: LIVE,
  });
  assert.equal(acceptedWaiting.showMatchReady, true, "accepted + hydrate → Match Ready");
  assert.equal(acceptedWaiting.matchId, MATCH_ID);
  assert.equal(acceptedWaiting.poll, false);

  const acceptedPending = applyCreatorDiscoverySnapshot({
    localOwn: ACCEPTED_OWN,
    occupancyMatch: null,
  });
  assert.equal(acceptedPending.showWaiting, true, "accepted without Match Ready keeps waiting UI");
  assert.equal(acceptedPending.showMatchReady, false);
  assert.equal(acceptedPending.poll, true, "keep polling until Match Ready");
}

{
  assert.match(page, /FIND_MATCH_OPEN_POLL_MS/);
  assert.match(page, /planOpenRequestPollTick/);
  assert.match(page, /shouldPollOpenRequest/);
  assert.match(page, /setInterval\(tick, FIND_MATCH_OPEN_POLL_MS\)/);
  assert.match(page, /subscribeMatchRequests/, "I. Realtime remains");
  assert.match(page, /visibilitychange/, "I. focus/visibility refresh remains");
  assert.match(page, /addEventListener\("focus"/);
  assert.match(page, /loadFindMatchBoard/, "refresh loads own request");
  assert.match(page, /getMyActiveMatch/, "refresh loads occupancy");
  assert.match(page, /refreshInFlightRef/, "in-flight guard");
  assert.match(page, /data-find-match-accepted-pending/, "accepted without Match Ready is not a blank route");
  assert.match(page, /own\?\.status === "accepted"/, "creator accepted stays visible until Match Ready");
  const pollBlock = page.slice(page.indexOf("shouldPollOpenRequest"), page.indexOf("const handleSelect"));
  assert.match(pollBlock, /void refresh\(\)/);
  assert.doesNotMatch(pollBlock, /createMatchRequest|acceptMatchRequest/, "F. poll does not create or accept");
  assert.doesNotMatch(page, /onEnterMatch\?\.\(\{[\s\S]*poll/);
  assert.doesNotMatch(
    page.slice(page.indexOf("setInterval(tick, FIND_MATCH_OPEN_POLL_MS)") - 400, page.indexOf("const handleSelect")),
    /onEnterMatch/,
    "4. poll does not auto-enter the table"
  );
}

{
  const acceptBlock = page.slice(page.indexOf("const handleAccept"), page.indexOf("const handleCancel"));
  assert.match(acceptBlock, /acceptMatchRequest\(/, "I. acceptor RPC path unchanged");
  assert.doesNotMatch(acceptBlock, /onEnterMatch/);
}

console.log("  ✓ creator Find Match poll fallback");
