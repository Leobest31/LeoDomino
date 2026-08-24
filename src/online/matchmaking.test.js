/**
 * Find Match matchmaking adapter — mocked Supabase, no network.
 * Run: node src/online/matchmaking.test.js
 */
import assert from "node:assert/strict";
import {
  FIND_MATCH_STYLE_IDS,
  MATCH_REQUEST_SELECT,
  MatchmakingError,
  acceptMatchRequest,
  canAcceptMatchRequest,
  cancelMatchRequest,
  isMatchRequestExpired,
  createMatchRequest,
  isOwnMatchRequest,
  listOpenMatchRequests,
  loadFindMatchBoard,
  normalizeMatchRequest,
  styleIdFromRulesetId,
  subscribeMatchRequests,
  throwFromPostgrest,
  toFindMatchRulesetId,
} from "./matchmaking.js";

function thenable(result, capture = {}) {
  const builder = {
    select(sql) {
      capture.select = sql;
      return builder;
    },
    insert(row) {
      capture.insert = row;
      return builder;
    },
    eq(column, value) {
      capture.eq = capture.eq || [];
      capture.eq.push([column, value]);
      return builder;
    },
    gt(column, value) {
      capture.gt = [column, value];
      return builder;
    },
    in(column, value) {
      capture.in = [column, value];
      return builder;
    },
    order(column, opts) {
      capture.order = [column, opts];
      return builder;
    },
    limit(n) {
      capture.limit = n;
      return builder;
    },
    single() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

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

{
  assert.deepEqual([...FIND_MATCH_STYLE_IDS], ["classic", "haitian", "american"]);
  assert.equal(toFindMatchRulesetId("classic"), "legacy");
  assert.equal(toFindMatchRulesetId("haitian"), "haitian");
  assert.equal(toFindMatchRulesetId("american"), "american");
  assert.equal(toFindMatchRulesetId("legacy"), "legacy");
  assert.equal(toFindMatchRulesetId("allFives"), null);
  assert.equal(toFindMatchRulesetId("dominican"), null);
  assert.equal(toFindMatchRulesetId("puertorican"), null);
  assert.equal(styleIdFromRulesetId("legacy"), "classic");
  assert.equal(styleIdFromRulesetId("haitian"), "haitian");
  assert.equal(styleIdFromRulesetId("american"), "american");
}

{
  const mapped = normalizeMatchRequest(CREATOR_ROW);
  assert.equal(mapped.styleId, "haitian");
  assert.equal(mapped.rulesetId, "haitian");
  assert.equal(mapped.creator.displayName, "Marie");
  assert.equal(mapped.creator.avatarId, "amina");
  assert.equal(mapped.creator.countryCode, "HT");
  assert.equal(mapped.creator.playerId, "player-a");
  assert.equal(mapped.status, "open");
  assert.equal(isOwnMatchRequest(mapped, "player-a"), true);
  assert.equal(canAcceptMatchRequest(mapped, "player-a"), false);
  assert.equal(canAcceptMatchRequest(mapped, "player-b"), true);
}

{
  const capture = {};
  const client = {
    from(table) {
      assert.equal(table, "match_requests");
      return thenable({ data: CREATOR_ROW, error: null }, capture);
    },
  };
  const created = await createMatchRequest("haitian", client);
  assert.deepEqual(capture.insert, { ruleset_id: "haitian" });
  assert.equal(Object.keys(capture.insert).join(), "ruleset_id");
  assert.equal(capture.select, MATCH_REQUEST_SELECT);
  assert.equal(created.styleId, "haitian");
  assert.equal(created.creator.displayName, "Marie");
}

{
  await assert.rejects(
    () =>
      createMatchRequest("allFives", {
        from() {
          throw new Error("should not write");
        },
      }),
    (err) => err instanceof MatchmakingError && err.code === "INVALID_STYLE"
  );
}

{
  const capture = {};
  const client = {
    from(table) {
      assert.equal(table, "match_requests");
      return thenable({ data: [CREATOR_ROW], error: null }, capture);
    },
  };
  const open = await listOpenMatchRequests(client);
  assert.deepEqual(capture.eq, [["status", "open"]]);
  assert.equal(capture.gt[0], "expires_at");
  assert.equal(typeof capture.gt[1], "string");
  assert.equal(open[0].styleId, "haitian");
  assert.equal(open[0].rulesetId, "haitian");
}

{
  const expired = normalizeMatchRequest({
    ...CREATOR_ROW,
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(isMatchRequestExpired(expired), true);
  assert.equal(canAcceptMatchRequest(expired, "player-b"), false);
  const client = {
    from() {
      return thenable({
        data: [{ ...CREATOR_ROW, expires_at: "2020-01-01T00:00:00.000Z" }],
        error: null,
      });
    },
  };
  const open = await listOpenMatchRequests(client);
  assert.equal(open.length, 0);
}

{
  const ownCapture = {};
  const openCapture = {};
  let calls = 0;
  const client = {
    from() {
      calls += 1;
      if (calls === 1) {
        return thenable({ data: [CREATOR_ROW], error: null }, openCapture);
      }
      return thenable({ data: CREATOR_ROW, error: null }, ownCapture);
    },
  };
  const board = await loadFindMatchBoard("player-a", client);
  assert.equal(board.open[0].styleId, "haitian");
  assert.equal(board.own.styleId, "haitian");
  assert.deepEqual(ownCapture.in, ["status", ["open", "accepted"]]);
}

{
  const expiredOwn = { ...CREATOR_ROW, expires_at: "2020-01-01T00:00:00.000Z" };
  let calls = 0;
  const client = {
    from() {
      calls += 1;
      if (calls === 1) {
        return thenable({ data: [], error: null });
      }
      return thenable({ data: expiredOwn, error: null });
    },
  };
  const board = await loadFindMatchBoard("player-a", client);
  assert.equal(board.open.length, 1);
  assert.equal(board.open[0].id, "req-1");
  assert.equal(canAcceptMatchRequest(board.open[0], "player-b"), false);
  assert.equal(isOwnMatchRequest(board.open[0], "player-a"), true);
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: "match-99", error: null });
    },
    from(table) {
      if (table === "matches") {
        return thenable({
          data: {
            id: "match-99",
            request_id: "req-1",
            ruleset_id: "haitian",
            player_a: "player-a",
            player_b: "player-b",
            status: "ready",
            created_at: "2026-08-23T12:01:00.000Z",
          },
          error: null,
        });
      }
      return thenable({
        data: [
          { id: "player-a", display_name: "Marie", avatar_id: "amina", country_code: "HT" },
          { id: "player-b", display_name: "Leo", avatar_id: "marcus", country_code: "US" },
        ],
        error: null,
      });
    },
  };
  const match = await acceptMatchRequest(
    "req-1",
    { playerId: "player-b", creatorId: "player-a", rulesetId: "american" },
    client
  );
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "accept_match_request");
  assert.deepEqual(rpcCalls[0].args, { p_request_id: "req-1" });
  assert.equal(Object.prototype.hasOwnProperty.call(rpcCalls[0].args, "ruleset_id"), false);
  assert.equal(match.id, "match-99");
  assert.equal(match.rulesetId, "haitian");
  assert.equal(match.styleId, "haitian");
  assert.equal(match.host.displayName, "Marie");
  assert.equal(match.opponent.displayName, "Leo");
}

