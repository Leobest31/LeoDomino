/**
 * Find Match matchmaking adapter — mocked Supabase, no network.
 * Run: node src/online/matchmaking.test.js
 */
import assert from "node:assert/strict";
import {
  FIND_MATCH_STYLE_IDS,
  MATCH_REQUEST_SELECT_LEGACY,
  MATCH_REQUEST_SELECT_STAKE,
  MatchmakingError,
  acceptMatchRequest,
  canAcceptMatchRequest,
  canAcceptFriendInvite,
  cancelMatchRequest,
  abortOnlineMatch,
  cleanupStaleOccupiedMatches,
  forfeitOnlineMatch,
  MATCH_PRESENCE_HEARTBEAT_MS,
  STALE_MATCH_GRACE_MS,
  touchMyMatchPresence,
  getOwnLatestRequest,
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
  isStaleMatchAcceptError,
  friendInviteErrorKey,
  visibleFindMatchRequests,
} from "./matchmaking.js";
import { SERVICE_UNAVAILABLE_CODE } from "./serviceHealth.js";

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
    neq(column, value) {
      capture.neq = capture.neq || [];
      capture.neq.push([column, value]);
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
  waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
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
  const friendInvite = normalizeMatchRequest({
    ...CREATOR_ROW,
    visibility: "friend",
    invitee_id: "player-b",
  });
  assert.equal(canAcceptMatchRequest(friendInvite, "player-b"), false);
  assert.equal(canAcceptFriendInvite(friendInvite, "player-b"), true);
  assert.equal(canAcceptFriendInvite(friendInvite, "player-a"), false);
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
  assert.equal(capture.select, MATCH_REQUEST_SELECT_LEGACY);
  assert.equal(created.styleId, "haitian");
  assert.equal(created.creator.displayName, "Marie");
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      assert.equal(name, "join_or_create_public_match_request");
      assert.deepEqual(args, { p_ruleset_id: "legacy", p_stake_pips: 20 });
      return Promise.resolve({
        data: { outcome: "created", request_id: "req-staked", match_id: null },
        error: null,
      });
    },
    from(table) {
      assert.equal(table, "match_requests");
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: {
                      ...CREATOR_ROW,
                      id: "req-staked",
                      ruleset_id: "legacy",
                      stake_pips: 20,
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
        insert(row) {
          capture.insert = row;
          throw new Error("staked path must not insert");
        },
      };
    },
  };
  const created = await createMatchRequest("classic", 20, client);
  assert.equal(capture.insert, undefined);
  assert.equal(created.stakePips, 20);
  assert.equal(created.rulesetId, "legacy");
  assert.equal(created._joinOutcome, "created");
}

{
  await assert.rejects(
    () => createMatchRequest("haitian", 25, { from() { throw new Error("should not write"); } }),
    (err) => err instanceof MatchmakingError && err.code === "INVALID_STAKE"
  );
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
  assert.equal(capture.select, MATCH_REQUEST_SELECT_STAKE);
  assert.deepEqual(capture.eq, [["status", "open"]]);
  assert.deepEqual(capture.neq, [["visibility", "friend"]]);
  assert.equal(capture.gt[0], "expires_at");
  assert.equal(typeof capture.gt[1], "string");
  assert.equal(open[0].styleId, "haitian");
  assert.equal(open[0].rulesetId, "haitian");
}

{
  const friendRow = {
    ...CREATOR_ROW,
    id: "req-friend",
    visibility: "friend",
    invitee_id: "player-b",
  };
  const client = {
    from() {
      return thenable({ data: [friendRow, CREATOR_ROW], error: null }, {});
    },
  };
  const open = await listOpenMatchRequests(client);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, "req-1");
  assert.equal(open[0].visibility, "public");
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
  assert.equal(board.open.length, 0);
  assert.equal(board.own, null);
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
  let aborted = null;
  const client = {
    async rpc(name, args) {
      aborted = { name, args };
      return { error: null };
    },
  };
  await abortOnlineMatch("match-1", client);
  assert.equal(aborted.name, "forfeit_online_match");
  assert.deepEqual(aborted.args, { p_match_id: "match-1" });
}

