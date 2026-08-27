/**
 * Home Find Match availability — joinable OPEN count, not accept.
 * Run: node src/online/findMatchAvailability.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAcceptMatchRequest,
  countJoinableOpenRequests,
  loadFindMatchAvailability,
  normalizeMatchRequest,
} from "./matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const CREATOR_ROW = {
  id: "req-1",
  creator_id: "player-a",
  ruleset_id: "haitian",
  status: "open",
  created_at: "2026-08-23T12:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
  match_id: null,
  acceptor_id: null,
  profiles: { display_name: "Marie", avatar_id: "amina", country_code: "HT" },
};

function openRequest(overrides = {}) {
  return normalizeMatchRequest({ ...CREATOR_ROW, ...overrides });
}

{
  const own = openRequest();
  const other = openRequest({ id: "req-2", creator_id: "player-b" });
  const third = openRequest({ id: "req-3", creator_id: "player-c" });
  const accepted = openRequest({ id: "req-4", creator_id: "player-d", status: "accepted" });
  const cancelled = openRequest({ id: "req-5", creator_id: "player-e", status: "cancelled" });
  const expired = openRequest({
    id: "req-6",
    creator_id: "player-f",
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  const busyCreator = openRequest({ id: "req-7", creator_id: "player-busy" });
  const rows = [own, other, third, accepted, cancelled, expired, busyCreator];

  assert.equal(countJoinableOpenRequests(rows, "player-a"), 3, "own/accepted/cancelled/expired excluded");
  assert.equal(countJoinableOpenRequests(rows, "player-a", ["player-busy"]), 2, "busy creators excluded");
  assert.equal(countJoinableOpenRequests(rows, "player-a", new Set(["player-busy", "player-b"])), 1);
  assert.equal(countJoinableOpenRequests(rows, ""), 0, "signed-out players cannot accept");
  assert.equal(countJoinableOpenRequests([], "player-a"), 0);
  assert.equal(canAcceptMatchRequest(own, "player-a"), false);
  assert.equal(canAcceptMatchRequest(other, "player-a"), true);
  const friendInvite = openRequest({
    id: "req-8",
    creator_id: "player-d",
    visibility: "friend",
    invitee_id: "player-a",
  });
  assert.equal(
    countJoinableOpenRequests([...rows, friendInvite], "player-a"),
    3,
    "private friend invites are not public joinable requests"
  );
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 2, error: null });
    },
    from() {
      throw new Error("list must not run when the occupancy count RPC succeeds");
    },
  };
  const result = await loadFindMatchAvailability("player-a", client);
  assert.deepEqual(rpcCalls, [{ name: "count_joinable_open_match_requests", args: undefined }]);
  assert.equal(result.count, 2);
  assert.equal(result.available, true);
}

{
  const result = await loadFindMatchAvailability("", {
    rpc() {
      throw new Error("must not query when unsigned");
    },
  });
  assert.equal(result.count, 0);
  assert.equal(result.available, false);
}

{
  let listed = false;
  const client = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "function not found" } });
    },
    from(table) {
      assert.equal(table, "match_requests");
      listed = true;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        neq() {
          return this;
        },
        gt() {
          return this;
        },
        order() {
          return this;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({
            data: [
              CREATOR_ROW,
              { ...CREATOR_ROW, id: "req-2", creator_id: "player-b" },
              { ...CREATOR_ROW, id: "req-3", creator_id: "player-c", status: "cancelled" },
            ],
            error: null,
          }).then(onFulfilled, onRejected);
        },
      };
    },
  };
  const result = await loadFindMatchAvailability("player-a", client);
  assert.equal(listed, true);
  assert.equal(result.count, 1, "fallback list excludes own request");
  assert.equal(result.available, true);
}

{
  const hook = read("hooks/useFindMatchAvailability.js");
  assert.match(hook, /loadFindMatchAvailability/);
  assert.match(hook, /subscribeMatchRequests/);
  assert.doesNotMatch(hook, /acceptMatchRequest|accept_match_request/);
  assert.doesNotMatch(hook, /setInterval|setTimeout/);
}

{
  const home = read("pages/HomePage.jsx");
  assert.match(home, /useFindMatchAvailability/);
  assert.match(home, /data-find-match-available/);
  assert.doesNotMatch(home, /acceptMatchRequest|accept_match_request/);
  assert.doesNotMatch(home, /from\("match_requests"\)/);
}

console.log("  ✓ Find Match availability indicator");
