/**
 * Friends adapter — mocked Supabase, no network.
 * Run: node src/online/friends.test.js
 */
import assert from "node:assert/strict";
import {
  FRIEND_RELATIONS,
  FRIEND_STATUSES,
  FriendsError,
  PROFILE_PUBLIC_SELECT,
  canSearchPlayers,
  escapeIlike,
  friendStatus,
  friendsErrorKey,
  listFriendsInActiveMatch,
  mergeUsernameSearchRows,
  normalizePublicProfile,
  rankUsernameSearchHits,
  relationBetween,
  respondToFriendRequest,
  searchPlayers,
  searchQuery,
  sendFriendRequest,
  unfriendPlayer,
  usernameMatchesQuery,
} from "./friends.js";

const ME = "player-me";
const THEM = "player-them";
const BOARD = {
  friends: [{ playerId: "already-friend" }],
  incoming: [{ senderId: "incoming-id", status: "pending" }],
  outgoing: [{ receiverId: "outgoing-id", status: "pending" }],
};

{
  await assert.rejects(
    () => sendFriendRequest(ME, ME),
    (error) => error instanceof FriendsError && error.code === "SELF",
    "cannot add self"
  );
}

{
  const client = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: {
          message: "duplicate key value violates unique constraint friend_requests_one_pending_pair",
        },
      });
    },
  };
  await assert.rejects(
    () => sendFriendRequest(THEM, ME, client),
    (error) => error instanceof FriendsError && error.code === "ALREADY_PENDING",
    "duplicate request prevented"
  );
}

{
  assert.equal(relationBetween("outgoing-id", ME, BOARD), FRIEND_RELATIONS.outgoing);
  assert.equal(relationBetween("incoming-id", ME, BOARD), FRIEND_RELATIONS.incoming);
  assert.equal(relationBetween("already-friend", ME, BOARD), FRIEND_RELATIONS.friends);
  assert.equal(relationBetween(ME, ME, BOARD), FRIEND_RELATIONS.self);
  assert.equal(relationBetween("stranger", ME, BOARD), FRIEND_RELATIONS.none);
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.rpc = { name, args };
      return Promise.resolve({ data: "friendship-1", error: null });
    },
  };
  const id = await respondToFriendRequest("req-1", "accept", client);
  assert.equal(capture.rpc.name, "respond_to_friend_request");
  assert.equal(capture.rpc.args.p_request_id, "req-1");
  assert.equal(capture.rpc.args.p_action, "accept");
  assert.equal(id, "friendship-1");
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.rpc = { name, args };
      return Promise.resolve({ data: null, error: null });
    },
  };
  const id = await respondToFriendRequest("req-2", "decline", client);
  assert.equal(capture.rpc.name, "respond_to_friend_request");
  assert.equal(capture.rpc.args.p_action, "decline");
  assert.equal(id, null);
}

{
  assert.equal(friendStatus({ inMatch: true, online: true }), FRIEND_STATUSES.inMatch);
  assert.equal(friendStatus({ inMatch: false, online: true }), FRIEND_STATUSES.online);
  assert.equal(friendStatus({ inMatch: false, online: false }), FRIEND_STATUSES.offline);
  assert.equal(friendStatus({}), FRIEND_STATUSES.offline);
}

{
  assert.equal(searchQuery("Lbest"), "lbest");
  assert.equal(searchQuery("@lbest"), "lbest");
  assert.equal(searchQuery("  @LBest  "), "lbest");
  assert.equal(usernameMatchesQuery("lbest", "Lbest"), true);
  assert.equal(usernameMatchesQuery("lbest", "@lbest"), true);
  assert.equal(usernameMatchesQuery("lbest", "lb"), true);
  assert.equal(usernameMatchesQuery("marie", "lbest"), false);
  assert.equal(usernameMatchesQuery("", "lbest"), false);
  const ranked = rankUsernameSearchHits(
    [
      { username: "lbestie", playerId: "2" },
      { username: "lbest", playerId: "1" },
      { username: "albest", playerId: "3" },
    ],
    "Lbest"
  );
  assert.deepEqual(
    ranked.map((row) => row.username),
    ["lbest", "lbestie", "albest"]
  );
  const merged = mergeUsernameSearchRows(
    [],
    [{ playerId: THEM, username: "lbest", displayName: "Lbest", avatarId: "marcus", countryCode: "HT" }],
    "lbest",
    ME
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].playerId, THEM);
  assert.equal(merged[0].username, "lbest");
  const displayOnly = mergeUsernameSearchRows(
    [],
    [{ playerId: THEM, username: "", displayName: "Lbest", avatarId: "marcus", countryCode: "HT" }],
    "lbest",
    ME
  );
  assert.deepEqual(displayOnly, []);
}