{
  let rpcCalled = false;
  await assert.rejects(
    () =>
      acceptMatchRequest(
        "req-1",
        { playerId: "player-a", creatorId: "player-a" },
        {
          rpc() {
            rpcCalled = true;
            return Promise.resolve({ data: null, error: null });
          },
        }
      ),
    (err) => err instanceof MatchmakingError && err.code === "SELF_ACCEPT"
  );
  assert.equal(rpcCalled, false, "self-accept must not call the RPC");
}

{
  const client = {
    async rpc(name, args) {
      assert.equal(name, "accept_match_request");
      assert.deepEqual(args, { p_request_id: "req-1" });
      return {
        data: null,
        error: { message: "cannot accept own match request" },
      };
    },
  };
  await assert.rejects(
    () => acceptMatchRequest("req-1", { playerId: "player-b", creatorId: "player-a" }, client),
    (err) => err instanceof MatchmakingError && err.code === "SELF_ACCEPT"
  );
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "match request is not open" } };
    },
  };
  await assert.rejects(
    () => acceptMatchRequest("req-1", { playerId: "player-b", creatorId: "player-a" }, client),
    (err) => err instanceof MatchmakingError && err.code === "NOT_OPEN"
  );
}

{
  const client = {
    from() {
      return thenable({
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "match_requests_one_open_per_creator"',
        },
      });
    },
  };
  await assert.rejects(
    () => createMatchRequest("classic", client),
    (err) => err instanceof MatchmakingError && err.code === "ALREADY_OPEN"
  );
}

{
  let cancelled = null;
  const client = {
    async rpc(name, args) {
      cancelled = { name, args };
      return { error: null };
    },
  };
  await cancelMatchRequest("req-1", client);
  assert.equal(cancelled.name, "cancel_match_request");
  assert.deepEqual(cancelled.args, { p_request_id: "req-1" });
}

{
  assert.throws(
    () => throwFromPostgrest({ message: "match request expired" }),
    (err) => err.code === "EXPIRED"
  );
}

{
  const events = [];
  const removed = [];
  const channel = {
    on(kind, filter, handler) {
      assert.equal(kind, "postgres_changes");
      assert.equal(filter.table, "match_requests");
      assert.equal(filter.event, "*");
      channel.handler = handler;
      return channel;
    },
    subscribe() {
      return "SUBSCRIBED";
    },
  };
  const client = {
    channel(name) {
      assert.equal(name, "leo-match-requests");
      return channel;
    },
    removeChannel(ch) {
      removed.push(ch);
    },
  };
  const stop = subscribeMatchRequests((payload) => events.push(payload), client);
  channel.handler({ eventType: "INSERT" });
  stop();
  assert.equal(events.length, 1);
  assert.equal(removed[0], channel);
}

console.log("  ✓ Find Match matchmaking adapter");
