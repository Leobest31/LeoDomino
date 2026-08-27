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
  normalizePublicProfile,
  relationBetween,
  respondToFriendRequest,
  searchPlayers,
  sendFriendRequest,
} from "./friends.js";

function queryBuilder(result, capture = {}) {
  const builder = {
    select(sql) {
      capture.select = sql;
      return builder;
    },
    ilike(column, value) {
      capture.ilike = [column, value];
      return builder;
    },
    neq(column, value) {
      capture.neq = [column, value];
      return builder;
    },
    in(column, value) {
      capture.in = [column, value];
      return builder;
    },
    eq(column, value) {
      capture.eq = capture.eq || [];
      capture.eq.push([column, value]);
      return builder;
    },
    or(value) {
      capture.or = value;
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
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

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
  assert.equal(PROFILE_PUBLIC_SELECT, "id, display_name, avatar_id, country_code");
  assert.doesNotMatch(PROFILE_PUBLIC_SELECT, /email|phone|raw_user_meta|identities|token/i);
  const mapped = normalizePublicProfile({
    id: THEM,
    display_name: "Marie",
    avatar_id: "amina",
    country_code: "HT",
    email: "hidden@example.com",
    phone: "+15555550100",
  });
  assert.deepEqual(Object.keys(mapped).sort(), ["avatarId", "countryCode", "displayName", "playerId"]);
  assert.equal(mapped.email, undefined);
  assert.equal(mapped.phone, undefined);
}

{
  assert.equal(canSearchPlayers("a"), false);
  assert.equal(canSearchPlayers("ma"), true);
  assert.equal(escapeIlike("a%b_c\\d"), "a\\%b\\_c\\\\d");
  const capture = {};
  const client = {
    from(table) {
      assert.equal(table, "profiles");
      return queryBuilder(
        {
          data: [
            {
              id: THEM,
              display_name: "Marie",
              avatar_id: "amina",
              country_code: "HT",
              email: "secret@example.com",
            },
          ],
          error: null,
        },
        capture
      );
    },
  };
  const rows = await searchPlayers("Marie", ME, client);
  assert.equal(capture.select, PROFILE_PUBLIC_SELECT);
  assert.doesNotMatch(capture.select, /email|phone/i);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerId, THEM);
  assert.equal(rows[0].email, undefined);
  const skipped = await searchPlayers("Marie", "", client);
  assert.deepEqual(skipped, []);
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