{
  assert.equal(PROFILE_PUBLIC_SELECT, "id, username, display_name, avatar_id, country_code");
  assert.doesNotMatch(PROFILE_PUBLIC_SELECT, /email|phone|raw_user_meta|identities|token/i);
  const mapped = normalizePublicProfile({
    id: THEM,
    username: "marie",
    display_name: "Marie",
    avatar_id: "amina",
    country_code: "HT",
    email: "hidden@example.com",
    phone: "+15555550100",
  });
  assert.deepEqual(Object.keys(mapped).sort(), ["avatarId", "countryCode", "displayName", "playerId", "username"]);
  assert.equal(mapped.username, "marie");
  assert.equal(mapped.email, undefined);
  assert.equal(mapped.phone, undefined);
}

{
  assert.equal(canSearchPlayers("a"), false);
  assert.equal(canSearchPlayers("ma"), true);
  assert.equal(canSearchPlayers("@ma"), true);
  assert.equal(escapeIlike("a%b_c\\d"), "a\\%b\\_c\\\\d");
  const capture = {};
  const lbestRow = {
    id: THEM,
    username: "lbest",
    display_name: "Lbest",
    avatar_id: "marcus",
    country_code: "HT",
    email: "secret@example.com",
  };
  const client = {
    rpc(name, args) {
      capture.rpc = { name, args };
      return Promise.resolve({
        data: [lbestRow],
        error: null,
      });
    },
  };
  const rows = await searchPlayers("Lbest", ME, client);
  assert.equal(capture.rpc.name, "search_players_by_username");
  assert.equal(capture.rpc.args.p_query, "lbest");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerId, THEM);
  assert.equal(rows[0].username, "lbest");
  assert.equal(rows[0].email, undefined);
  for (const typed of ["lbest", "Lbest", "@lbest", "  @LBest  "]) {
    const found = await searchPlayers(typed, ME, client);
    assert.equal(found[0]?.username, "lbest", typed);
    assert.equal(capture.rpc.args.p_query, "lbest", typed);
  }
  const skipped = await searchPlayers("Marie", "", client);
  assert.deepEqual(skipped, []);
  const selfHit = await searchPlayers("lbest", ME, {
    rpc() {
      return Promise.resolve({
        data: [{ id: ME, username: "lbest", display_name: "Me", avatar_id: "marcus", country_code: "HT" }],
        error: null,
      });
    },
  });
  assert.deepEqual(selfHit, []);
  const missing = await searchPlayers("ma", ME, {
    rpc() {
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: "could not find the function" } });
    },
  });
  assert.deepEqual(missing, []);
  await assert.rejects(
    () =>
      searchPlayers("lbest", ME, {
        rpc() {
          return Promise.resolve({ data: null, error: { code: "57014", message: "statement timeout" } });
        },
      }),
    (error) => error instanceof FriendsError && error.code === "SEARCH_FAILED"
  );
  const fromFriends = await searchPlayers(
    "@Lbest",
    ME,
    {
      rpc() {
        return Promise.resolve({ data: [], error: null });
      },
    },
    [{ playerId: THEM, username: "lbest", displayName: "Lbest", avatarId: "marcus", countryCode: "HT" }]
  );
  assert.equal(fromFriends.length, 1);
  assert.equal(fromFriends[0].username, "lbest");
  const recovered = await searchPlayers("lbest", ME, {
    rpc() {
      return Promise.resolve({ data: [], error: { code: "PGRST202", message: "could not find the function" } });
    },
    from() {
      const query = {
        select() {
          return query;
        },
        not() {
          return query;
        },
        ilike(column, pattern) {
          capture.ilike = { column, pattern };
          return query;
        },
        neq() {
          return query;
        },
        limit() {
          return Promise.resolve({
            data: [lbestRow],
            error: null,
          });
        },
      };
      return query;
    },
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].username, "lbest");
  assert.equal(capture.ilike.column, "username");
  assert.match(capture.ilike.pattern, /lbest/);
  const displayNameSearch = await searchPlayers(
    "Lbest",
    ME,
    {
      rpc() {
        return Promise.resolve({ data: [], error: null });
      },
    },
    [{ playerId: THEM, username: "", displayName: "Lbest", avatarId: "marcus", countryCode: "HT" }]
  );
  assert.deepEqual(displayNameSearch, []);
}

{
  const capture = {};
  const client = {
    rpc(name, args) {
      capture.rpc = { name, args };
      return Promise.resolve({ data: null, error: null });
    },
  };
  await unfriendPlayer(THEM, client);
  assert.equal(capture.rpc.name, "unfriend_player");
  assert.equal(capture.rpc.args.p_friend_id, THEM);
}

{
  const capture = {};
  const client = {
    rpc(name) {
      capture.name = name;
      return Promise.resolve({ data: [{ player_id: THEM }], error: null });
    },
  };
  const ids = await listFriendsInActiveMatch(client);
  assert.equal(capture.name, "list_friends_in_active_match");
  assert.deepEqual(ids, [THEM]);
}

{
  const client = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: "cannot send a friend request to yourself" },
      });
    },
  };
  await assert.rejects(() => sendFriendRequest(THEM, "other", client), (error) => {
    assert.equal(friendsErrorKey(error), "friends.self");
    return error.code === "SELF";
  });
}

console.log("  ✓ friends adapter");
