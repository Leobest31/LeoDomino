/**
 * Admin Dashboard V1 remaining client contract. No network.
 * Run: node src/online/adminV1.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";
import {
  ADMIN_CHALLENGE_STATUSES,
  ADMIN_V1_NAV,
  fetchAdminAudit,
  fetchAdminChallenge,
  fetchAdminFeedback,
  fetchAdminInviteWin,
  fetchAdminLeague,
  fetchAdminReports,
  fetchAdminUserDetail,
  formatAdminClipboardReport,
  fetchAdminClipboardReport,
  normalizeAdminChallenge,
  normalizeAdminFeedback,
  normalizeAdminInviteWin,
  normalizeAdminLeague,
  normalizeAdminReport,
  normalizeAdminUserDetailPayload,
  updateAdminChallenge,
  updateAdminReportStatus,
} from "./adminV1.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/adminV1.js"), "utf8");
const page = readFileSync(join(root, "src/pages/AdminPage.jsx"), "utf8");

assert.deepEqual([...ADMIN_V1_NAV], [
  "overview",
  "users",
  "liveMatches",
  "globalRp",
  "reports",
  "challenge",
  "inviteWin",
  "league",
  "feedback",
  "audit",
]);
assert.match(source, /rpc\(\s*"admin_get_user"/);
assert.match(source, /rpc\(\s*"admin_list_reports"/);
assert.match(source, /rpc\(\s*"admin_list_feedback"/);
assert.match(source, /rpc\(\s*"admin_list_audit"/);
assert.match(source, /rpc\(\s*"admin_get_invite_win"/);
assert.match(source, /rpc\(\s*"admin_get_challenge"/);
assert.match(source, /rpc\(\s*"admin_get_league"/);
assert.match(source, /rpc\(\s*"admin_update_report_status"/);
assert.match(source, /rpc\(\s*"admin_update_challenge"/);
assert.doesNotMatch(source, /\.from\(/);
assert.doesNotMatch(source, /SERVICE_ROLE|get_game_view|submit_game_action/);
assert.doesNotMatch(source, /cpEarningEnabled: true/);
assert.match(page, /ADMIN_V1_NAV|liveMatches/);

{
  const payload = normalizeAdminUserDetailPayload({
    player: {
      player_id: "a",
      display_name: "Ada",
      username: "ada",
      rp: 1100,
      wins: 2,
      losses: 1,
      matches_played: 3,
      in_active_match: true,
      match_last_seen_at: "2026-08-28T20:00:00.000Z",
      presence_last_seen_at: "2026-08-28T19:59:50.000Z",
      friend_count: 4,
      email: "hidden@example.com",
    },
    recent_rated_matches: [
      {
        match_id: "m1",
        rated: true,
        result: "win",
        settled_at: "2026-08-28T19:00:00.000Z",
        ruleset_id: "legacy",
        finish_reason: "completed",
        match_kind: "public",
        myHand: ["6-6"],
      },
      {
        match_id: "m-friend",
        rated: false,
        result: "win",
        settled_at: "2026-08-28T18:00:00.000Z",
      },
    ],
  });
  assert.equal(payload.player.friendCount, 4);
  assert.equal(payload.player.matchLastSeenAt, "2026-08-28T20:00:00.000Z");
  assert.equal(payload.player.presenceLastSeenAt, "2026-08-28T19:59:50.000Z");
  assert.equal("email" in payload.player, false);
  assert.equal(payload.recentRatedMatches.length, 1);
  assert.equal(payload.recentRatedMatches[0].settledAt, "2026-08-28T19:00:00.000Z");
  assert.equal("myHand" in payload.recentRatedMatches[0], false);
}

{
  const report = normalizeAdminReport({
    id: "r1",
    reporter: { player_id: "a", display_name: "Ada", username: "ada" },
    reported: { player_id: "b", display_name: "Bea", username: "bea" },
    category: "cheating",
    body: "Played too fast",
    status: "open",
    created_at: "2026-08-28T12:00:00.000Z",
    email: "nope",
  });
  assert.equal(report.status, "open");
  assert.equal("email" in report, false);
}

{
  const challenge = normalizeAdminChallenge({
    status: "live",
    qualification_cp: 5000,
    first_prize_usd: 300,
    second_prize_usd: 200,
    cp_earning_enabled: true,
    qualified_players: [{ player_id: "fake", cp: 9000 }],
  });
  assert.equal(challenge.cpEarningEnabled, false);
  assert.deepEqual(challenge.qualifiedPlayers, []);
  assert.ok(ADMIN_CHALLENGE_STATUSES.includes(challenge.status));
}

{
  const league = normalizeAdminLeague({
    status: "live",
    season_days: 60,
    leaderboard: [{ player_id: "x", lp: 9999 }],
  });
  assert.deepEqual(league.leaderboard, []);
}

{
  const invite = normalizeAdminInviteWin({
    season: { id: "s1", name: "Invite & Win", status: "active", prize_amount_usd: 500, winner: null },
    counts: { pending: 2, validated: 3, rejected: 1 },
    standings: [{ player_id: "a", username: "ada", validated_count: 3, pending_count: 1, rejected_count: 0 }],
  });
  assert.equal(invite.counts.validated, 3);
  assert.equal(invite.standings[0].validatedCount, 3);
}

{
  const fb = normalizeAdminFeedback({
    id: "f1",
    player: { player_id: "a", display_name: "Ada" },
    category: "bug",
    body: "Board clipped on iPhone SE",
    status: "new",
    created_at: "2026-08-28T12:00:00.000Z",
    sentry_dsn: "secret",
  });
  assert.equal(fb.category, "bug");
  assert.equal("sentry_dsn" in fb, false);
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "authentication required", code: "28000" } };
    },
  };
  await assert.rejects(() => fetchAdminReports({}, client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminFeedback({}, client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminAudit({}, client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminChallenge(client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminLeague(client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminInviteWin(client), (error) => error.code === ADMIN_ERROR.AUTH);
  await assert.rejects(() => fetchAdminUserDetail("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client), (error) => error.code === ADMIN_ERROR.AUTH);
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "staff required", code: "42501" } };
    },
  };
  await assert.rejects(() => fetchAdminReports({}, client), (error) => error.code === ADMIN_ERROR.FORBIDDEN);
  await assert.rejects(() => fetchAdminChallenge(client), (error) => error.code === ADMIN_ERROR.FORBIDDEN);
}

{
  await assert.rejects(
    () => updateAdminReportStatus("r1", "resolved", "short", { rpc: async () => ({ data: {}, error: null }) }),
    (error) => error instanceof AdminError
  );
  await assert.rejects(
    () => updateAdminChallenge({ status: "live", reason: "nope" }, { rpc: async () => ({ data: {}, error: null }) }),
    (error) => error instanceof AdminError && error.message === "reason required"
  );
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      if (name === "admin_get_challenge") {
        return { data: { status: "coming_soon", cp_earning_enabled: false, qualified_players: [] }, error: null };
      }
      return { data: { ok: true, status: "reviewing" }, error: null };
    },
  };
  await updateAdminReportStatus("r1", "reviewing", "Looking into this report now", client);
  assert.equal(calls[0].name, "admin_update_report_status");
  assert.equal(calls[0].payload.p_reason, "Looking into this report now");
  const updated = await updateAdminChallenge(
    { status: "coming_soon", startsAt: "2026-09-01T12:00:00.000Z", reason: "Keep Challenge Coming Soon" },
    client
  );
  assert.equal(updated.cpEarningEnabled, false);
  assert.equal(calls[1].payload.p_starts_at, "2026-09-01T12:00:00.000Z");
  assert.equal(calls[1].payload.p_ends_at, null);
}

{
  const text = formatAdminClipboardReport({
    generatedAt: "2026-08-28T22:00:00.000Z",
    role: "owner",
    warnings: ["Global Online Users is not available (no signed-in census)."],
    overview: {
      totalActiveAccounts: 10,
      accountsCreatedToday: 1,
      accountsCreated7d: 2,
      accountsCreated30d: 3,
      activeMatchCount: 0,
      activeMatchPlayerCount: 0,
      totalDeletedAccounts: 0,
      globalOnlineUserCount: null,
    },
    users: {
      total: 1,
      offset: 0,
      users: [{ displayName: "Ada", username: "ada", rp: 1100, wins: 2, losses: 1, inActiveMatch: false, createdAt: "2026-08-01T00:00:00.000Z" }],
    },
    liveMatches: { total: 0, matches: [] },
    topRp: { total: 1, players: [{ rank: 1, displayName: "Ada", username: "ada", rp: 1100, wins: 2, losses: 1, matchesPlayed: 3 }] },
    reports: {
      total: 1,
      items: [{
        status: "open",
        category: "other",
        reporter: { displayName: "Ada", username: "ada" },
        reported: { displayName: "Bea", username: "bea" },
        createdAt: "2026-08-28T12:00:00.000Z",
        body: "Contact me at hidden@example.com please",
      }],
    },
    challenge: {
      status: "coming_soon",
      cpEarningEnabled: false,
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      qualifiedPlayers: [],
    },
    league: { status: "coming_soon", seasonDays: 60, leaderboard: [] },
  });
  assert.match(text, /== Overview ==/);
  assert.match(text, /== Users ==/);
  assert.match(text, /== Live Matches ==/);
  assert.match(text, /== Top RP ==/);
  assert.match(text, /== Reports ==/);
  assert.match(text, /== Challenge ==/);
  assert.match(text, /== League ==/);
  assert.match(text, /account active \| presence offline/);
  assert.doesNotMatch(text, / \| active \| created/);
  assert.match(text, /target: 5000 CP/);
  assert.match(text, /CP earning: off/);
  assert.match(text, /leaderboard: empty/);
  assert.match(text, /\[redacted\]/);
  assert.doesNotMatch(text, /hidden@example\.com/);
  assert.doesNotMatch(text, /game_secrets|engine_state|legalMoves|myHand|password|SERVICE_ROLE/);
}

{
  const client = {
    async rpc(name) {
      if (name === "admin_get_overview") {
        return { data: { total_active_accounts: 4, global_online_user_count: null }, error: null };
      }
      if (name === "admin_list_users") return { data: { users: [], total: 0 }, error: null };
      if (name === "admin_list_live_matches") return { data: { matches: [], total: 0 }, error: null };
      if (name === "admin_list_top_rp") return { data: { players: [], total: 0 }, error: null };
      if (name === "admin_list_reports") return { data: { items: [], total: 0 }, error: null };
      if (name === "admin_get_challenge") {
        return { data: { status: "coming_soon", cp_earning_enabled: true, qualification_cp: 5000 }, error: null };
      }
      if (name === "admin_get_league") return { data: { status: "coming_soon", season_days: 60, leaderboard: [] }, error: null };
      return { data: {}, error: null };
    },
  };
  const text = await fetchAdminClipboardReport({ role: "owner" }, client);
  assert.match(text, /Staff role: owner/);
  assert.match(text, /CP earning: off/);
  assert.doesNotMatch(text, /email|phone|game_secrets/);
}

console.log("  ✓ admin v1 remaining client contract");
