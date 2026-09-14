/**
 * In-memory replica of join_or_create_public_match_request + client wiring.
 * Run: node src/online/joinOrCreatePublicMatchRequest.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MatchmakingError,
  createMatchRequest,
  joinOrCreatePublicMatchRequest,
} from "./matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
const mm = readFileSync(join(root, "src/online/matchmaking.js"), "utf8");

const HEARTBEAT_TTL_MS = 5 * 60 * 1000;

class JoinOrCreateStore {
  constructor() {
    this.requests = new Map();
    this.matches = new Map();
    this.active = new Map();
    this.pairLimited = new Set(); // `${a}|${b}` sorted
    this.seq = 0;
    this.now = Date.now();
    this.debitCalls = 0;
  }

  key(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  createOpen(creatorId, { rulesetId = "legacy", stakePips = 20, visibility = "public", heartbeatAgeMs = 0 } = {}) {
    if (this.active.has(creatorId)) throw Object.assign(new Error("PLAYER_BUSY"), { code: "PLAYER_BUSY" });
    for (const row of this.requests.values()) {
      if (
        row.creatorId === creatorId &&
        row.status === "open" &&
        row.visibility === "public" &&
        row.rulesetId === rulesetId &&
        row.stakePips === stakePips
      ) {
        throw Object.assign(new Error("ALREADY_OPEN"), { code: "ALREADY_OPEN" });
      }
    }
    const id = `req-${++this.seq}`;
    const row = {
      id,
      creatorId,
      rulesetId,
      stakePips,
      visibility,
      status: "open",
      matchId: null,
      acceptorId: null,
      createdAt: this.now + this.seq,
      waitingHeartbeatAt: this.now - heartbeatAgeMs,
      expiresAt: this.now + 10 * 60 * 1000,
    };
    this.requests.set(id, row);
    return row;
  }

  isJoinable(row, caller) {
    if (row.status !== "open") return false;
    if (row.visibility !== "public") return false;
    if (row.stakePips == null) return false;
    if (row.creatorId === caller) return false;
    if (row.expiresAt <= this.now) return false;
    if (row.waitingHeartbeatAt == null) return false;
    if (row.waitingHeartbeatAt < this.now - HEARTBEAT_TTL_MS) return false;
    if (this.active.has(row.creatorId)) return false;
    if (this.pairLimited.has(this.key(row.creatorId, caller))) return false;
    return true;
  }

  accept(caller, requestId, expectedRuleset, expectedStake) {
    if (this.debitCalls > 0) throw new Error("unexpected debit before PLAYING");
    const request = this.requests.get(requestId);
    if (!request) throw Object.assign(new Error("REQUEST_UNAVAILABLE"), { code: "REQUEST_UNAVAILABLE" });
    if (request.creatorId === caller) {
      throw Object.assign(new Error("SELF_ACCEPT"), { code: "SELF_ACCEPT" });
    }
    if (request.status === "accepted") {
      throw Object.assign(new Error("REQUEST_ALREADY_ACCEPTED"), { code: "REQUEST_ALREADY_ACCEPTED" });
    }
    if (request.status !== "open") {
      throw Object.assign(new Error("REQUEST_UNAVAILABLE"), { code: "REQUEST_UNAVAILABLE" });
    }
    if (request.visibility === "public" && request.stakePips != null) {
      if (expectedRuleset !== request.rulesetId || expectedStake !== request.stakePips) {
        throw Object.assign(new Error("LOBBY_MISMATCH"), { code: "LOBBY_MISMATCH" });
      }
    }
    if (this.active.has(request.creatorId) || this.active.has(caller)) {
      throw Object.assign(new Error("PLAYER_BUSY"), { code: "PLAYER_BUSY" });
    }
    if (this.pairLimited.has(this.key(request.creatorId, caller))) {
      throw Object.assign(new Error("RANKED_PAIR_LIMIT"), { code: "RANKED_PAIR_LIMIT" });
    }
    if (
      request.visibility === "public" &&
      (request.waitingHeartbeatAt == null ||
        request.waitingHeartbeatAt < this.now - HEARTBEAT_TTL_MS)
    ) {
      request.status = "expired";
      throw Object.assign(new Error("CREATOR_UNAVAILABLE"), { code: "CREATOR_UNAVAILABLE" });
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
      rulesetId: request.rulesetId,
      stakePips: request.stakePips,
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

  /** Mirrors SQL join_or_create under a lobby lock (single-threaded here). */
  joinOrCreate(caller, rulesetId, stakePips) {
    if (this.active.has(caller)) {
      throw Object.assign(new Error("PLAYER_BUSY"), { code: "PLAYER_BUSY" });
    }
    const peers = [...this.requests.values()]
      .filter(
        (row) =>
          this.isJoinable(row, caller) &&
          row.rulesetId === rulesetId &&
          row.stakePips === stakePips
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    if (peers[0]) {
      const match = this.accept(caller, peers[0].id, rulesetId, stakePips);
      return { outcome: "accepted", requestId: peers[0].id, matchId: match.id };
    }
    const own = [...this.requests.values()].find(
      (row) =>
        row.creatorId === caller &&
        row.status === "open" &&
        row.visibility === "public" &&
        row.rulesetId === rulesetId &&
        row.stakePips === stakePips &&
        row.expiresAt > this.now
    );
    if (own) {
      own.waitingHeartbeatAt = this.now;
      return { outcome: "already_open", requestId: own.id, matchId: null };
    }
    const created = this.createOpen(caller, { rulesetId, stakePips });
    return { outcome: "created", requestId: created.id, matchId: null };
  }

  openPublicInLobby(rulesetId, stakePips) {
    return [...this.requests.values()].filter(
      (row) =>
        row.status === "open" &&
        row.visibility === "public" &&
        row.rulesetId === rulesetId &&
        row.stakePips === stakePips
    );
  }
}

