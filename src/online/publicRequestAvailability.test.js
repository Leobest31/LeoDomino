/**
 * Public Find Match creator availability — listing, accept race, heartbeat identity.
 * Run: node src/online/publicRequestAvailability.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MatchmakingError,
  PUBLIC_REQUEST_HEARTBEAT_MS,
  PUBLIC_REQUEST_HEARTBEAT_TTL_MS,
  canAcceptFriendInvite,
  canAcceptMatchRequest,
  countJoinableOpenRequests,
  isPublicRequestCreatorFresh,
  isStaleMatchAcceptError,
  listOpenMatchRequests,
  throwFromPostgrest,
  touchMyOpenPublicRequest,
  visibleFindMatchRequests,
} from "./matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const page = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
const sql = readFileSync(
  join(root, "supabase/migrations/20260902140000_public_request_creator_availability.sql"),
  "utf8"
);
const graceSql = readFileSync(
  join(root, "supabase/migrations/20260904220000_public_request_heartbeat_grace.sql"),
  "utf8"
);

assert.equal(PUBLIC_REQUEST_HEARTBEAT_MS, 10_000);
assert.equal(PUBLIC_REQUEST_HEARTBEAT_TTL_MS, 5 * 60 * 1000);

const T0 = Date.parse("2026-09-02T12:00:00.000Z");
const NOW = Date.now();
const STALE_AFTER_MS = PUBLIC_REQUEST_HEARTBEAT_TTL_MS + 1;

function publicOpen(overrides = {}) {
  return {
    id: "req-1",
    creatorId: "creator",
    status: "open",
    visibility: "public",
    expiresAt: "2099-01-01T00:00:00.000Z",
    waitingHeartbeatAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

{
  const fresh = publicOpen({ waitingHeartbeatAt: new Date(T0).toISOString() });
  assert.equal(isPublicRequestCreatorFresh(fresh, T0), true);
  assert.equal(isPublicRequestCreatorFresh(fresh, T0 + 30_000), true, ">30s gap stays joinable");
  assert.equal(isPublicRequestCreatorFresh(fresh, T0 + 45_000), true);
  assert.equal(isPublicRequestCreatorFresh(fresh, T0 + PUBLIC_REQUEST_HEARTBEAT_TTL_MS), true);
  assert.equal(isPublicRequestCreatorFresh(fresh, T0 + STALE_AFTER_MS), false);
  assert.equal(canAcceptMatchRequest(fresh, "acceptor", T0), true);
  assert.equal(canAcceptMatchRequest(fresh, "acceptor", T0 + 45_000), true);
  assert.equal(canAcceptMatchRequest(fresh, "acceptor", T0 + STALE_AFTER_MS), false);
  assert.equal(canAcceptMatchRequest({ ...fresh, waitingHeartbeatAt: null }, "acceptor", T0), false);
  console.log("  ✓ public request remains joinable after >30s heartbeat gap; expires after 5m grace");
}

{
  const gap = publicOpen({
    id: "gap",
    waitingHeartbeatAt: new Date(NOW - 45_000).toISOString(),
  });
  const dead = publicOpen({
    id: "dead",
    waitingHeartbeatAt: new Date(NOW - STALE_AFTER_MS).toISOString(),
  });
  const fresh = publicOpen({ id: "fresh", creatorId: "other" });
  assert.equal(canAcceptMatchRequest(gap, "acceptor", NOW), true, "45s gap is recoverable");
  assert.equal(countJoinableOpenRequests([gap, dead, fresh], "acceptor"), 2);
  assert.deepEqual(
    visibleFindMatchRequests([gap, dead, fresh], null, NOW).map((row) => row.id).sort(),
    ["fresh", "gap"]
  );
  const ownGap = publicOpen({
    id: "mine",
    creatorId: "acceptor",
    waitingHeartbeatAt: new Date(NOW - 45_000).toISOString(),
  });
  assert.deepEqual(
    visibleFindMatchRequests([ownGap], ownGap, NOW).map((row) => row.id),
    ["mine"],
    "owner still sees their own waiting row so they can cancel"
  );
  console.log("  ✓ >30s gap stays listed; 5m+ stale public requests are not listed as available");
}

{
  const friend = {
    id: "invite-1",
    creatorId: "friend-a",
    inviteeId: "acceptor",
    status: "open",
    visibility: "friend",
    expiresAt: "2099-01-01T00:00:00.000Z",
    waitingHeartbeatAt: null,
  };
  assert.equal(isPublicRequestCreatorFresh(friend, NOW + 60_000), true);
  assert.equal(canAcceptMatchRequest(friend, "acceptor", NOW), false);
  assert.equal(canAcceptFriendInvite(friend, "acceptor"), true);
  assert.equal(countJoinableOpenRequests([friend], "acceptor"), 0);
  console.log("  ✓ friend invite persistence is unchanged by the public heartbeat");
}

{
  class AcceptStore {
    constructor() {
      this.requests = new Map();
      this.matches = new Map();
      this.active = new Map();
      this.rp = [];
    }

    createPublic(creatorId, heartbeatAt) {
      const id = `req-${this.requests.size + 1}`;
      this.requests.set(id, {
        id,
        creatorId,
        status: "open",
        visibility: "public",
        waitingHeartbeatAt: heartbeatAt,
      });
      return id;
    }

    accept(caller, requestId, now) {
      const request = this.requests.get(requestId);
      if (!request) throw new MatchmakingError("REQUEST_UNAVAILABLE");
      if (request.status === "accepted") throw new MatchmakingError("REQUEST_ALREADY_ACCEPTED");
      if (request.status !== "open") throw new MatchmakingError("REQUEST_UNAVAILABLE");
      if (this.active.has(request.creatorId) || this.active.has(caller)) {
        throw new MatchmakingError("PLAYER_BUSY");
      }
      const hb = Date.parse(request.waitingHeartbeatAt);
      if (!Number.isFinite(hb) || now - hb > PUBLIC_REQUEST_HEARTBEAT_TTL_MS) {
        request.status = "expired";
        throw new MatchmakingError("CREATOR_UNAVAILABLE");
      }
      const matchId = `match-${this.matches.size + 1}`;
      this.active.set(request.creatorId, matchId);
      this.active.set(caller, matchId);
      this.matches.set(matchId, { id: matchId, requestId, status: "ready" });
      request.status = "accepted";
      return matchId;
    }
  }

  const store = new AcceptStore();
  const requestId = store.createPublic("creator", new Date(T0).toISOString());
  assert.equal(store.accept("acceptor", requestId, T0 + 45_000), "match-1");
  assert.equal(store.matches.size, 1);
  assert.equal(store.active.size, 2);
  assert.throws(
    () => store.accept("other", requestId, T0 + 46_000),
    (err) => err.code === "REQUEST_ALREADY_ACCEPTED"
  );
  assert.equal(store.matches.size, 1);

  const staleId = store.createPublic("offline", new Date(T0).toISOString());
  assert.throws(
    () => store.accept("acceptor-2", staleId, T0 + STALE_AFTER_MS),
    (err) => err.code === "CREATOR_UNAVAILABLE"
  );
  assert.equal(store.requests.get(staleId).status, "expired");
  assert.equal(store.matches.size, 1, "stale accept must not insert a match");
  assert.equal(store.active.has("offline"), false);
  assert.equal(store.rp.length, 0);
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("CREATOR_UNAVAILABLE")), true);
  console.log("  ✓ accept after >30s gap works; 5m+ stale accept creates no match");
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
  };
  const ok = await touchMyOpenPublicRequest(client);
  assert.equal(ok, true);
  assert.deepEqual(rpcCalls, [{ name: "touch_my_open_public_request", args: undefined }]);
  assert.doesNotMatch(sql, /touch_my_open_public_request\([^)]*uuid/);
  assert.match(sql, /caller uuid := auth\.uid\(\)/);
  assert.match(graceSql, /SET waiting_heartbeat_at = now\(\)/);
  assert.match(graceSql, /expires_at > now\(\)/);
  const touchStart = graceSql.indexOf("CREATE OR REPLACE FUNCTION public.touch_my_open_public_request");
  const touchBody = graceSql.slice(touchStart, touchStart + 1200);
  const updateAt = touchBody.indexOf("SET waiting_heartbeat_at = now()");
  const expireAt = touchBody.indexOf("expire_stale_open_match_requests");
  assert.ok(updateAt >= 0 && expireAt > updateAt, "late touch refreshes caller before global expire");
  console.log("  ✓ heartbeat RPC is auth.uid() only; late touch recovers before expire");
}

{
  const listed = [];
  const client = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        gt() {
          return builder;
        },
        neq() {
          return builder;
        },
        order() {
          return Promise.resolve({
            data: [
              {
                id: "gap",
                creator_id: "gap-user",
                ruleset_id: "legacy",
                status: "open",
                created_at: "2026-09-02T12:00:00.000Z",
                expires_at: "2099-01-01T00:00:00.000Z",
                waiting_heartbeat_at: new Date(Date.now() - 45_000).toISOString(),
                match_id: null,
                acceptor_id: null,
                visibility: "public",
                profiles: { display_name: "Gap" },
              },
              {
                id: "dead",
                creator_id: "gone",
                ruleset_id: "legacy",
                status: "open",
                created_at: "2026-09-02T12:00:00.000Z",
                expires_at: "2099-01-01T00:00:00.000Z",
                waiting_heartbeat_at: new Date(Date.now() - STALE_AFTER_MS).toISOString(),
                match_id: null,
                acceptor_id: null,
                visibility: "public",
                profiles: { display_name: "Gone" },
              },
              {
                id: "fresh",
                creator_id: "here",
                ruleset_id: "legacy",
                status: "open",
                created_at: "2026-09-02T12:00:01.000Z",
                expires_at: "2099-01-01T00:00:00.000Z",
                waiting_heartbeat_at: new Date().toISOString(),
                match_id: null,
                acceptor_id: null,
                visibility: "public",
                profiles: { display_name: "Here" },
              },
            ],
            error: null,
          });
        },
      };
      listed.push("from");
      return builder;
    },
  };
  const open = await listOpenMatchRequests(client);
  assert.deepEqual(
    open.map((row) => row.id).sort(),
    ["fresh", "gap"]
  );
  console.log("  ✓ listOpenMatchRequests keeps >30s gap; hides 5m+ stale public creators");
}

{
  assert.match(page, /touchMyOpenPublicRequest/);
  assert.match(page, /PUBLIC_REQUEST_HEARTBEAT_MS/);
  assert.match(page, /if \(findMatchDocumentIsHidden\(\)\) return/);
  assert.match(page, /cancelOwnOpenBestEffort/);
  assert.match(page, /void cancelMatchRequest\(id\)/);
  assert.doesNotMatch(page, /pagehide|beforeunload/);
  assert.match(page, /onlineReady/);
  assert.match(page, /runForegroundRefresh/);
  assert.match(page, /ownStatusRef\.current === "open"/);
  assert.match(page, /visibilitychange/);
  console.log("  ✓ waiting screen heartbeats while visible; foreground return touches + refreshes");
}

{
  assert.throws(
    () => throwFromPostgrest({ message: "CREATOR_UNAVAILABLE" }, "ACCEPT_FAILED"),
    (err) => err.code === "CREATOR_UNAVAILABLE" && err.code !== "ACCEPT_FAILED"
  );
}

console.log("  ✓ public request availability");
