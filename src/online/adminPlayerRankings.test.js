/**
 * Admin player ranking boards: LeoPips, Level, XP. Global RP has been
 * removed — rankings never read player_global_ratings/match_rp_results.
 * Run: node src/online/adminPlayerRankings.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  ADMIN_RANKING_MODES,
  assignRankingRanks,
  comparePlayerRankings,
  fetchAdminPlayerRankingUniverse,
  normalizeAdminRankingPage,
  paginateRankings,
  rankingPlayerAsUser,
  searchPlayerRankings,
  sortPlayerRankings,
} from "./adminPlayerRankings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/adminPlayerRankings.js"), "utf8");
const page = readFileSync(join(root, "src/pages/AdminPage.jsx"), "utf8");
const nav = readFileSync(join(root, "src/online/adminV1.js"), "utf8");
const en = readFileSync(join(root, "src/i18n/locales/en.js"), "utf8");

function player(extras) {
  return {
    playerId: extras.playerId,
    displayName: extras.displayName || extras.username,
    username: extras.username,
    level: extras.level ?? null,
    xp: extras.xp ?? null,
    qualifyingWins: extras.qualifyingWins ?? 0,
    leopipsBalance: extras.leopipsBalance ?? null,
  };
}

{
  assert.deepEqual([...ADMIN_RANKING_MODES], ["leopips", "level", "xp"]);
  console.log("  ✓ ranking modes are independent LeoPips / Level / XP boards");
}

{
  const ranked = sortPlayerRankings(
    [
      player({ playerId: "low", username: "zeta", leopipsBalance: 1165, level: 9, xp: 900 }),
      player({ playerId: "high", username: "alpha", leopipsBalance: 1290, level: 1, xp: 1 }),
      player({ playerId: "mid", username: "beta", leopipsBalance: 1165, level: 2, xp: 2 }),
    ],
    "leopips"
  );
  assert.deepEqual(
    ranked.map((row) => row.playerId),
    ["high", "low", "mid"]
  );
  assert.equal(comparePlayerRankings(ranked[0], ranked[1], "leopips") < 0, true);
  console.log("  ✓ LeoPips board sorts by wallet balance; ties fall to level");
}

{
  const ranked = assignRankingRanks(
    [
      player({ playerId: "a", username: "ann", level: 2, xp: 10, leopipsBalance: 100 }),
      player({ playerId: "b", username: "bob", level: 4, xp: 1, leopipsBalance: 9000 }),
      player({ playerId: "c", username: "cam", level: null, xp: null, leopipsBalance: 50 }),
    ],
    "level"
  );
  assert.equal(ranked[0].playerId, "b");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].playerId, "a");
  assert.equal(ranked[2].playerId, "c");
  assert.equal(ranked[2].rank, null);
  const tied = assignRankingRanks(
    [
      player({ playerId: "low-xp", username: "zeta", level: 3, xp: 10, leopipsBalance: 500 }),
      player({ playerId: "high-xp", username: "alpha", level: 3, xp: 40, leopipsBalance: 500 }),
    ],
    "level"
  );
  assert.equal(tied[0].playerId, "high-xp");
  assert.equal(tied[1].playerId, "low-xp");
  console.log("  ✓ Level board sorts by Level; equal LeoPips falls through to XP tie-break; NULL Level is unranked");
}

{
  const ranked = assignRankingRanks(
    [
      player({ playerId: "a", username: "ann", xp: 10, leopipsBalance: 9000 }),
      player({ playerId: "b", username: "bob", xp: 40, leopipsBalance: 1 }),
      player({ playerId: "c", username: "cam", xp: null, leopipsBalance: 1 }),
    ],
    "xp"
  );
  assert.equal(ranked[0].playerId, "b");
  assert.equal(ranked[1].playerId, "a");
  assert.equal(ranked[2].rank, null);
  console.log("  ✓ XP board sorts by XP; NULL XP is unranked");
}

{
  const ranked = assignRankingRanks(
    [
      player({ playerId: "b", username: "bob", leopipsBalance: 100, level: 3, xp: 5, qualifyingWins: 5 }),
      player({ playerId: "a", username: "ann", leopipsBalance: 100, level: 3, xp: 5, qualifyingWins: 5 }),
    ],
    "leopips"
  );
  assert.equal(ranked[0].playerId, "a");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].playerId, "b");
  console.log("  ✓ equal LeoPips + equal level/xp/qualifying wins ties break on username");
}

{
  // Hosted RPC returns its own pagination order; client must re-rank by LeoPips.
  const hostedOrder = [
    player({ playerId: "w40", username: "alpha", leopipsBalance: 1165 }),
    player({ playerId: "w30", username: "bravo", leopipsBalance: 1160 }),
    player({ playerId: "w20", username: "charlie", leopipsBalance: 1020 }),
    player({
      playerId: "biggysolo",
      username: "biggysolo",
      displayName: "BIGGYSOLO",
      leopipsBalance: 1290,
    }),
  ];
  const ranked = assignRankingRanks(hostedOrder, "leopips");
  assert.deepEqual(
    ranked.map((row) => row.leopipsBalance),
    [1290, 1165, 1160, 1020]
  );
  assert.equal(ranked[0].username, "biggysolo");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  const paged = paginateRankings(hostedOrder, { limit: 10, offset: 0, mode: "leopips" });
  assert.equal(paged.players[0].username, "biggysolo");
  assert.equal(paged.players[0].rank, 1);
  console.log("  ✓ BIGGYSOLO 1290 ranks #1 above 1165/1160/1020 regardless of hosted order");
}

{
  const tiedBalance = assignRankingRanks(
    [
      player({ playerId: "low-level", username: "zeta", leopipsBalance: 500, level: 1, xp: 1, qualifyingWins: 1 }),
      player({ playerId: "high-level", username: "alpha", leopipsBalance: 500, level: 9, xp: 1, qualifyingWins: 1 }),
    ],
    "leopips"
  );
  assert.equal(tiedBalance[0].playerId, "high-level");
  assert.equal(tiedBalance[1].playerId, "low-level");
  console.log("  ✓ equal LeoPips ties break on level DESC, then xp/qualifying wins/name");
}

{
  const rows = [
    player({ playerId: "1", username: "fedson", displayName: "FEDSON", leopipsBalance: 1 }),
    player({ playerId: "2", username: "jus", displayName: "Jus", leopipsBalance: 3 }),
  ];
  assert.deepEqual(searchPlayerRankings(rows, "FED").map((row) => row.playerId), ["1"]);
  assert.deepEqual(searchPlayerRankings(rows, "jus").map((row) => row.playerId), ["2"]);
  console.log("  ✓ search matches username and display name");
}

{
  const many = Array.from({ length: 30 }, (_, index) =>
    player({
      playerId: `p${index}`,
      username: `u${String(index).padStart(2, "0")}`,
      leopipsBalance: 30 - index,
    })
  );
  const slice = paginateRankings(many, { limit: 10, offset: 10, mode: "leopips" });
  assert.equal(slice.total, 30);
  assert.equal(slice.players.length, 10);
  assert.equal(slice.players[0].rank, 11);
  assert.equal(slice.players[0].leopipsBalance, 20);
  console.log("  ✓ pagination keeps global LeoPips rank");
}

{
  const user = rankingPlayerAsUser({
    playerId: "x",
    displayName: "X",
    username: "x",
    leopipsBalance: 50,
    level: 2,
    xp: 20,
    qualifyingWins: 3,
  });
  assert.equal(user.leopipsBalance, 50);
  assert.equal("wins" in user, false);
  assert.equal("losses" in user, false);
  assert.equal("rp" in user, false);
  const broken = normalizeAdminRankingPage({
    players: [null, { email: "hidden@example.com" }, { player_id: "ok", leopips_balance: 80 }],
  });
  assert.equal(broken.players[0].leopipsBalance, 80);
  assert.equal(Object.hasOwn(broken.players[0], "email"), false);
  assert.equal(Object.hasOwn(broken.players[0], "rp"), false);
  assert.equal(Object.hasOwn(broken.players[0], "wins"), false);
  console.log("  ✓ empty/null stats do not crash and hide secrets");
}

{
  const rpcCalls = [];
  const client = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "admin_list_player_rankings");
      assert.equal("p_ruleset_id" in args, false, "ruleset filter has been removed");
      if (args.p_offset === 0) {
        return Promise.resolve({
          data: {
            players: [
              { player_id: "low-balance", display_name: "Low", username: "low", leopips_balance: 100 },
              { player_id: "rich", display_name: "Rich", username: "rich", leopips_balance: 2000 },
            ],
            total: 2,
            limit: 50,
            offset: 0,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { players: [], total: 2, limit: 50, offset: args.p_offset }, error: null });
    },
  };
  const universe = await fetchAdminPlayerRankingUniverse({}, client);
  const ranked = assignRankingRanks(universe.players, "leopips");
  assert.equal(ranked[0].playerId, "rich");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].playerId, "low-balance");
  assert.equal(universe.levelXpAvailable, false);
  assert.ok(rpcCalls.length >= 1);
  console.log("  ✓ universe fetch ignores hosted pagination order and ranks by LeoPips");
}

{
  const normalized = normalizeAdminRankingPage({
    players: [
      {
        player_id: "x",
        username: "x",
        leopips_balance: 50,
        rank: 1,
        level: null,
        xp: null,
      },
    ],
    total: 1,
    level_xp_available: false,
  });
  assert.equal(normalized.players[0].rank, null, "hosted rank is stripped");
  assert.equal(normalized.levelXpAvailable, false);
  console.log("  ✓ normalize strips hosted rank; level/xp availability still parsed");
}

{
  assert.match(source, /admin_list_player_rankings/);
  assert.match(source, /fetchAdminPlayerRankingUniverse/);
  assert.match(source, /ADMIN_RANKING_MODES/);
  assert.match(source, /leopipsBalance/);
  assert.doesNotMatch(source, /player_global_ratings|match_rp_results|admin_list_top_rp|admin_list_player_rp_history/);
  assert.doesNotMatch(source, /ADMIN_RANKING_STYLES|rankingRulesetId|adminWinRatePercent|styleBreakdownFromRecent/);
  assert.match(page, /data-admin-ranking-mode/);
  assert.match(page, /fetchAdminPlayerRankingUniverse/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /ADMIN_PRESENCE_POLL_MS/);
  assert.match(page, /setRankingMode/);
  assert.match(page, /rankingLevelXpInactive|data-admin-ranking-level-xp-inactive/);
  assert.doesNotMatch(page, /data-admin-ranking-style/);
  assert.doesNotMatch(page, /setRankingStyle\(|rankingStyle,\s*setRankingStyle/);
  assert.match(nav, /"playerRankings"/);
  assert.match(en, /wallet balance/);
  assert.match(en, /rankingLevelXpInactive/);
  assert.match(en, /player_progression|LVL 0/);
  console.log("  ✓ dashboard uses client LeoPips/Level/XP boards, Global RP fully removed");
}

console.log("  ✓ admin player rankings");
