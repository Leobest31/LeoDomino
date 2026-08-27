/**
 * One-active-match accept semantics (mirrors accept_match_request).
 * Run: node src/online/matchmakingConcurrency.test.js
 */
import assert from "node:assert/strict";
import {
  MatchmakingError,
  isStaleMatchAcceptError,
  throwFromPostgrest,
} from "./matchmaking.js";

class MatchmakingErrorCode extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** In-memory replica of the accept transaction + occupancy unique. */
class MatchmakingStore {
  constructor() {
    this.requests = new Map();
    this.matches = new Map();
    this.active = new Map();
    this.seq = 0;
  }

  createRequest(creatorId, rulesetId = "legacy") {
    if (this.active.has(creatorId)) {
      throw new MatchmakingErrorCode("PLAYER_BUSY");
    }
    for (const row of this.requests.values()) {
      if (row.creatorId === creatorId && row.status === "open") {
        throw new MatchmakingErrorCode("ALREADY_OPEN");
      }
    }
    const id = `req-${++this.seq}`;
    const row = {
      id,
      creatorId,
      rulesetId,
      status: "open",
      matchId: null,
      acceptorId: null,
    };
    this.requests.set(id, row);
    return row;
  }

  accept(caller, requestId) {
    const request = this.requests.get(requestId);
    if (!request) throw new MatchmakingErrorCode("REQUEST_UNAVAILABLE");
    if (request.creatorId === caller) throw new MatchmakingErrorCode("SELF_ACCEPT");

    if (request.status === "accepted") {
      throw new MatchmakingErrorCode("REQUEST_ALREADY_ACCEPTED");
    }
    if (request.status !== "open") {
      throw new MatchmakingErrorCode("REQUEST_UNAVAILABLE");
    }

    if (this.active.has(request.creatorId) || this.active.has(caller)) {
      throw new MatchmakingErrorCode("PLAYER_BUSY");
    }

    const matchId = `match-${++this.seq}`;
    if (this.active.has(request.creatorId) || this.active.has(caller)) {
      throw new MatchmakingErrorCode("PLAYER_BUSY");
    }
    this.active.set(request.creatorId, matchId);
    this.active.set(caller, matchId);
    this.matches.set(matchId, {
      id: matchId,
      requestId: request.id,
      playerA: request.creatorId,
      playerB: caller,
      status: "ready",
      rulesetId: request.rulesetId,
    });
    request.status = "accepted";
    request.acceptorId = caller;
    request.matchId = matchId;

    for (const other of this.requests.values()) {
      if (
        other.status === "open" &&
        other.id !== request.id &&
        (other.creatorId === request.creatorId || other.creatorId === caller)
      ) {
        other.status = "cancelled";
      }
    }
    return this.matches.get(matchId);
  }

  finish(matchId) {
    const match = this.matches.get(matchId);
    match.status = "finished";
    if (this.active.get(match.playerA) === matchId) this.active.delete(match.playerA);
    if (this.active.get(match.playerB) === matchId) this.active.delete(match.playerB);
  }

  openList() {
    return [...this.requests.values()].filter((row) => row.status === "open");
  }

  activeMatchesFor(playerId) {
    return [...this.matches.values()].filter(
      (match) =>
        (match.playerA === playerId || match.playerB === playerId) &&
        (match.status === "ready" || match.status === "playing")
    );
  }
}

const A = "player-a";
const B = "player-b";
const C = "player-c";

{
  // Test 1 — same request double accept
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A, "legacy");
  const first = store.accept(B, requestA.id);
  assert.equal(store.matches.size, 1);
  assert.equal(first.playerA, A);
  assert.equal(first.playerB, B);
  assert.equal(first.rulesetId, "legacy");
  assert.throws(
    () => store.accept(C, requestA.id),
    (err) => err.code === "REQUEST_ALREADY_ACCEPTED"
  );
  assert.equal(store.matches.size, 1, "exactly one match");
  assert.equal(store.activeMatchesFor(A).length, 1);
  assert.equal(store.activeMatchesFor(B).length, 1);
  assert.equal(store.activeMatchesFor(C).length, 0);
}