{
  let forfeited = null;
  const client = {
    async rpc(name, args) {
      forfeited = { name, args };
      return { data: { ok: true, idempotent: true }, error: null };
    },
  };
  const result = await forfeitOnlineMatch("match-1", client);
  assert.equal(forfeited.name, "forfeit_online_match");
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true, "J. finished/idempotent forfeit still succeeds");
}

{
  await assert.rejects(
    () =>
      forfeitOnlineMatch("match-1", {
        async rpc() {
          return {
            error: {
              code: "PGRST202",
              message:
                "Could not find the function public.forfeit_online_match(p_match_id) in the schema cache",
            },
          };
        },
      }),
    (err) => err instanceof MatchmakingError && err.code === "FORFEIT_FAILED"
  );
}

{
  const client = {
    from() {
      return thenable({
        data: { ...CREATOR_ROW, expires_at: "2020-01-01T00:00:00.000Z" },
        error: null,
      });
    },
  };
  const own = await getOwnLatestRequest("player-a", client);
  assert.equal(own, null);
}

{
  assert.throws(
    () => throwFromPostgrest({ message: "match request expired" }),
    (err) => err.code === "EXPIRED"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "PLAYER_BUSY" }),
    (err) => err.code === "PLAYER_BUSY"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0001", message: "PLAYER_BUSY" }),
    (err) => err.code === "PLAYER_BUSY"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0001", message: "forfeit_online_match failed" }, "FORFEIT_FAILED"),
    (err) => err instanceof MatchmakingError && err.code === "FORFEIT_FAILED",
    "I. forfeit P0001 is not automatically PLAYER_BUSY"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "REQUEST_UNAVAILABLE" }),
    (err) => err.code === "REQUEST_UNAVAILABLE"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "RANKED_PAIR_LIMIT" }),
    (err) => err.code === "RANKED_PAIR_LIMIT"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0004", message: "RANKED_PAIR_LIMIT" }),
    (err) => err.code === "RANKED_PAIR_LIMIT"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0004", message: "RANKED_PAIR_LIMIT" }, "ACCEPT_FAILED"),
    (err) => err.code === "RANKED_PAIR_LIMIT",
    "P0004 RANKED_PAIR_LIMIT is not PLAYER_BUSY or ACCEPT_FAILED"
  );
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("RANKED_PAIR_LIMIT")), true);
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("CREATOR_UNAVAILABLE")), true);
  assert.equal(friendInviteErrorKey(new MatchmakingError("RANKED_PAIR_LIMIT")), "findMatch.rankedPairLimit");
  assert.equal(friendInviteErrorKey(new MatchmakingError("CREATOR_UNAVAILABLE")), "findMatch.playerUnavailable");
  assert.throws(
    () => throwFromPostgrest({ message: "CREATOR_UNAVAILABLE" }),
    (err) => err.code === "CREATOR_UNAVAILABLE"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0005", message: "CREATOR_UNAVAILABLE" }),
    (err) => err.code === "CREATOR_UNAVAILABLE"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "not friends" }),
    (err) => err.code === "NOT_FRIENDS"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "cannot invite yourself" }),
    (err) => err.code === "SELF_INVITE"
  );
  assert.equal(friendInviteErrorKey(new MatchmakingError("PLAYER_BUSY")), "findMatch.alreadyInMatch");
  assert.equal(isStaleMatchAcceptError(new MatchmakingError("NOT_FRIENDS")), true);
}

