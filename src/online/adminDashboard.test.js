/**
 * Admin Dashboard V1 client contract. No network.
 * Run: node src/online/adminDashboard.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  ADMIN_ERROR,
  ADMIN_PAGE_SIZE,
  ADMIN_USER_FIELDS,
  AdminError,
  buildAdminUserListPayload,
  fetchAdminOverview,
  fetchAdminUsers,
  normalizeAdminOverview,
  normalizeAdminUser,
  normalizeAdminUserList,
  normalizeStaffProbe,
  overviewCardsFromPayload,
  probeAmIStaff,
  sanitizeAdminSearch,
} from "./adminDashboard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/adminDashboard.js"), "utf8");

assert.match(source, /rpc\("am_i_staff"\)/);
assert.match(source, /rpc\("admin_get_overview"\)/);
assert.match(source, /rpc\("admin_list_users"/);
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
  assert.equal(calls[0].name, "am_i_staff");
  assert.equal(calls[1].name, "admin_get_overview");
  assert.equal(calls[2].name, "admin_list_users");
  assert.deepEqual(calls[2].payload, { p_search: "leo", p_limit: 25, p_offset: 25 });
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
  const client = {
    async rpc() {
      return { data: null, error: { message: "function admin_get_overview does not exist", code: "42883" } };
    },
  };
  await assert.rejects(() => fetchAdminOverview(client), (error) => error.code === ADMIN_ERROR.UNAVAILABLE);
}

console.log("  ✓ admin dashboard client contract");
