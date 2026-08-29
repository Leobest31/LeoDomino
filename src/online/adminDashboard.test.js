/**
 * Admin Dashboard V1 client contract. No network.
 * Run: node src/online/adminDashboard.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  adminAccountStatus,
  adminPresenceI18nKey,
  adminPresenceState,
  ADMIN_ERROR,
  ADMIN_LIVE_MATCH_FIELDS,
  ADMIN_LIVE_PLAYER_FIELDS,
  ADMIN_LIVE_POLL_MS,
  ADMIN_PAGE_SIZE,
  ADMIN_SPECTATOR_FIELDS,
  ADMIN_SPECTATOR_POLL_MS,
  ADMIN_SPECTATOR_STRIP_KEYS,
  ADMIN_TOP_RP_FIELDS,
  ADMIN_RP_EVENT_FIELDS,
  ADMIN_USER_FIELDS,
  AdminError,
  buildAdminLiveMatchListPayload,
  buildAdminRpHistoryPayload,
  buildAdminTopRpPayload,
  buildAdminUserListPayload,
  fetchAdminLiveMatchView,
  fetchAdminLiveMatches,
  fetchAdminOverview,
  fetchAdminPlayerRpHistory,
  fetchAdminTopRp,
  fetchAdminUsers,
  isAdminSpectatorEnded,
  liveMatchStatusKey,
  normalizeAdminLiveMatch,
  normalizeAdminLiveMatchList,
  normalizeAdminOverview,
  normalizeAdminRpEvent,
  normalizeAdminRpHistory,
  normalizeAdminSpectatorView,
  normalizeAdminTopRpList,
  normalizeAdminUser,
  normalizeAdminUserList,
  normalizeStaffProbe,
  overviewCardsFromPayload,
  probeAmIStaff,
  sanitizeAdminSearch,
  sanitizeSpectatorTile,
  shouldApplySpectatorSnapshot,
} from "./adminDashboard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/adminDashboard.js"), "utf8");

assert.match(source, /rpc\("am_i_staff"\)/);
assert.match(source, /rpc\("admin_get_overview"\)/);
assert.match(source, /rpc\("admin_list_users"/);
assert.match(source, /rpc\("admin_list_live_matches"/);
assert.match(source, /rpc\("admin_get_live_match_view"/);
assert.match(source, /rpc\("admin_list_top_rp"/);
assert.match(source, /rpc\("admin_list_player_rp_history"/);
assert.doesNotMatch(source, /\.from\(/);
assert.doesNotMatch(source, /get_game_view|submit_game_action|forfeit_online_match/);
assert.match(source, /ADMIN_SPECTATOR_STRIP_KEYS/);
assert.ok(ADMIN_SPECTATOR_STRIP_KEYS.includes("myHand"));
assert.ok(ADMIN_SPECTATOR_STRIP_KEYS.includes("engine_state"));
assert.ok(ADMIN_SPECTATOR_STRIP_KEYS.includes("game_secrets"));
assert.ok(ADMIN_SPECTATOR_STRIP_KEYS.includes("deal_seed"));
assert.doesNotMatch(source, /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i);
assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.doesNotMatch(source, /user_metadata|raw_user_meta_data|accountAge/);

assert.deepEqual(normalizeStaffProbe({ is_staff: false, role: null }), { isStaff: false, role: null });
assert.deepEqual(normalizeStaffProbe({ is_staff: true, role: "owner" }), { isStaff: true, role: "owner" });
assert.deepEqual(normalizeStaffProbe({ is_staff: true, role: "admin" }), { isStaff: true, role: "admin" });
assert.deepEqual(normalizeStaffProbe({ is_staff: true, role: "moderator" }), { isStaff: true, role: "moderator" });
assert.deepEqual(normalizeStaffProbe({ is_staff: true, role: "superuser" }), { isStaff: false, role: null });
assert.deepEqual(
  normalizeStaffProbe({ is_staff: true, role: "owner", email: "hidden@example.com" }),
  { isStaff: true, role: "owner" }
);

assert.equal(sanitizeAdminSearch("  leo  "), "leo");
assert.equal(sanitizeAdminSearch("x".repeat(80)).length, 64);
assert.deepEqual(buildAdminUserListPayload({ search: "  Best ", limit: 25, offset: 50 }), {
  p_search: "Best",
  p_limit: 25,
  p_offset: 50,
});
assert.deepEqual(buildAdminUserListPayload({ search: "", limit: 999, offset: -4 }), {
  p_search: null,
  p_limit: 50,
  p_offset: 0,
});
assert.equal(ADMIN_PAGE_SIZE, 25);

{
  const overview = normalizeAdminOverview({
    total_active_accounts: 12,
    total_deleted_accounts: 1,
    accounts_created_today: 2,
    accounts_created_7d: 5,
    accounts_created_30d: 9,
    active_match_player_count: 4,
    active_match_count: 2,
    global_online_user_count: null,
    email: "nope@example.com",
  });
  assert.equal(overview.totalActiveAccounts, 12);
  assert.equal(overview.globalOnlineUserCount, null);
  assert.equal("email" in overview, false);
  const cards = overviewCardsFromPayload(overview);
  assert.deepEqual(
    cards.map((card) => card.id),
    [
      "totalAccounts",
      "newToday",
      "last7Days",
      "last30Days",
      "activeMatches",
      "activeMatchPlayers",
      "deletedAccounts",
      "globalOnlineUsers",
    ]
  );
  assert.equal(cards.find((card) => card.id === "activeMatches").value, 2);
  assert.equal(cards.find((card) => card.id === "activeMatchPlayers").value, 4);
  const online = cards.find((card) => card.id === "globalOnlineUsers");
  assert.equal(online.value, null);
  assert.equal(online.unsupported, true);
  {
    const counted = overviewCardsFromPayload(
      normalizeAdminOverview({
        total_active_accounts: 12,
        total_deleted_accounts: 1,
        accounts_created_today: 2,
        accounts_created_7d: 5,
        accounts_created_30d: 9,
        active_match_player_count: 4,
        active_match_count: 2,
        global_online_user_count: 7,
      })
    ).find((card) => card.id === "globalOnlineUsers");
    assert.equal(counted.value, 7);
    assert.equal(counted.unsupported, false);
  }
  assert.deepEqual(overviewCardsFromPayload(null), []);
  assert.deepEqual(
    overviewCardsFromPayload({
      totalActiveAccounts: 3,
      accountsCreatedToday: null,
      accountsCreated7d: 0,
      accountsCreated30d: 1,
      activeMatchCount: 0,
      activeMatchPlayerCount: 0,
      totalDeletedAccounts: 0,
      globalOnlineUserCount: null,
    }).map((card) => [card.id, card.value, card.unsupported]),
    [
      ["totalAccounts", 3, false],
      ["last7Days", 0, false],
      ["last30Days", 1, false],
      ["activeMatches", 0, false],
      ["activeMatchPlayers", 0, false],
      ["deletedAccounts", 0, false],
      ["globalOnlineUsers", null, true],
    ]
  );
}

{
  const leaked = normalizeAdminUser({
    player_id: "3fe612b0-99dc-489c-b6bf-ddaab8f8acf1",
    display_name: "Lbest",
    username: "leobest",
    country_code: "US",
    avatar_id: "marcus",
    created_at: "2026-08-28T16:27:50.591334+00:00",
    deleted_at: null,
    rp: 1000,
    wins: 2,
    losses: 1,
    matches_played: 3,
    in_active_match: false,
    email: "support@leodomino.com",
    phone: "555",
    raw_user_meta_data: { accountAge: 21 },
    access_token: "secret",
  });
  assert.equal(leaked.username, "leobest");
  assert.equal(leaked.inActiveMatch, false);
  for (const key of Object.keys(leaked)) {
    assert.ok(ADMIN_USER_FIELDS.includes(key), key);
  }
  assert.equal("email" in leaked, false);
  assert.equal("phone" in leaked, false);
  assert.equal("access_token" in leaked, false);
  assert.equal("raw_user_meta_data" in leaked, false);
}

{
  const now = Date.parse("2026-08-29T07:00:00.000Z");
  assert.equal(adminAccountStatus({ deletedAt: null }), "active");
  assert.equal(adminAccountStatus({ deletedAt: "2026-08-28T12:00:00.000Z" }), "deleted");
  assert.equal(
    adminPresenceState({ inActiveMatch: false, deletedAt: null }, now),
    "offline",
    "an active account is not online"
  );
  assert.equal(
    adminPresenceState(
      {
        deletedAt: "2026-08-28T12:00:00.000Z",
        inActiveMatch: true,
        presenceLastSeenAt: "2026-08-29T06:59:50.000Z",
      },
      now
    ),
    "offline",
    "deleted accounts are Offline"
  );
  assert.equal(
    adminPresenceState({ inActiveMatch: true }, now),
    "offline",
    "occupancy without a fresh heartbeat is Offline"
  );
  assert.equal(
    adminPresenceState(
      {
        inActiveMatch: true,
        matchLastSeenAt: "2026-08-29T06:59:00.000Z",
      },
      now
    ),
    "offline",
    "occupancy last_seen without a signed-in heartbeat is Offline"
  );
  assert.equal(
    adminPresenceState(
      { inActiveMatch: true, presenceLastSeenAt: "2026-08-29T06:59:50.000Z" },
      now
    ),
    "in_match",
    "occupancy EXISTS plus a fresh heartbeat is In Match"
  );
  assert.equal(
    adminPresenceState(
      {
        inActiveMatch: true,
        matchLastSeenAt: "2026-08-29T06:58:00.000Z",
        presenceLastSeenAt: "2026-08-29T06:59:50.000Z",
      },
      now
    ),
    "in_match",
    "fresh heartbeat plus occupancy is In Match"
  );
  assert.equal(
    adminPresenceState(
      {
        inActiveMatch: true,
        matchLastSeenAt: "2026-08-29T06:50:00.000Z",
        presenceLastSeenAt: "2026-08-29T06:59:50.000Z",
      },
      now
    ),
    "online",
    "stale occupancy with a fresh heartbeat is Online, not In Match"
  );
  assert.equal(
    adminPresenceState(
      {
        inActiveMatch: true,
        matchLastSeenAt: "2026-08-29T07:01:00.000Z",
        presenceLastSeenAt: "2026-08-29T06:59:50.000Z",
      },
      now
    ),
    "online",
    "future occupancy last_seen with a fresh heartbeat is Online"
  );
  assert.equal(
    adminPresenceState(
      {
        inActiveMatch: true,
        presenceLastSeenAt: "2026-08-29T06:58:00.000Z",
      },
      now
    ),
    "offline",
    "stale heartbeat with occupancy is Offline"
  );
  assert.equal(
    adminPresenceState(
      { inActiveMatch: false, presenceLastSeenAt: "2026-08-29T06:59:20.000Z" },
      now
    ),
    "online"
  );
  assert.equal(
    adminPresenceState(
      { inActiveMatch: false, presenceLastSeenAt: "2026-08-29T06:58:00.000Z" },
      now
    ),
    "offline",
    "stale signed-in heartbeat is Offline"
  );
  assert.equal(
    adminPresenceState(
      { inActiveMatch: false, presenceLastSeenAt: "2026-08-29T07:01:00.000Z" },
      now
    ),
    "offline",
    "future signed-in heartbeat fails safe to Offline"
  );
  assert.equal(
    adminPresenceState(
      { inActiveMatch: false, presenceLastSeenAt: "not-a-timestamp" },
      now
    ),
    "offline",
    "unparseable heartbeat fails safe to Offline"
  );
  assert.equal(adminPresenceI18nKey("in_match"), "admin.presenceInMatch");
  assert.equal(adminPresenceI18nKey("offline"), "admin.presenceOffline");
  assert.equal(adminPresenceI18nKey("online"), "admin.presenceOnline");
}

{
  const page = normalizeAdminUserList({
    users: [
      { player_id: "a", display_name: "Ada", username: "ada", rp: 1100, wins: 1, losses: 0, matches_played: 1 },
    ],
    total: 41,
    limit: 25,
    offset: 0,
    email: "nope",
  });
  assert.equal(page.total, 41);
  assert.equal(page.users[0].displayName, "Ada");
  assert.equal("email" in page, false);
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      if (name === "am_i_staff") return { data: { is_staff: false, role: null }, error: null };
      return { data: null, error: { message: "staff required", code: "42501" } };
    },
  };
  const probe = await probeAmIStaff(client);
  assert.deepEqual(probe, { isStaff: false, role: null });
  await assert.rejects(() => fetchAdminOverview(client), (error) => {
    assert.ok(error instanceof AdminError);
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
  await assert.rejects(() => fetchAdminUsers({ search: "leo", offset: 25 }, client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
  await assert.rejects(() => fetchAdminLiveMatches({ offset: 0 }, client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
  await assert.rejects(() => fetchAdminLiveMatchView("11111111-1111-4111-8111-111111111111", client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
  await assert.rejects(() => fetchAdminTopRp({ offset: 0 }, client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
  await assert.rejects(
    () => fetchAdminPlayerRpHistory("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}, client),
    (error) => {
      assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
      return true;
    }
  );
  assert.equal(calls[0].name, "am_i_staff");
  assert.equal(calls[1].name, "admin_get_overview");
  assert.equal(calls[2].name, "admin_list_users");
  assert.deepEqual(calls[2].payload, { p_search: "leo", p_limit: 25, p_offset: 25 });
  assert.equal(calls[3].name, "admin_list_live_matches");
  assert.deepEqual(calls[3].payload, { p_limit: 25, p_offset: 0 });
  assert.equal(calls[4].name, "admin_get_live_match_view");
  assert.deepEqual(calls[4].payload, { p_match_id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(calls[5].name, "admin_list_top_rp");
  assert.equal(calls[6].name, "admin_list_player_rp_history");
}

{
  const client = {
    async rpc(name) {
      if (name === "am_i_staff") return { data: { is_staff: true, role: "owner" }, error: null };
      if (name === "admin_get_overview") {
        return {
          data: {
            total_active_accounts: 8,
            total_deleted_accounts: 0,
            accounts_created_today: 1,
            accounts_created_7d: 3,
            accounts_created_30d: 8,
            active_match_player_count: 2,
            active_match_count: 1,
            global_online_user_count: null,
          },
          error: null,
        };
      }
      return { data: { users: [], total: 0, limit: 25, offset: 0 }, error: null };
    },
  };
  const staff = await probeAmIStaff(client);
  assert.equal(staff.role, "owner");
  const overview = await fetchAdminOverview(client);
  assert.equal(overview.totalActiveAccounts, 8);
  assert.equal(overview.globalOnlineUserCount, null);
  const users = await fetchAdminUsers({}, client);
  assert.deepEqual(users.users, []);
}

{
  const live = normalizeAdminLiveMatch({
    match_id: "11111111-1111-4111-8111-111111111111",
    ruleset_id: "haitian",
    rated: true,
    match_kind: "public",
    match_status: "playing",
    admin_status: "live",
    created_at: "2026-08-28T18:00:00.000Z",
    player_a: {
      player_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      display_name: "Ada",
      username: "ada",
      avatar_id: "amina",
      rp: 1120,
      last_seen_at: "2026-08-28T18:01:00.000Z",
      stale: false,
      email: "hidden@example.com",
    },
    player_b: {
      player_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      display_name: "Bea",
      username: "bea",
      avatar_id: "noah",
      rp: 980,
      last_seen_at: "2026-08-28T18:01:10.000Z",
      stale: false,
    },
    score_a: 45,
    score_b: 30,
    round: 2,
    current_seat: 1,
    current_player_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    session_status: "playing",
    phase: "playing",
    session_updated_at: "2026-08-28T18:01:10.000Z",
    hand_count_a: 5,
    hand_count_b: 6,
    reserve_count: 14,
    version: 8,
    email: "nope@example.com",
    myHand: [{ id: "secret" }],
    engine_state: { players: [] },
    board: [{ id: "tile" }],
  });
  assert.equal(live.matchId, "11111111-1111-4111-8111-111111111111");
  assert.equal(live.rulesetId, "haitian");
  assert.equal(live.rated, true);
  assert.equal(live.adminStatus, "live");
  assert.equal(live.scoreA, 45);
  assert.equal(live.scoreB, 30);
  assert.equal(live.round, 2);
  assert.equal(live.currentSeat, 1);
  assert.equal(live.currentPlayerId, live.playerB.playerId);
  assert.equal(live.playerA.rp, 1120);
  assert.equal(live.playerB.rp, 980);
  assert.equal(live.handCountA, 5);
  assert.equal("email" in live, false);
  assert.equal("myHand" in live, false);
  assert.equal("engine_state" in live, false);
  assert.equal("board" in live, false);
  assert.equal("email" in live.playerA, false);
  for (const key of Object.keys(live)) {
    assert.ok(ADMIN_LIVE_MATCH_FIELDS.includes(key), key);
  }
  for (const key of Object.keys(live.playerA)) {
    assert.ok(ADMIN_LIVE_PLAYER_FIELDS.includes(key), key);
  }
  assert.equal(liveMatchStatusKey("live"), "admin.statusLive");
  assert.equal(liveMatchStatusKey("disconnected"), "admin.statusDisconnected");
  assert.equal(liveMatchStatusKey("waiting"), "admin.statusWaiting");
  assert.equal(ADMIN_LIVE_POLL_MS, 8000);
}

{
  const waiting = normalizeAdminLiveMatch({
    match_id: "22222222-2222-4222-8222-222222222222",
    ruleset_id: "legacy",
    rated: false,
    match_kind: "friend",
    match_status: "ready",
    admin_status: "waiting",
    created_at: "2026-08-28T18:02:00.000Z",
    player_a: { player_id: "a", display_name: "A", username: "a", rp: 1000, stale: false },
    player_b: { player_id: "b", display_name: "B", username: "b", rp: 1000, stale: false },
    score_a: null,
    score_b: null,
    round: null,
    current_seat: null,
    current_player_id: null,
    session_status: null,
  });
  assert.equal(waiting.rated, false);
  assert.equal(waiting.matchKind, "friend");
  assert.equal(waiting.adminStatus, "waiting");
  assert.equal(waiting.scoreA, null);
  assert.equal(waiting.round, null);
}

{
  const stale = normalizeAdminLiveMatch({
    match_id: "33333333-3333-4333-8333-333333333333",
    ruleset_id: "american",
    rated: true,
    match_kind: "public",
    match_status: "playing",
    admin_status: "disconnected",
    created_at: "2026-08-28T17:00:00.000Z",
    player_a: {
      player_id: "a",
      display_name: "A",
      username: "a",
      rp: 1000,
      last_seen_at: "2026-08-28T17:01:00.000Z",
      stale: true,
    },
    player_b: {
      player_id: "b",
      display_name: "B",
      username: "b",
      rp: 1000,
      last_seen_at: "2026-08-28T18:00:00.000Z",
      stale: false,
    },
    score_a: 10,
    score_b: 20,
    round: 1,
    current_seat: 0,
    current_player_id: "a",
    session_status: "playing",
  });
  assert.equal(stale.adminStatus, "disconnected");
  assert.equal(stale.playerA.stale, true);
  assert.equal(stale.playerB.stale, false);
}

{
  const page = normalizeAdminLiveMatchList({
    matches: [
      {
        match_id: "m1",
        ruleset_id: "legacy",
        rated: true,
        match_kind: "public",
        match_status: "playing",
        admin_status: "live",
        player_a: { player_id: "a", username: "a", rp: 1000, stale: false },
        player_b: { player_id: "b", username: "b", rp: 1000, stale: false },
        score_a: 0,
        score_b: 0,
        round: 1,
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
    email: "nope",
  });
  assert.equal(page.total, 1);
  assert.equal(page.matches[0].playerA.username, "a");
  assert.equal("email" in page, false);
  assert.deepEqual(buildAdminLiveMatchListPayload({ limit: 999, offset: -2 }), {
    p_limit: 50,
    p_offset: 0,
  });
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return {
        data: { matches: [], total: 0, limit: 25, offset: 0 },
        error: null,
      };
    },
  };
  const empty = await fetchAdminLiveMatches({ offset: 25 }, client);
  assert.deepEqual(empty.matches, []);
  assert.equal(calls[0].name, "admin_list_live_matches");
  assert.deepEqual(calls[0].payload, { p_limit: 25, p_offset: 25 });
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "function admin_get_overview does not exist", code: "42883" } };
    },
  };
  await assert.rejects(() => fetchAdminOverview(client), (error) => error.code === ADMIN_ERROR.UNAVAILABLE);
}

{
  assert.equal(sanitizeSpectatorTile({ id: "6-5" }), null);
  assert.equal(sanitizeSpectatorTile("6-5"), null);
  assert.deepEqual(
    sanitizeSpectatorTile({
      id: "6-5",
      left: 6,
      right: 5,
      orientation: "horizontal",
      secret: "nope",
      pips: [6, 5],
    }),
    { id: "6-5", left: 6, right: 5, orientation: "horizontal", destination: null, branch: null }
  );
}

{
  const leaked = normalizeAdminSpectatorView({
    match_id: "11111111-1111-4111-8111-111111111111",
    ruleset_id: "haitian",
    rated: true,
    match_kind: "public",
    match_status: "playing",
    admin_status: "live",
    finish_reason: null,
    created_at: "2026-08-28T18:00:00.000Z",
    player_a: {
      player_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      display_name: "Ada",
      username: "ada",
      avatar_id: "amina",
      rp: 1120,
      last_seen_at: "2026-08-28T18:01:00.000Z",
      stale: false,
      email: "hidden@example.com",
    },
    player_b: {
      player_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      display_name: "Bea",
      username: "bea",
      avatar_id: "noah",
      rp: 980,
      last_seen_at: "2026-08-28T18:01:10.000Z",
      stale: false,
    },
    score_a: 45,
    score_b: 30,
    round: 2,
    current_seat: 1,
    current_player_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    session_status: "playing",
    phase: "playing",
    session_updated_at: "2026-08-28T18:01:10.000Z",
    hand_count_a: 6,
    hand_count_b: 4,
    reserve_count: 14,
    version: 8,
    board: [
      { id: "6-6", left: 6, right: 6, orientation: "vertical", extra: true },
      { id: "secret-hand" },
      "6-5",
    ],
    spinner: {
      id: "6-6",
      north: [{ id: "6-1", left: 6, right: 1, orientation: "vertical" }],
      south: [],
    },
    last_play_points: 10,
    last_play_score_terminals: ["6-6"],
    match_winner_seat: null,
    myHand: [{ id: "5-5", left: 5, right: 5 }],
    engine_state: { players: [{ hand: ["5-5", "4-3"] }] },
    game_secrets: { deal_seed: 99 },
    deal_seed: 99,
    legalMoves: [{ tileId: "5-5" }],
    reserve: ["0-0", "1-1"],
    boneyard: [{ id: "0-0", left: 0, right: 0 }],
    hands: [["5-5"], ["4-3"]],
    round_result: { hands: [["5-5"], ["4-3"]] },
    email: "nope@example.com",
  });
  assert.equal(leaked.matchId, "11111111-1111-4111-8111-111111111111");
  assert.equal(leaked.board.length, 1);
  assert.deepEqual(leaked.board[0], {
    id: "6-6",
    left: 6,
    right: 6,
    orientation: "vertical",
    destination: null,
    branch: null,
  });
  assert.equal(leaked.spinner.id, "6-6");
  assert.equal(leaked.spinner.north[0].left, 6);
  assert.equal(leaked.handCountA, 6);
  assert.equal(leaked.handCountB, 4);
  assert.equal(leaked.reserveCount, 14);
  assert.equal(leaked.lastPlayPoints, 10);
  assert.deepEqual(leaked.lastPlayScoreTerminals, ["6-6"]);
  for (const key of Object.keys(leaked)) {
    assert.ok(ADMIN_SPECTATOR_FIELDS.includes(key), key);
  }
  const blob = JSON.stringify(leaked);
  assert.equal("myHand" in leaked, false);
  assert.equal("engine_state" in leaked, false);
  assert.equal("game_secrets" in leaked, false);
  assert.equal("deal_seed" in leaked, false);
  assert.equal("reserve" in leaked, false);
  assert.equal("boneyard" in leaked, false);
  assert.equal("hands" in leaked, false);
  assert.equal("legalMoves" in leaked, false);
  assert.doesNotMatch(blob, /5-5/);
  assert.doesNotMatch(blob, /4-3/);
  assert.doesNotMatch(blob, /0-0/);
  assert.doesNotMatch(blob, /deal_seed/);
  assert.doesNotMatch(blob, /engine_state/);
  assert.doesNotMatch(blob, /game_secrets/);
  assert.doesNotMatch(blob, /myHand/);
}

{
  assert.equal(isAdminSpectatorEnded("live"), false);
  assert.equal(isAdminSpectatorEnded("finished"), true);
  assert.equal(isAdminSpectatorEnded("forfeit"), true);
  assert.equal(isAdminSpectatorEnded("aborted"), true);
  assert.equal(ADMIN_SPECTATOR_POLL_MS, 1500);
  const first = { version: 1, adminStatus: "live", sessionUpdatedAt: "a", matchStatus: "playing" };
  const same = { version: 1, adminStatus: "live", sessionUpdatedAt: "a", matchStatus: "playing" };
  const moved = { version: 2, adminStatus: "live", sessionUpdatedAt: "b", matchStatus: "playing" };
  const ended = { version: 3, adminStatus: "finished", sessionUpdatedAt: "c", matchStatus: "finished" };
  assert.equal(shouldApplySpectatorSnapshot(null, first), true);
  assert.equal(shouldApplySpectatorSnapshot(first, same), false);
  assert.equal(shouldApplySpectatorSnapshot(first, moved), true);
  assert.equal(shouldApplySpectatorSnapshot(moved, ended), true);
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return {
        data: {
          match_id: payload.p_match_id,
          ruleset_id: "legacy",
          rated: false,
          match_kind: "public",
          match_status: "playing",
          admin_status: "live",
          created_at: "2026-08-28T18:00:00.000Z",
          player_a: { player_id: "a", display_name: "A", username: "a", rp: 1000, stale: false },
          player_b: { player_id: "b", display_name: "B", username: "b", rp: 1000, stale: false },
          score_a: 0,
          score_b: 0,
          round: 1,
          current_seat: 0,
          current_player_id: "a",
          session_status: "playing",
          phase: "playing",
          hand_count_a: 7,
          hand_count_b: 7,
          reserve_count: 14,
          version: 1,
          board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
          spinner: { id: "6-6", north: [], south: [] },
        },
        error: null,
      };
    },
  };
  const view = await fetchAdminLiveMatchView("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client);
  assert.equal(calls[0].name, "admin_get_live_match_view");
  assert.equal(view.board[0].id, "6-6");
  assert.equal(view.handCountA, 7);
  assert.equal("myHand" in view, false);
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "authentication required", code: "28000" } };
    },
  };
  await assert.rejects(() => fetchAdminLiveMatchView("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.AUTH);
    return true;
  });
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "permission denied for function admin_get_live_match_view", code: "42501" } };
    },
  };
  await assert.rejects(() => fetchAdminLiveMatchView("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client), (error) => {
    assert.equal(error.code, ADMIN_ERROR.FORBIDDEN);
    return true;
  });
}

{
  const page = normalizeAdminTopRpList({
    players: [
      {
        player_id: "b",
        display_name: "Bea",
        username: "bea",
        rp: 1200,
        wins: 4,
        losses: 1,
        matches_played: 5,
        rank: 1,
        email: "hidden@example.com",
      },
      {
        player_id: "a",
        display_name: "Ada",
        username: "ada",
        rp: 1100,
        wins: 2,
        losses: 2,
        matches_played: 4,
        rank: 2,
      },
    ],
    total: 2,
    limit: 25,
    offset: 0,
  });
  assert.deepEqual(
    page.players.map((player) => player.rp),
    [1200, 1100]
  );
  assert.equal(page.players[0].rank, 1);
  assert.equal(page.players[0].wins, 4);
  assert.equal("email" in page.players[0], false);
  for (const key of Object.keys(page.players[0])) {
    assert.ok(ADMIN_TOP_RP_FIELDS.includes(key), key);
  }
  assert.deepEqual(buildAdminTopRpPayload({ limit: 999, offset: -1 }), { p_limit: 50, p_offset: 0 });
}

{
  const win = normalizeAdminRpEvent({
    match_id: "m-rated",
    opponent: { player_id: "opp", display_name: "Opp", username: "opp" },
    result: "win",
    rp_before: 1000,
    rp_delta: 16,
    rp_after: 1016,
    settled_at: "2026-08-28T18:04:11.123Z",
    finished_at: "2026-08-28T18:04:11.100Z",
    rated: true,
    ruleset_id: "haitian",
    finish_reason: "completed",
    match_kind: "public",
    myHand: ["6-5"],
    engine_state: {},
  });
  assert.equal(win.settledAt, "2026-08-28T18:04:11.123Z");
  assert.equal(win.result, "win");
  assert.equal(win.rpBefore, 1000);
  assert.equal(win.rpDelta, 16);
  assert.equal(win.rpAfter, 1016);
  assert.equal(win.rated, true);
  assert.equal("myHand" in win, false);
  for (const key of Object.keys(win)) {
    assert.ok(ADMIN_RP_EVENT_FIELDS.includes(key), key);
  }

  assert.equal(
    normalizeAdminRpEvent({
      match_id: "m-friend",
      opponent: { player_id: "opp", display_name: "Opp", username: "opp" },
      result: "win",
      rp_before: 1000,
      rp_delta: 0,
      rp_after: 1000,
      settled_at: "2026-08-28T18:04:11.123Z",
      rated: false,
      match_kind: "friend",
    }),
    null
  );

  assert.equal(
    normalizeAdminRpEvent({
      match_id: "m-no-time",
      opponent: { player_id: "opp", display_name: "Opp", username: "opp" },
      result: "win",
      rp_before: 1000,
      rp_delta: 16,
      rp_after: 1016,
      rated: true,
    }),
    null
  );

  const history = normalizeAdminRpHistory({
    player: { player_id: "a", display_name: "Ada", username: "ada", rp: 1016, wins: 1, losses: 0, matches_played: 1, rank: 3 },
    events: [
      {
        match_id: "m-rated",
        opponent: { player_id: "opp", display_name: "Opp", username: "opp" },
        result: "win",
        rp_before: 1000,
        rp_delta: 16,
        rp_after: 1016,
        settled_at: "2026-08-28T18:04:11.123Z",
        rated: true,
        ruleset_id: "legacy",
        finish_reason: "completed",
      },
      {
        match_id: "m-unrated",
        opponent: { player_id: "friend", display_name: "Friend", username: "pal" },
        result: "win",
        rp_before: 1000,
        rp_delta: 0,
        rp_after: 1000,
        settled_at: "2026-08-28T17:00:00.000Z",
        rated: false,
        match_kind: "friend",
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
  });
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].matchId, "m-rated");
  assert.equal(history.player.rp, 1016);
  assert.deepEqual(buildAdminRpHistoryPayload("pid", { limit: 10, offset: 25 }), {
    p_player_id: "pid",
    p_limit: 10,
    p_offset: 25,
  });
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      if (name === "admin_list_top_rp") {
        return {
          data: {
            players: [
              { player_id: "b", username: "bea", rp: 1200, wins: 3, losses: 0, matches_played: 3, rank: 1 },
              { player_id: "a", username: "ada", rp: 1000, wins: 1, losses: 1, matches_played: 2, rank: 2 },
            ],
            total: 2,
            limit: 25,
            offset: 0,
          },
          error: null,
        };
      }
      return {
        data: {
          player: { player_id: payload.p_player_id, username: "bea", rp: 1200, wins: 3, losses: 0, matches_played: 3, rank: 1 },
          events: [
            {
              match_id: "m1",
              opponent: { player_id: "a", username: "ada" },
              result: "win",
              rp_before: 1184,
              rp_delta: 16,
              rp_after: 1200,
              settled_at: "2026-08-28T19:00:00.000Z",
              rated: true,
              ruleset_id: "haitian",
              finish_reason: "completed",
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
        },
        error: null,
      };
    },
  };
  const top = await fetchAdminTopRp({}, client);
  assert.equal(calls[0].name, "admin_list_top_rp");
  assert.ok(top.players[0].rp >= top.players[1].rp);
  const hist = await fetchAdminPlayerRpHistory("b", {}, client);
  assert.equal(calls[1].name, "admin_list_player_rp_history");
  assert.equal(hist.events[0].settledAt, "2026-08-28T19:00:00.000Z");
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "authentication required", code: "28000" } };
    },
  };
  await assert.rejects(() => fetchAdminTopRp({}, client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(
    () => fetchAdminPlayerRpHistory("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}, client),
    (error) => error.code === ADMIN_ERROR.AUTH
  );
}

console.log("  ✓ admin dashboard client contract");
