/**
 * Temporary Find Match diag — read-only capture helpers.
 * Run: node src/online/findMatchDiag.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIND_MATCH_DIAG_VERSION,
  assertFindMatchDiagSafe,
  buildFindMatchDiagSnapshot,
  exportFindMatchDiag,
  noteFindMatchDiagTitleTap,
  serializeFindMatchDiag,
} from "./findMatchDiag.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

{
  let s = noteFindMatchDiagTitleTap(null, 1000);
  assert.equal(s.count, 1);
  assert.equal(s.armed, false);
  s = noteFindMatchDiagTitleTap(s, 1200);
  s = noteFindMatchDiagTitleTap(s, 1400);
  s = noteFindMatchDiagTitleTap(s, 1600);
  s = noteFindMatchDiagTitleTap(s, 1800);
  assert.equal(s.count, 5);
  assert.equal(s.armed, true);
  const reset = noteFindMatchDiagTitleTap(s, 5000);
  assert.equal(reset.count, 1);
  assert.equal(reset.armed, false);
}

{
  const snapshot = await buildFindMatchDiagSnapshot(
    {
      playerId: "player-a",
      displayName: "pozinx",
      styleId: "haitian",
      lockedStakePips: 150,
      lobbyKey: "haitian-150",
      boardSource: "lobby-rpc",
      uiState: "list",
      lastRefreshReason: "realtime",
      visibilityState: "visible",
      online: true,
      own: {
        id: "own-1",
        creatorId: "player-a",
        status: "open",
        rulesetId: "haitian",
        stakePips: 150,
        visibility: "public",
        waitingHeartbeatAt: "2026-09-05T10:00:00.000Z",
        expiresAt: "2026-09-05T10:10:00.000Z",
        creator: { displayName: "pozinx" },
      },
      mergedBoard: [
        {
          id: "own-1",
          creatorId: "player-a",
          status: "open",
          rulesetId: "haitian",
          stakePips: 150,
          visibility: "public",
          waitingHeartbeatAt: "2026-09-05T10:00:00.000Z",
        },
        {
          id: "peer-1",
          creatorId: "player-b",
          status: "open",
          rulesetId: "haitian",
          stakePips: 150,
          visibility: "public",
          waitingHeartbeatAt: "2026-09-05T10:00:01.000Z",
          creator: { displayName: "petion" },
        },
      ],
      renderedRequestIds: ["own-1", "peer-1"],
    },
    {
      now: Date.parse("2026-09-05T10:00:05.000Z"),
      listJoinable: async () => [
        {
          id: "peer-1",
          creatorId: "player-b",
          status: "open",
          rulesetId: "haitian",
          stakePips: 150,
          visibility: "public",
          waitingHeartbeatAt: "2026-09-05T10:00:01.000Z",
          creator: { displayName: "petion" },
        },
      ],
      readBlocked: async () => ({ ok: true, reason: null, ids: [] }),
      getMyActiveMatch: async () => null,
    }
  );

  assert.equal(snapshot.version, FIND_MATCH_DIAG_VERSION);
  assert.equal(snapshot.ruleset_id, "haitian");
  assert.equal(snapshot.lockedStakePips, 150);
  assert.equal(snapshot.lobby_key, "haitian-150");
  assert.equal(snapshot.boardSource, "lobby-rpc");
  assert.equal(snapshot.own_request_id, "own-1");
  assert.equal(snapshot.own_heartbeat_age_sec, 5);
  assert.deepEqual(snapshot.raw_list_joinable_ids, ["peer-1"]);
  assert.deepEqual(snapshot.merged_board_ids, ["own-1", "peer-1"]);
  assert.deepEqual(snapshot.rendered_request_ids, ["own-1", "peer-1"]);
  assert.equal(snapshot.pair_limit_for_peers[0].creator_id, "player-b");
  assert.equal(snapshot.pair_limit_for_peers[0].blocked_for_caller, false);
  assert.equal(snapshot.caller_occupancy.match, null);
  assert.equal(snapshot.last_refresh_reason, "realtime");
  assertFindMatchDiagSafe(snapshot);
  assert.match(serializeFindMatchDiag(snapshot), /find_match_lobby/);
}

{
  const unsafe = {
    diag: "find_match_lobby",
    access_token: "secret",
  };
  assert.throws(() => assertFindMatchDiagSafe(unsafe), /find_match_diag_unsafe/);
}

{
  const copied = [];
  const result = await exportFindMatchDiag(
    {
      diag: "find_match_lobby",
      version: 1,
      player_id: "player-a",
      display_name: "pozinx",
    },
    {
      copyText: async (text) => {
        copied.push(text);
        return true;
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.method, "clipboard");
  assert.match(copied[0], /"player_id": "player-a"/);
  assert.doesNotMatch(copied[0], /access_token|password|email/i);
}

{
  const page = read("pages/FindMatchPage.jsx");
  const css = read("pages/FindMatchPage.css");
  assert.match(page, /findMatchDiag/, "Find Match wires temporary diag");
  assert.match(page, /noteFindMatchDiagTitleTap/, "hidden title-tap gesture");
  assert.match(page, /buildFindMatchDiagSnapshot/);
  assert.match(page, /exportFindMatchDiag/);
  assert.match(page, /lastRefreshReasonRef/, "tracks refresh/realtime reason");
  assert.match(page, /data-find-match-diag/, "diag affordance is marked");
  assert.doesNotMatch(page, /access_token|refresh_token|service_role/);
  // Diag must not alter create/accept/cancel paths.
  assert.match(page, /createMatchRequest/);
  assert.match(page, /acceptMatchRequest/);
  assert.match(page, /cancelMatchRequest/);
  assert.doesNotMatch(page, /ranked_find_match_pair_limit_reached\(/);
  assert.match(css, /find-match__diag/, "minimal diag status styling");
}

{
  const diag = read("online/findMatchDiag.js");
  assert.match(diag, /list_ranked_find_match_blocked_opponents/);
  assert.match(diag, /listJoinableOpenMatchRequests/);
  assert.match(diag, /getMyActiveMatch/);
  assert.doesNotMatch(diag, /createMatchRequest|acceptMatchRequest|cancelMatchRequest/);
  assert.doesNotMatch(diag, /debit|payout|settle/i);
  assert.doesNotMatch(diag, /PUBLIC_REQUEST_HEARTBEAT_MS\s*=/);
}

console.log("findMatchDiag.test.js: PASS");
