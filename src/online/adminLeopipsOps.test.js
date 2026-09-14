/**
 * Admin LeoPips presentation helpers. No network.
 * Run: node src/online/adminLeopipsOps.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_BLOCKED_READ_RPCS,
  ADMIN_OVERVIEW_DRILL,
  adminExpectedPot,
  adminMatchEconomyKind,
  adminOccupancyKind,
  adminStakeLabel,
  flattenLiveMatchPlayers,
  hasAdminMutationControls,
  looksLikeAdminMatchId,
  referralProgressLabel,
  toStoredAdminStake,
  userPassesAdminDirectoryFilter,
} from "./adminLeopipsOps.js";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pages", "AdminPage.jsx"), "utf8");
const panels = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pages", "AdminLeopipsPanels.jsx"), "utf8");

assert.equal(toStoredAdminStake(20), 20);
assert.equal(toStoredAdminStake(null), null);
assert.equal(toStoredAdminStake(25), null);
assert.equal(adminStakeLabel(null), null);
assert.equal(adminStakeLabel(50), "50");
assert.equal(adminExpectedPot(20), 40);
assert.equal(adminExpectedPot(null), null);

assert.equal(adminMatchEconomyKind({ matchKind: "friend", stakePips: 20 }), "friend");
assert.equal(adminMatchEconomyKind({ matchKind: "public", stakePips: 20 }), "leopips_public");
assert.equal(adminMatchEconomyKind({ matchKind: "public", stakePips: null }), "public_unstaked");
assert.equal(adminMatchEconomyKind({ matchKind: "private" }), "private");

assert.equal(adminOccupancyKind({ adminStatus: "live", playerA: { stale: false }, playerB: { stale: false } }), "real");
assert.equal(adminOccupancyKind({ adminStatus: "disconnected", playerA: { stale: true }, playerB: { stale: false } }), "stale");

assert.equal(referralProgressLabel(0), "0 / 3");
assert.equal(referralProgressLabel(1), "1 / 3");
assert.equal(referralProgressLabel(2), "2 / 3");
assert.equal(referralProgressLabel(3), "3 / 3");
assert.equal(referralProgressLabel(9), "3 / 3");

const now = Date.parse("2026-09-03T18:00:00.000Z");
assert.equal(
  userPassesAdminDirectoryFilter({ createdAt: "2026-09-03T12:00:00.000Z" }, "newToday", now),
  true
);
assert.equal(
  userPassesAdminDirectoryFilter({ createdAt: "2026-09-02T12:00:00.000Z" }, "newToday", now),
  false
);
assert.equal(userPassesAdminDirectoryFilter({ deletedAt: "2026-09-01T00:00:00.000Z" }, "deleted", now), true);

const players = flattenLiveMatchPlayers([
  {
    matchId: "m1",
    rulesetId: "classic",
    stakePips: 20,
    matchKind: "public",
    adminStatus: "live",
    createdAt: "2026-09-03T16:00:00.000Z",
    playerA: { playerId: "a", displayName: "Ada", username: "ada", lastSeenAt: "x", stale: false },
    playerB: { playerId: "b", displayName: "Bea", username: "bea", lastSeenAt: "y", stale: false },
  },
]);
assert.equal(players.length, 2);
assert.equal(players[0].opponentName, "Bea");
assert.equal(players[0].stakePips, 20);

assert.equal(ADMIN_OVERVIEW_DRILL.activeMatches.section, "liveMatches");
assert.equal(ADMIN_OVERVIEW_DRILL.newToday.usersFilter, "newToday");
assert.equal(ADMIN_OVERVIEW_DRILL.deletedAccounts.usersFilter, "deleted");
assert.equal(ADMIN_BLOCKED_READ_RPCS.matchHistory, "admin_list_matches");
assert.equal(looksLikeAdminMatchId("11111111-1111-4111-8111-111111111111"), true);
assert.equal(looksLikeAdminMatchId("ada"), false);

assert.equal(hasAdminMutationControls(page), false);
assert.equal(hasAdminMutationControls(panels), false);
assert.match(page, /data-admin-card-open=/);
assert.match(panels, /data-admin-match-history="true"/);
assert.match(panels, /data-admin-leopips-ops="true"/);
assert.doesNotMatch(page, /_leopips_credit|_leopips_debit|admin_credit|admin_debit/);
assert.doesNotMatch(panels, /\.from\(|SERVICE_ROLE/);

console.log("  ✓ Admin LeoPips ops presentation");
