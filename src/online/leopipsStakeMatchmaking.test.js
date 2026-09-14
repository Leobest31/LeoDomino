/**
 * Client LeoPips lobby buckets — exact style + exact stake.
 * Mocked Supabase only. Run: node src/online/leopipsStakeMatchmaking.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIND_MATCH_STAKE_PIPS,
  MatchmakingError,
  acceptMatchRequest,
  createMatchRequest,
  isAllowedFindMatchStake,
  listJoinableOpenMatchRequests,
  loadFindMatchAvailability,
  loadFindMatchBoard,
  normalizeMatchRequest,
  requestMatchesFindMatchLobby,
  toFindMatchStakePips,
  visibleFindMatchLobbyRequests,
} from "./matchmaking.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

function row(overrides = {}) {
  return normalizeMatchRequest({
    id: "req-1",
    creator_id: "player-a",
    ruleset_id: "legacy",
    stake_pips: 20,
    status: "open",
    created_at: "2026-09-03T12:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
    visibility: "public",
    match_id: null,
    acceptor_id: null,
    profiles: { display_name: "Marie", avatar_id: "amina", country_code: "HT" },
    ...overrides,
  });
}

{
  assert.deepEqual([...FIND_MATCH_STAKE_PIPS], [20, 50, 100, 150]);
  assert.equal(toFindMatchStakePips(null), null);
  assert.equal(toFindMatchStakePips(undefined), null);
  assert.equal(toFindMatchStakePips(0), null);
  assert.equal(toFindMatchStakePips(25), null);
  assert.equal(toFindMatchStakePips("20"), 20);
  assert.equal(isAllowedFindMatchStake(20), true);
  assert.equal(isAllowedFindMatchStake(null), false);
  assert.equal(requestMatchesFindMatchLobby(row(), "classic", 20), true);
  assert.equal(requestMatchesFindMatchLobby(row(), "legacy", 20), true);
  assert.equal(requestMatchesFindMatchLobby(row(), "haitian", 20), false, "Classic 20 ≠ Haitian 20");
  assert.equal(requestMatchesFindMatchLobby(row(), "classic", 50), false, "Classic 20 ≠ Classic 50");
  assert.equal(
    requestMatchesFindMatchLobby(row({ ruleset_id: "haitian", stake_pips: 100 }), "american", 100),
    false,
    "Haitian 100 ≠ American 100"
  );
  assert.equal(
    requestMatchesFindMatchLobby(row({ stake_pips: null }), "classic", 20),
    false,
    "NULL is never 20"
  );
  assert.equal(
    requestMatchesFindMatchLobby(row({ visibility: "friend", stake_pips: 20 }), "classic", 20),
    false,
    "friend request is never a public LeoPips lobby row"
  );
}

{
  const classic20 = row();
  const haitian20 = row({ id: "h20", ruleset_id: "haitian", creator_id: "p-h" });
  const classic50 = row({ id: "c50", stake_pips: 50, creator_id: "p-50" });
  const classic100 = row({ id: "c100", stake_pips: 100, creator_id: "p-100" });
  const classic150 = row({ id: "c150", stake_pips: 150, creator_id: "p-150" });
  const american100 = row({ id: "a100", ruleset_id: "american", stake_pips: 100, creator_id: "p-a" });
  const nullStake = row({ id: "null", stake_pips: null, creator_id: "p-n" });
  const friend = row({
    id: "friend",
    visibility: "friend",
    stake_pips: null,
    creator_id: "p-f",
    invitee_id: "p-z",
  });
  const open = [classic20, haitian20, classic50, classic100, classic150, american100, nullStake, friend];
  const buckets = [
    ["classic", 20, ["req-1"]],
    ["classic", 50, ["c50"]],
    ["classic", 100, ["c100"]],
    ["classic", 150, ["c150"]],
  ];
  for (const [style, stake, ids] of buckets) {
    assert.deepEqual(
      visibleFindMatchLobbyRequests(open, null, style, stake).map((r) => r.id),
      ids,
      `${style} ${stake} sees exact public bucket only`
    );
  }
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 50).some((r) => r.id === "req-1"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 100).some((r) => r.id === "req-1"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 150).some((r) => r.id === "req-1"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 20).some((r) => r.id === "c50"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 100).some((r) => r.id === "c50"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 150).some((r) => r.id === "c50"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "haitian", 20).some((r) => r.id === "req-1"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 20).some((r) => r.id === "null"), false);
  assert.equal(visibleFindMatchLobbyRequests(open, null, "classic", 20).some((r) => r.id === "friend"), false);
  const ownWrong = row({ id: "own-50", stake_pips: 50, creator_id: "me" });
  assert.deepEqual(
    visibleFindMatchLobbyRequests(open, ownWrong, "classic", 20).map((r) => r.id),
    ["req-1"],
    "own waiting row in another bucket cannot appear"
  );
  assert.deepEqual(
    visibleFindMatchLobbyRequests(open, friend, "classic", 20).map((r) => r.id),
    ["req-1"],
    "own friend invite cannot appear in the public LeoPips lobby"
  );
}

{
  const missing = await listJoinableOpenMatchRequests("classic", 20, {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      });
    },
    from() {
      throw new Error("staked lobby must not fall back to unfiltered list");
    },
  });
  assert.deepEqual(missing, []);
}

{
  const listed = await listJoinableOpenMatchRequests("classic", null, {
    rpc() {
      throw new Error("must not query an invalid lobby");
    },
  });
  assert.deepEqual(listed, []);
}

{
  const rpcCalls = [];
  const rows = [
    {
      id: "ok",
      creator_id: "p-b",
      ruleset_id: "legacy",
      stake_pips: 20,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "public",
      display_name: "Bo",
    },
    {
      id: "wrong-stake",
      creator_id: "p-c",
      ruleset_id: "legacy",
      stake_pips: 50,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "public",
      display_name: "Cy",
    },
  ];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const open = await listJoinableOpenMatchRequests("classic", 20, client);
  assert.deepEqual(rpcCalls[0], {
    name: "list_joinable_open_match_requests",
    args: { p_ruleset_id: "legacy", p_stake_pips: 20 },
  });
  assert.deepEqual(open.map((r) => r.id), ["ok"]);
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: [], error: null });
    },
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        neq() {
          return builder;
        },
        in() {
          return builder;
        },
        gt() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then() {
          throw new Error("board must not fall back when lobby RPC succeeds");
        },
      };
      return builder;
    },
  };
  const board = await loadFindMatchBoard("player-z", { styleId: "haitian", stake: 100 }, client);
  assert.equal(board.source, "lobby-rpc");
  assert.deepEqual(board.open, []);
  assert.equal(rpcCalls[0].name, "list_joinable_open_match_requests");
  assert.deepEqual(rpcCalls[0].args, { p_ruleset_id: "haitian", p_stake_pips: 100 });
}

{
  const mixed = [
    {
      id: "c20",
      creator_id: "p-20",
      ruleset_id: "legacy",
      stake_pips: 20,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "public",
      display_name: "Twenty",
    },
    {
      id: "c50",
      creator_id: "p-50",
      ruleset_id: "legacy",
      stake_pips: 50,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "public",
      display_name: "Fifty",
    },
    {
      id: "friend",
      creator_id: "p-f",
      ruleset_id: "legacy",
      stake_pips: null,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "friend",
      display_name: "Friend",
    },
    {
      id: "null-stake",
      creator_id: "p-n",
      ruleset_id: "legacy",
      stake_pips: null,
      status: "open",
      created_at: "2026-09-03T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
      visibility: "public",
      display_name: "Legacy",
    },
  ];
  const ownFriend = {
    id: "own-friend",
    creator_id: "player-z",
    ruleset_id: "legacy",
    stake_pips: null,
    status: "open",
    created_at: "2026-09-03T12:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    waiting_heartbeat_at: "2099-01-01T00:00:00.000Z",
    visibility: "friend",
    invitee_id: "p-b",
  };
  const client = {
    rpc() {
      return Promise.resolve({ data: mixed, error: null });
    },
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        neq() { return builder; },
        in() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve({ data: ownFriend, error: null }); },
      };
      return builder;
    },
  };
  const first = await loadFindMatchBoard("player-z", { styleId: "classic", stake: 20 }, client);
  const again = await loadFindMatchBoard("player-z", { styleId: "classic", stake: 20 }, client);
  assert.equal(first.source, "lobby-rpc");
  assert.deepEqual(first.open.map((r) => r.id), ["c20"]);
  assert.deepEqual(again.open.map((r) => r.id), ["c20"], "realtime refresh cannot reintroduce wrong-bucket rows");
  assert.equal(first.own?.id, "own-friend");
  assert.equal(
    visibleFindMatchLobbyRequests(again.open, again.own, "classic", 20).some((r) => r.id === "own-friend"),
    false
  );
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 4, error: null });
    },
  };
  const availability = await loadFindMatchAvailability("player-z", client);
  assert.deepEqual(rpcCalls, [{ name: "count_joinable_open_match_requests", args: undefined }]);
  assert.equal(availability.count, 4);
  assert.equal(availability.available, true);
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: "match-1", error: null });
    },
    from(table) {
      const result =
        table === "matches"
          ? {
              data: {
                id: "match-1",
                request_id: "req-1",
                ruleset_id: "legacy",
                player_a: "player-a",
                player_b: "player-z",
                status: "ready",
                created_at: "2026-09-03T12:01:00.000Z",
              },
              error: null,
            }
          : {
              data: [
                { id: "player-a", display_name: "Marie", avatar_id: "amina", country_code: "HT" },
                { id: "player-z", display_name: "Zed", avatar_id: "marcus", country_code: "" },
              ],
              error: null,
            };
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
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
    },
  };
  await acceptMatchRequest(
    "req-1",
    { playerId: "player-z", creatorId: "player-a", styleId: "classic", stakePips: 20 },
    client
  );
  assert.deepEqual(rpcCalls[0].args, {
    p_request_id: "req-1",
    p_ruleset_id: "legacy",
    p_stake_pips: 20,
  });
}

{
  await assert.rejects(
    () => createMatchRequest("classic", 99, { from() { throw new Error("no write"); } }),
    (err) => err instanceof MatchmakingError && err.code === "INVALID_STAKE"
  );
}

{
  const matchmaking = read("src/online/matchmaking.js");
  const findMatch = read("src/pages/FindMatchPage.jsx");
  const app = read("src/App.jsx");
  const held = read("supabase/migrations/20260903140000_leopips_stake_matchmaking_buckets.sql");
  const wallet = read("supabase/migrations/20260903120000_leopips_wallet_foundation.sql");
  assert.match(app, /lockedStake=\{leopipsPick\?\.stake \?\? null\}/);
  assert.match(findMatch, /joinOrCreatePublicMatchRequest\(selectedId, lockedStakePips\)/);
  assert.doesNotMatch(findMatch, /createMatchRequest\(selectedId, lockedStakePips\)/);
  assert.match(findMatch, /styleId: selectedId, stakePips: lockedStakePips/);
  assert.match(findMatch, /data-find-match-stake/);
  assert.match(findMatch, /data-find-match-lobby/);
  assert.match(findMatch, /findMatch\.stakePips/);
  assert.match(findMatch, /board\.source !== "lobby-rpc"/);
  assert.match(findMatch, /requestMatchesFindMatchLobby\(request, lobbyStyle, lockedStakePips\)/);
  assert.doesNotMatch(findMatch, /from ["'].*leopips/);
  assert.doesNotMatch(matchmaking, /from ["'].*leopips/);
  assert.doesNotMatch(matchmaking, /_leopips_debit|_leopips_credit|_leopips_timeout/);
  assert.doesNotMatch(
    held.replace(/--[^\n]*/g, ""),
    /_leopips_debit|_leopips_credit_match_payout|_leopips_timeout_penalty/
  );
  assert.match(wallet, /Not wired into accept_match_request/);
  assert.doesNotMatch(findMatch, /player_xp|player_levels|XP\/Level/);
  assert.doesNotMatch(matchmaking, /player_xp|player_levels/);
}

console.log("  ✓ LeoPips exact style+stake matchmaking client contract");
