/**
 * Ranked Find Match 3-in-24h pair limit. No network.
 * Run: node src/online/rankedFindMatchPair.test.js
 */
import assert from "node:assert/strict";
import {
  RANKED_FIND_MATCH_PAIR_LIMIT,
  RANKED_FIND_MATCH_PAIR_WINDOW_MS,
  countQualifyingRankedPairMatches,
  excludeRankedPairBlockedRequests,
  isQualifyingRankedFindMatch,
  isRankedPairBlockedOpponent,
  matchSeatsArePair,
  nextJoinableOpenRequest,
  normalizePlayerPair,
  rankedFindMatchPairLimitReached,
} from "./rankedFindMatchPair.js";
import { canAcceptMatchRequest, countJoinableOpenRequests } from "./matchmaking.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const T0 = Date.parse("2026-08-31T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function ranked(partial) {
  return {
    rated: true,
    matchKind: "public",
    createdAt: new Date(T0).toISOString(),
    playerA: A,
    playerB: B,
    ...partial,
  };
}

function openReq(id, creatorId) {
  return {
    id,
    creatorId,
    status: "open",
    visibility: "public",
    waitingHeartbeatAt: new Date().toISOString(),
  };
}

assert.equal(RANKED_FIND_MATCH_PAIR_LIMIT, 3);
assert.equal(RANKED_FIND_MATCH_PAIR_WINDOW_MS, 24 * HOUR);
assert.deepEqual(normalizePlayerPair(A, B), [A, B]);
assert.deepEqual(normalizePlayerPair(B, A), [A, B]);
assert.equal(normalizePlayerPair(A, A), null);
assert.equal(matchSeatsArePair({ playerA: B, playerB: A }, A, B), true);
assert.equal(matchSeatsArePair({ playerA: A, playerB: C }, A, B), false);

{
  const none = [];
  assert.equal(countQualifyingRankedPairMatches(none, A, B, T0), 0);
  assert.equal(rankedFindMatchPairLimitReached(0), false);
  assert.equal(rankedFindMatchPairLimitReached(1), false, "match #1 allowed");
  assert.equal(rankedFindMatchPairLimitReached(2), false, "match #2 allowed");
  assert.equal(rankedFindMatchPairLimitReached(3), true, "match #4 rated/public blocked");
  assert.equal(rankedFindMatchPairLimitReached(4), true);
}

{
  const one = [ranked({ finishReason: "completed" })];
  assert.equal(countQualifyingRankedPairMatches(one, A, B, T0), 1);
  assert.equal(rankedFindMatchPairLimitReached(1), false);
}

{
  const two = [
    ranked({ createdAt: new Date(T0 - 5 * HOUR).toISOString() }),
    ranked({ createdAt: new Date(T0 - 2 * HOUR).toISOString() }),
  ];
  assert.equal(countQualifyingRankedPairMatches(two, A, B, T0), 2);
  assert.equal(rankedFindMatchPairLimitReached(2), false);
}

{
  const three = [
    ranked({ createdAt: new Date(T0 - 14 * HOUR).toISOString() }),
    ranked({ createdAt: new Date(T0 - 9 * HOUR).toISOString() }),
    ranked({ createdAt: new Date(T0 - 2 * HOUR).toISOString() }),
  ];
  assert.equal(countQualifyingRankedPairMatches(three, A, B, T0), 3);
  assert.equal(rankedFindMatchPairLimitReached(3), true, "first 3 allowed; 4th rejected");
  assert.equal(countQualifyingRankedPairMatches(three, B, A, T0), 3, "reversed player order is the same pair");
}

{
  const three = [
    ranked({ playerA: A, playerB: B }),
    ranked({ playerA: B, playerB: A }),
    ranked({ playerA: A, playerB: B }),
  ];
  assert.equal(countQualifyingRankedPairMatches(three, A, B, T0), 3);
  assert.equal(countQualifyingRankedPairMatches(three, A, C, T0), 0);
  assert.equal(rankedFindMatchPairLimitReached(3), true);
  assert.equal(isRankedPairBlockedOpponent(A, B, [B]), true);
  assert.equal(isRankedPairBlockedOpponent(A, C, [B]), false);
  assert.equal(isRankedPairBlockedOpponent(B, D, [A]), false);
}