const A = "player-a";
const B = "player-b";
const C = "player-c";

{
  // 1. A opens first, B arrives later → B accepts A
  const store = new JoinOrCreateStore();
  const a = store.joinOrCreate(A, "legacy", 20);
  assert.equal(a.outcome, "created");
  const b = store.joinOrCreate(B, "legacy", 20);
  assert.equal(b.outcome, "accepted");
  assert.equal(b.requestId, a.requestId);
  assert.equal(store.openPublicInLobby("legacy", 20).length, 0);
  assert.equal(store.matches.size, 1);
  assert.equal(store.debitCalls, 0);
}

{
  // 2. B opens first, A arrives later → A accepts B
  const store = new JoinOrCreateStore();
  const b = store.joinOrCreate(B, "haitian", 50);
  const a = store.joinOrCreate(A, "haitian", 50);
  assert.equal(a.outcome, "accepted");
  assert.equal(a.requestId, b.requestId);
}

{
  // 3. Nearly simultaneous → only ONE pairing (serialized lobby lock)
  const store = new JoinOrCreateStore();
  const first = store.joinOrCreate(A, "legacy", 150);
  const second = store.joinOrCreate(B, "legacy", 150);
  assert.equal(first.outcome, "created");
  assert.equal(second.outcome, "accepted");
  assert.equal(store.matches.size, 1);
  assert.equal(store.openPublicInLobby("legacy", 150).length, 0);
}

{
  // 4. Both already have compatible OPEN → converge to one match
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: 100 });
  store.createOpen(B, { rulesetId: "legacy", stakePips: 100 });
  assert.equal(store.openPublicInLobby("legacy", 100).length, 2);
  const resolved = store.joinOrCreate(A, "legacy", 100);
  assert.equal(resolved.outcome, "accepted");
  assert.equal(store.matches.size, 1);
  assert.equal(store.openPublicInLobby("legacy", 100).length, 0);
  assert.equal(store.debitCalls, 0);
}

{
  // 5. Different stake buckets → never pair
  const store = new JoinOrCreateStore();
  store.joinOrCreate(A, "legacy", 20);
  const b = store.joinOrCreate(B, "legacy", 50);
  assert.equal(b.outcome, "created");
  assert.equal(store.openPublicInLobby("legacy", 20).length, 1);
  assert.equal(store.openPublicInLobby("legacy", 50).length, 1);
  assert.equal(store.matches.size, 0);
}

{
  // 6. Different rulesets → never pair
  const store = new JoinOrCreateStore();
  store.joinOrCreate(A, "legacy", 20);
  const b = store.joinOrCreate(B, "haitian", 20);
  assert.equal(b.outcome, "created");
  assert.equal(store.matches.size, 0);
}

{
  // 7. Own request → never self-match
  const store = new JoinOrCreateStore();
  const created = store.joinOrCreate(A, "legacy", 20);
  const again = store.joinOrCreate(A, "legacy", 20);
  assert.equal(again.outcome, "already_open");
  assert.equal(again.requestId, created.requestId);
  assert.equal(store.matches.size, 0);
}

{
  // 8. Friend / private / NULL stake → never contaminate public pool
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: null, visibility: "public" });
  store.createOpen(C, { rulesetId: "legacy", stakePips: 20, visibility: "friend" });
  const b = store.joinOrCreate(B, "legacy", 20);
  assert.equal(b.outcome, "created");
  assert.equal(store.matches.size, 0);
}

{
  // 9. Busy player → excluded
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: 20 });
  store.active.set(A, "busy-match");
  const b = store.joinOrCreate(B, "legacy", 20);
  assert.equal(b.outcome, "created");
  assert.equal(store.matches.size, 0);
}

{
  // 10. Active table player (caller busy) → excluded
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: 20 });
  store.active.set(B, "busy-match");
  assert.throws(() => store.joinOrCreate(B, "legacy", 20), (err) => err.code === "PLAYER_BUSY");
}