// "Impossible de créer la demande." fix: infrastructure/network outages and
// ACCOUNT_DELETED must classify distinctly instead of collapsing into the
// generic CREATE_FAILED fallback, while every existing domain code stays
// exactly as it was.
{
  // A. network/abort error during join_or_create_public_match_request
  assert.throws(
    () => throwFromPostgrest({ name: "AbortError", message: "The user aborted a request." }, "CREATE_FAILED"),
    (err) => err instanceof MatchmakingError && err.code === SERVICE_UNAVAILABLE_CODE,
    "A. raw AbortError must be SERVICE_UNAVAILABLE, not CREATE_FAILED"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "Failed to fetch" }, "CREATE_FAILED"),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "A. Failed to fetch must be SERVICE_UNAVAILABLE"
  );

  // B. timeout-style error
  assert.throws(
    () => throwFromPostgrest({ name: "TimeoutError", message: "signal timed out" }, "CREATE_FAILED"),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "B. TimeoutError must be SERVICE_UNAVAILABLE"
  );

  // C. PGRST002 / PGRST003
  assert.throws(
    () => throwFromPostgrest({ code: "PGRST003", message: "timed out establishing connection" }, "CREATE_FAILED"),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "C. PGRST003 must be SERVICE_UNAVAILABLE"
  );
  assert.throws(
    () =>
      throwFromPostgrest(
        {
          code: "PGRST002",
          status: 503,
          message: "Could not query the database for the schema cache. Retrying.",
        },
        "CREATE_FAILED"
      ),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "C. PGRST002 (with 503 status, the real Supabase client shape) must be SERVICE_UNAVAILABLE"
  );

  // D. wrapped error shapes seen elsewhere in the app
  assert.throws(
    () =>
      throwFromPostgrest(
        {
          name: "FunctionsFetchError",
          message: "Failed to send a request to the Edge Function",
          context: { name: "AbortError", message: "The user aborted a request." },
        },
        "CREATE_FAILED"
      ),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "D. FunctionsFetchError wrapping AbortError under .context must be SERVICE_UNAVAILABLE"
  );
  assert.throws(
    () =>
      throwFromPostgrest(
        {
          name: "GameplayClientError",
          message: "request failed",
          cause: {
            name: "FunctionsFetchError",
            message: "Failed to send a request to the Edge Function",
            context: { name: "AbortError", message: "The operation was aborted." },
          },
        },
        "CREATE_FAILED"
      ),
    (err) => err.code === SERVICE_UNAVAILABLE_CODE,
    "D. GameplayClientError wrapping FunctionsFetchError under .cause.context must be SERVICE_UNAVAILABLE"
  );

  // E. ACCOUNT_DELETED
  assert.throws(
    () => throwFromPostgrest({ code: "P0001", message: "ACCOUNT_DELETED" }, "CREATE_FAILED"),
    (err) => err instanceof MatchmakingError && err.code === "ACCOUNT_DELETED",
    "E. ACCOUNT_DELETED must be its own code, not CREATE_FAILED"
  );

  // F. known domain errors must remain unchanged
  assert.throws(
    () => throwFromPostgrest({ message: "PLAYER_BUSY" }, "CREATE_FAILED"),
    (err) => err.code === "PLAYER_BUSY",
    "F. PLAYER_BUSY must stay PLAYER_BUSY"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "duplicate key value violates unique constraint" }, "CREATE_FAILED"),
    (err) => err.code === "ALREADY_OPEN",
    "F. duplicate key must stay ALREADY_OPEN"
  );
  assert.throws(
    () => throwFromPostgrest({ code: "P0004", message: "RANKED_PAIR_LIMIT" }, "CREATE_FAILED"),
    (err) => err.code === "RANKED_PAIR_LIMIT",
    "F. RANKED_PAIR_LIMIT must stay RANKED_PAIR_LIMIT"
  );
  assert.throws(
    () => throwFromPostgrest({ message: "invalid stake_pips" }, "CREATE_FAILED"),
    (err) => err.code === "INVALID_STAKE",
    "F. invalid stake_pips must stay INVALID_STAKE"
  );

  // G. a genuinely unknown/unclassified error still falls back to the caller's fallbackCode
  assert.throws(
    () => throwFromPostgrest({ message: "something entirely unrecognized happened" }, "CREATE_FAILED"),
    (err) => err instanceof MatchmakingError && err.code === "CREATE_FAILED",
    "G. unknown error must still fall back to CREATE_FAILED"
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

{
  assert.equal(STALE_MATCH_GRACE_MS, 5 * 60 * 1000);
  assert.equal(MATCH_PRESENCE_HEARTBEAT_MS, 20 * 1000);
}

{
  let called = null;
  const client = {
    async rpc(name, args) {
      called = { name, args };
      return { data: { ok: true, touched: true, cleaned: 0 }, error: null };
    },
  };
  const result = await touchMyMatchPresence("match-1", client);
  assert.equal(called.name, "touch_my_match_presence");
  assert.deepEqual(called.args, { p_match_id: "match-1" });
  assert.equal(result.ok, true);
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "function not found" } };
    },
  };
  const result = await touchMyMatchPresence("match-1", client);
  assert.equal(result.ok, false);
}

