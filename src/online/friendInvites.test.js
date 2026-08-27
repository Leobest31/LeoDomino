/**
 * Friend-match invitation + forfeit races (in-memory replica of the RPCs).
 * Run: node src/online/friendInvites.test.js
 */
import assert from "node:assert/strict";
import {
  MatchmakingError,
  canAcceptMatchRequest,
  friendInviteErrorKey,
  isStaleMatchAcceptError,
  normalizeMatchRequest,
  throwFromPostgrest,
} from "./matchmaking.js";

class MatchmakingErrorCode extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

class FriendInviteStore {
  constructor() {
    this.friends = new Set();
    this.requests = new Map();
    this.matches = new Map();
    this.active = new Map();
    this.seq = 0;
  }

  pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  befriend(a, b) {
    this.friends.add(this.pairKey(a, b));
  }

  isFriend(a, b) {
    return this.friends.has(this.pairKey(a, b));
  }

  send(caller, inviteeId, rulesetId = "legacy") {
    if (!caller) throw new MatchmakingErrorCode("AUTH");
    if (caller === inviteeId) throw new MatchmakingErrorCode("SELF_INVITE");
    if (!this.isFriend(caller, inviteeId)) throw new MatchmakingErrorCode("NOT_FRIENDS");
    if (this.active.has(caller) || this.active.has(inviteeId)) {
      throw new MatchmakingErrorCode("PLAYER_BUSY");
    }
    for (const row of this.requests.values()) {
      if (row.status !== "open" || row.visibility !== "friend") continue;
      if (this.pairKey(row.creatorId, row.inviteeId) === this.pairKey(caller, inviteeId)) {
        throw new MatchmakingErrorCode("ALREADY_OPEN");
      }
    }
    const id = `req-${++this.seq}`;
    const row = {
      id,
      creatorId: caller,
      inviteeId,
      visibility: "friend",
      rulesetId,
      status: "open",
      matchId: null,
      acceptorId: null,
    };
    this.requests.set(id, row);
    return row;
  }

  decline(caller, requestId) {
    const row = this.requests.get(requestId);
    if (!row || row.visibility !== "friend" || row.inviteeId !== caller) {
      throw new MatchmakingErrorCode("NOT_INVITEE");
    }
    if (row.status === "declined") return row;
    if (row.status !== "open") throw new MatchmakingErrorCode("NOT_INVITEE");
    row.status = "declined";
    return row;
  }

  accept(caller, requestId) {
    const request = this.requests.get(requestId);
    if (!request) throw new MatchmakingErrorCode("REQUEST_UNAVAILABLE");
    if (request.creatorId === caller) throw new MatchmakingErrorCode("SELF_ACCEPT");
    if (request.visibility === "friend" && request.inviteeId !== caller) {
      throw new MatchmakingErrorCode("NOT_INVITEE");
    }
    if (request.status === "accepted") {
      throw new MatchmakingErrorCode("REQUEST_ALREADY_ACCEPTED");
    }
    if (request.status !== "open") throw new MatchmakingErrorCode("REQUEST_UNAVAILABLE");
    if (request.visibility === "friend" && !this.isFriend(request.creatorId, caller)) {
      request.status = "expired";
      throw new MatchmakingErrorCode("NOT_FRIENDS");
    }
    if (this.active.has(request.creatorId) || this.active.has(caller)) {
      throw new MatchmakingErrorCode("PLAYER_BUSY");
    }
    const matchId = `match-${++this.seq}`;
    this.active.set(request.creatorId, matchId);
    this.active.set(caller, matchId);
    this.matches.set(matchId, {
      id: matchId,
      requestId: request.id,
      playerA: request.creatorId,
      playerB: caller,
      status: "ready",
      winnerSeat: null,
      forfeitSeat: null,
    });
    request.status = "accepted";
    request.acceptorId = caller;
    request.matchId = matchId;
    for (const other of this.requests.values()) {
      if (
        other.status === "open" &&
        other.id !== request.id &&
        (other.creatorId === request.creatorId ||
          other.creatorId === caller ||
          other.inviteeId === request.creatorId ||
          other.inviteeId === caller)
      ) {
        other.status = "cancelled";
      }
    }
    return this.matches.get(matchId);
  }

  forfeit(caller, matchId) {
    const match = this.matches.get(matchId);
    if (!match) throw new MatchmakingErrorCode("NOT_FOUND");
    if (match.playerA !== caller && match.playerB !== caller) {
      throw new MatchmakingErrorCode("NOT_A_PLAYER");
    }
    const forfeitSeat = match.playerA === caller ? 0 : 1;
    const winnerSeat = forfeitSeat === 0 ? 1 : 0;
    if (match.status !== "ready" && match.status !== "playing") {
      return {
        ok: true,
        idempotent: true,
        winnerSeat: match.winnerSeat ?? winnerSeat,
        forfeitSeat,
        status: match.status,
      };
    }
    match.status = "finished";
    match.winnerSeat = winnerSeat;
    match.forfeitSeat = forfeitSeat;
    this.active.delete(match.playerA);
    this.active.delete(match.playerB);
    return { ok: true, idempotent: false, winnerSeat, forfeitSeat, status: "finished" };
  }