{
  // Test 2 — busy acceptor with own request (the live 3-phone bug)
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A, "haitian");
  const requestB = store.createRequest(B, "american");
  assert.equal(store.openList().length, 2);
  const match = store.accept(B, requestA.id);
  assert.equal(match.rulesetId, "haitian", "acceptor cannot change creator style");
  assert.equal(store.requests.get(requestB.id).status, "cancelled");
  assert.equal(
    store.openList().some((row) => row.id === requestB.id),
    false,
    "Request B leaves the Find Match list"
  );
  assert.throws(
    () => store.accept(C, requestB.id),
    (err) => err.code === "REQUEST_UNAVAILABLE" || err.code === "PLAYER_BUSY"
  );
  assert.equal(store.activeMatchesFor(B).length, 1, "no second active match for B");
  assert.equal(store.matches.size, 1);
}

{
  // Test 3 — creator already busy, stale OPEN leftover
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A);
  store.accept(B, requestA.id);
  const stale = {
    id: "stale-a",
    creatorId: A,
    rulesetId: "legacy",
    status: "open",
    matchId: null,
    acceptorId: null,
  };
  store.requests.set(stale.id, stale);
  assert.throws(
    () => store.accept(C, stale.id),
    (err) => err.code === "PLAYER_BUSY"
  );
  assert.equal(store.matches.size, 1);
  assert.equal(store.activeMatchesFor(A).length, 1);
}

{
  // Test 4 — acceptor already busy
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A);
  const requestD = store.createRequest(C);
  store.accept(B, requestA.id);
  assert.throws(
    () => store.accept(B, requestD.id),
    (err) => err.code === "PLAYER_BUSY"
  );
  assert.equal(store.activeMatchesFor(B).length, 1);
  assert.equal(store.matches.size, 1);
}

{
  // Test 5 — completed match does not permanently block Find Match
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A);
  const match = store.accept(B, requestA.id);
  store.finish(match.id);
  assert.equal(store.activeMatchesFor(A).length, 0);
  assert.equal(store.activeMatchesFor(B).length, 0);
  const again = store.createRequest(A, "legacy");
  assert.equal(again.status, "open");
  const next = store.accept(C, again.id);
  assert.equal(next.playerA, A);
  assert.equal(next.playerB, C);
}

{
  // Test 6 — pairing cancels other OPEN rows so they disappear from the list
  const store = new MatchmakingStore();
  const requestA = store.createRequest(A);
  const requestB = store.createRequest(B);
  store.accept(B, requestA.id);
  const open = store.openList();
  assert.equal(open.length, 0);
  assert.equal(store.requests.get(requestA.id).status, "accepted");
  assert.equal(store.requests.get(requestB.id).status, "cancelled");
  assert.equal(store.requests.get(requestA.id).matchId, store.active.get(A));
}

{
  assert.throws(
    () => throwFromPostgrest({ message: "PLAYER_BUSY" }),
    (err) => err instanceof MatchmakingError && err.code === "PLAYER_BUSY"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "REQUEST_UNAVAILABLE" }),
    (err) => err instanceof MatchmakingError && err.code === "REQUEST_UNAVAILABLE"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "REQUEST_ALREADY_ACCEPTED" }),
    (err) => err instanceof MatchmakingError && err.code === "REQUEST_ALREADY_ACCEPTED"
  );
  assert.throws(
    () =>
      throwFromPostgrest({
        message: 'duplicate key value violates unique constraint "active_match_players_pkey"',
      }),
    (err) => err.code === "PLAYER_BUSY"
  );
  assert.equal(
    isStaleMatchAcceptError(new MatchmakingError("PLAYER_BUSY")),
    true
  );
  assert.equal(
    isStaleMatchAcceptError(new MatchmakingError("REQUEST_UNAVAILABLE")),
    true
  );
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("SELF_ACCEPT")), false);
}

console.log("  ✓ Find Match one-active-match concurrency");