{
  // Freeze-incident hardening: the heartbeat must bound its own request the
  // same way gameplay.js bounds Edge Function calls, via postgrest-js's
  // .abortSignal(...) builder method, so a stalled connection settles
  // instead of leaving this heartbeat pending forever.
  let capturedSignal = "unset";
  const client = {
    rpc() {
      return {
        abortSignal(signal) {
          capturedSignal = signal;
          return this;
        },
        then(onFulfilled) {
          return Promise.resolve({ data: { ok: true, touched: true, cleaned: 0 }, error: null }).then(
            onFulfilled
          );
        },
      };
    },
  };
  const result = await touchMyMatchPresence("match-1", client);
  assert.ok(capturedSignal instanceof AbortSignal, "heartbeat requests a bounded abort signal");
  assert.equal(result.ok, true);
  console.log("  ✓ touchMyMatchPresence bounds its request via .abortSignal(AbortSignal.timeout(...))");
}

{
  // Backward compatible with a plain-promise rpc() mock (no abortSignal
  // builder method) — must not throw, must simply skip the bound.
  const client = {
    async rpc() {
      return { data: { ok: true, touched: true, cleaned: 0 }, error: null };
    },
  };
  const result = await touchMyMatchPresence("match-1", client);
  assert.equal(result.ok, true);
  console.log("  ✓ touchMyMatchPresence degrades gracefully when .abortSignal is unavailable");
}

{
  let called = null;
  const client = {
    async rpc(name) {
      called = name;
      return { data: 2, error: null };
    },
  };
  const cleaned = await cleanupStaleOccupiedMatches(client);
  assert.equal(called, "cleanup_stale_occupied_matches");
  assert.equal(cleaned, 2);
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "function not found" } };
    },
  };
  assert.equal(await cleanupStaleOccupiedMatches(client), 0);
}

{
  assert.deepEqual(
    visibleFindMatchRequests(
      [
        { id: "r-open", status: "open", waitingHeartbeatAt: "2099-01-01T00:00:00.000Z" },
        { id: "r-accepted", status: "accepted" },
      ],
      { id: "r-accepted", status: "accepted" }
    ).map((row) => row.id),
    ["r-open"],
    "E. accepted creator cannot remain in Waiting"
  );
  assert.equal(
    visibleFindMatchRequests([{ id: "r1", status: "accepted" }], { id: "r1", status: "accepted" }).length,
    0
  );
}

{
  await assert.rejects(
    () =>
      forfeitOnlineMatch("match-1", {
        async rpc() {
          return { error: { code: "P0001", message: "forfeit_online_match failed" } };
        },
      }),
    (err) => err instanceof MatchmakingError && err.code === "FORFEIT_FAILED",
    "I. forfeit P0001 is not automatically PLAYER_BUSY"
  );
}

console.log("  ✓ Find Match matchmaking adapter");