{
  const rolling = [
    ranked({ createdAt: new Date(T0 - 24 * HOUR).toISOString() }),
    ranked({ createdAt: new Date(T0 - 8 * HOUR).toISOString() }),
    ranked({ createdAt: new Date(T0 - 1 * HOUR).toISOString() }),
  ];
  assert.equal(countQualifyingRankedPairMatches(rolling, A, B, T0), 3);
  assert.equal(countQualifyingRankedPairMatches(rolling, A, B, T0 + 1), 2);
  assert.equal(rankedFindMatchPairLimitReached(2), false);
}

{
  const friend = ranked({ rated: false, matchKind: "friend", finishReason: "completed" });
  assert.equal(isQualifyingRankedFindMatch(friend, T0), false);
  assert.equal(countQualifyingRankedPairMatches([friend, friend, friend, friend], A, B, T0), 0);
}

{
  const unratedPublic = ranked({ rated: false, matchKind: "public" });
  assert.equal(isQualifyingRankedFindMatch(unratedPublic, T0), false);
}

{
  const acceptedOnly = {
    rated: true,
    matchKind: "public",
    playerA: A,
    playerB: B,
    status: "ready",
    createdAt: new Date(T0).toISOString(),
  };
  assert.equal(isQualifyingRankedFindMatch(acceptedOnly, T0), true, "accepted match with no game_sessions still counts");
}

{
  assert.equal(isQualifyingRankedFindMatch(ranked({ finishReason: "forfeit" }), T0), true, "forfeit still counts");
  assert.equal(isQualifyingRankedFindMatch(ranked({ finishReason: "timeout" }), T0), true, "timeout still counts");
  assert.equal(isQualifyingRankedFindMatch(ranked({ finishReason: "completed" }), T0), true, "completed still counts");
  assert.equal(isQualifyingRankedFindMatch(ranked({ finishReason: "aborted" }), T0), true, "abandoned still counts");
  assert.equal(isQualifyingRankedFindMatch(ranked({ finishReason: "join_timeout" }), T0), true, "join_timeout still counts");
}

{
  const threeTerminal = [
    ranked({ finishReason: "forfeit" }),
    ranked({ finishReason: "timeout" }),
    ranked({ finishReason: "completed" }),
  ];
  assert.equal(countQualifyingRankedPairMatches(threeTerminal, A, B, T0), 3);
  assert.equal(rankedFindMatchPairLimitReached(3), true);
}

{
  const requests = [openReq("b", B), openReq("c", C)];
  const blocked = new Set([B]);
  const next = nextJoinableOpenRequest(requests, A, canAcceptMatchRequest, blocked);
  assert.equal(next.id, "c");
  assert.equal(next.creatorId, C);
  const visible = excludeRankedPairBlockedRequests(requests, A, blocked);
  assert.deepEqual(
    visible.map((row) => row.creatorId),
    [C]
  );
  assert.equal(countJoinableOpenRequests(requests, A, blocked), 1);
  assert.equal(isRankedPairBlockedOpponent(A, B, blocked), true);
  assert.equal(canAcceptMatchRequest(openReq("b", B), A), true);
  assert.equal(canAcceptMatchRequest(openReq("c", C), A), true);
}

{
  const friendInvite = {
    id: "f1",
    creatorId: B,
    status: "open",
    visibility: "friend",
    inviteeId: A,
  };
  assert.equal(canAcceptMatchRequest(friendInvite, A), false);
  assert.equal(isQualifyingRankedFindMatch({
    rated: false,
    matchKind: "friend",
    finishReason: "completed",
    createdAt: new Date(T0).toISOString(),
    playerA: A,
    playerB: B,
  }, T0), false);
}

console.log("  ✓ ranked Find Match pair limit contract");