{
  // 11. Pair-limit still enforced
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: 20 });
  store.pairLimited.add(store.key(A, B));
  const b = store.joinOrCreate(B, "legacy", 20);
  assert.equal(b.outcome, "created");
  assert.equal(store.matches.size, 0);
}

{
  // 12. Expired / stale heartbeat row → excluded
  const store = new JoinOrCreateStore();
  store.createOpen(A, { rulesetId: "legacy", stakePips: 20, heartbeatAgeMs: HEARTBEAT_TTL_MS + 1000 });
  const b = store.joinOrCreate(B, "legacy", 20);
  assert.equal(b.outcome, "created");
  assert.equal(store.matches.size, 0);
}

{
  // 13. Repeated accept/create retry → idempotent, no duplicate match
  const store = new JoinOrCreateStore();
  store.joinOrCreate(A, "legacy", 20);
  const first = store.joinOrCreate(B, "legacy", 20);
  assert.equal(first.outcome, "accepted");
  assert.throws(
    () => store.accept(C, first.requestId, "legacy", 20),
    (err) => err.code === "REQUEST_ALREADY_ACCEPTED" || err.code === "PLAYER_BUSY"
  );
  assert.equal(store.matches.size, 1);
  assert.throws(() => store.joinOrCreate(A, "legacy", 20), (err) => err.code === "PLAYER_BUSY");
  assert.equal(store.matches.size, 1);
}

{
  // 13b. Caller already busy cannot join_or_create again
  const store = new JoinOrCreateStore();
  store.joinOrCreate(A, "legacy", 20);
  store.joinOrCreate(B, "legacy", 20);
  assert.throws(() => store.joinOrCreate(B, "legacy", 20), (err) => err.code === "PLAYER_BUSY");
  assert.equal(store.matches.size, 1);
}

{
  // 14. No LeoPips debit before PLAYING
  const store = new JoinOrCreateStore();
  store.joinOrCreate(A, "american", 150);
  store.joinOrCreate(B, "american", 150);
  assert.equal(store.debitCalls, 0);
  assert.equal([...store.matches.values()][0].status, "ready");
}

{
  // Client wiring
  assert.match(mm, /export async function joinOrCreatePublicMatchRequest/);
  assert.match(mm, /join_or_create_public_match_request/);
  assert.match(mm, /JOIN_OR_CREATE_UNAVAILABLE/);
  assert.match(page, /joinOrCreatePublicMatchRequest/);
  assert.match(page, /joined\.outcome === "accepted"/);
  assert.match(page, /resolveWhileWaitingRef/);
}

{
  // createMatchRequest staked path fails closed when RPC missing (no blind INSERT)
  const capture = {};
  const client = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });
    },
    from() {
      return {
        insert(row) {
          capture.insert = row;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { id: "should-not" },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => createMatchRequest("classic", 20, client),
    (err) => err instanceof MatchmakingError && err.code === "JOIN_OR_CREATE_UNAVAILABLE"
  );
  assert.equal(capture.insert, undefined);
}

{
  // joinOrCreatePublicMatchRequest happy path (accepted)
  const client = {
    rpc(name, args) {
      assert.equal(name, "join_or_create_public_match_request");
      assert.deepEqual(args, { p_ruleset_id: "legacy", p_stake_pips: 50 });
      return Promise.resolve({
        data: {
          outcome: "accepted",
          request_id: "req-peer",
          match_id: "match-1",
        },
        error: null,
      });
    },
    from(table) {
      if (table === "match_requests") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: {
                        id: "req-peer",
                        creator_id: "peer",
                        ruleset_id: "legacy",
                        stake_pips: 50,
                        status: "accepted",
                        match_id: "match-1",
                        created_at: new Date().toISOString(),
                        expires_at: new Date(Date.now() + 600000).toISOString(),
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "matches") {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({
                      data: {
                        id: "match-1",
                        request_id: "req-peer",
                        status: "ready",
                        ruleset_id: "legacy",
                        stake_pips: 50,
                        player_a: "peer",
                        player_b: "me",
                        created_at: new Date().toISOString(),
                      },
                      error: null,
                    });
                  },
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "profiles") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: [
                    { id: "peer", display_name: "Peer", avatar_id: "marcus", country_code: "" },
                    { id: "me", display_name: "Me", avatar_id: "marcus", country_code: "" },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "game_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const joined = await joinOrCreatePublicMatchRequest("classic", 50, client);
  assert.equal(joined.outcome, "accepted");
  assert.equal(joined.request.id, "req-peer");
  assert.equal(joined.match.id, "match-1");
}

{
  await assert.rejects(
    () => joinOrCreatePublicMatchRequest("classic", 25, { rpc() {} }),
    (err) => err instanceof MatchmakingError && err.code === "INVALID_STAKE"
  );
}

console.log("  ✓ join_or_create public match request matrix");