  publicOpen() {
    return [...this.requests.values()].filter(
      (row) => row.status === "open" && row.visibility !== "friend"
    );
  }
}

const A = "player-a";
const B = "player-b";
const C = "player-c";

{
  const store = new FriendInviteStore();
  await assert.rejects(() => Promise.resolve().then(() => store.send(A, B)), (err) => err.code === "NOT_FRIENDS");
  store.befriend(A, B);
  await assert.rejects(() => Promise.resolve().then(() => store.send(A, A)), (err) => err.code === "SELF_INVITE");
  const invite = store.send(A, B, "haitian");
  assert.equal(invite.visibility, "friend");
  assert.equal(store.publicOpen().length, 0);
  assert.equal(canAcceptMatchRequest(normalizeMatchRequest({
    id: invite.id,
    creator_id: A,
    invitee_id: B,
    visibility: "friend",
    ruleset_id: "haitian",
    status: "open",
    created_at: "2099-01-01T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  }), B), false);
  console.log("  ✓ non-friend cannot invite; self blocked; friend rows stay off Find Match");
}

{
  const store = new FriendInviteStore();
  store.befriend(A, B);
  const invite = store.send(A, B);
  store.decline(B, invite.id);
  assert.equal(store.matches.size, 0);
  assert.equal(store.active.size, 0);
  store.decline(B, invite.id);
  await assert.rejects(() => Promise.resolve().then(() => store.decline(A, invite.id)), (err) => err.code === "NOT_INVITEE");
  console.log("  ✓ decline creates no match and is invitee-only");
}

{
  const store = new FriendInviteStore();
  store.befriend(A, B);
  const invite = store.send(A, B, "american");
  const first = store.accept(B, invite.id);
  assert.equal(store.matches.size, 1);
  assert.equal(first.playerA, A);
  assert.equal(first.playerB, B);
  await assert.rejects(
    () => Promise.resolve().then(() => store.accept(B, invite.id)),
    (err) => err.code === "REQUEST_ALREADY_ACCEPTED"
  );
  assert.equal(store.matches.size, 1);
  console.log("  ✓ accept creates exactly one match; double accept is safe");
}

{
  const store = new FriendInviteStore();
  store.befriend(A, B);
  store.befriend(A, C);
  const invite = store.send(A, B);
  store.active.set(C, "other-match");
  await assert.rejects(() => Promise.resolve().then(() => store.send(A, C)), (err) => err.code === "PLAYER_BUSY");
  store.active.set(B, "busy-b");
  await assert.rejects(() => Promise.resolve().then(() => store.accept(B, invite.id)), (err) => err.code === "PLAYER_BUSY");
  assert.equal(store.matches.size, 0);
  console.log("  ✓ busy players cannot send or accept");
}

{
  const store = new FriendInviteStore();
  store.befriend(A, B);
  const invite = store.send(A, B);
  const match = store.accept(B, invite.id);
  const first = store.forfeit(A, match.id);
  assert.equal(first.idempotent, false);
  assert.equal(first.winnerSeat, 1);
  assert.equal(store.active.size, 0);
  assert.equal(store.matches.get(match.id).status, "finished");
  const again = store.forfeit(A, match.id);
  assert.equal(again.idempotent, true);
  assert.equal(again.winnerSeat, 1);
  const fromWinner = store.forfeit(B, match.id);
  assert.equal(fromWinner.idempotent, true);
  assert.equal(store.matches.size, 1);
  console.log("  ✓ confirmed forfeit awards opponent; duplicate forfeit is safe");
}

{
  const events = [];
  const store = new FriendInviteStore();
  store.befriend(A, B);
  const invite = store.send(A, B);
  events.push({ table: "match_requests", eventType: "INSERT", new: { ...invite, status: "open" } });
  store.decline(B, invite.id);
  events.push({ table: "match_requests", eventType: "UPDATE", new: store.requests.get(invite.id) });
  assert.equal(events[1].new.status, "declined");
  assert.equal(store.active.size, 0);
  assert.equal(store.matches.size, 0);
  console.log("  ✓ Realtime decline leaves no pending occupancy");
}

{
  assert.equal(friendInviteErrorKey(new MatchmakingError("NOT_FRIENDS")), "friends.notFriendsPlay");
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("PLAYER_BUSY")), true);
  assert.throws(
    () => throwFromPostgrest({ message: "only the invitee may accept" }),
    (err) => err.code === "NOT_INVITEE"
  );
  console.log("  ✓ invite authorization errors map to safe client codes");
}

console.log("  ✓ friend invites + forfeit races");
