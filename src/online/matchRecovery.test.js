/**
 * Stale terminal-match recovery vs occupancy vs outage.
 * Run: node src/online/matchRecovery.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOnlineForfeit,
  dealOnlineGame,
  PLAYER_A_SEAT,
  PLAYER_B_SEAT,
  projectGameView,
} from "./gameAuthority.js";
import { JOIN_GRACE_MS, isResumableMatch, isTerminalMatch } from "./joinTimeout.js";
import {
  isActiveMatchLockError,
  MatchmakingError,
} from "./matchmaking.js";
import {
  canRecoverMatch,
  decideHomeSessionRecovery,
  decideMatchRecovery,
  isMissingActiveMatchRow,
  shouldDropLastKnownOnOccupancyFailure,
} from "./matchRecovery.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import {
  isNotedTerminalMatch,
  noteTerminalMatch,
  resetTerminalMatchMemory,
} from "./terminalMatchMemory.js";
import { TURN_TIMEOUT_MS } from "./turnTimeout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, "src", rel), "utf8");

const LIVE = { id: "match-live", status: "playing" };
const READY = { id: "match-ready", status: "ready" };

function memoryStorage() {
  const data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function beginCase() {
  resetTerminalMatchMemory();
}

beginCase();

{
  assert.equal(canRecoverMatch(LIVE), true, "1. active playing match is recoverable");
  assert.equal(canRecoverMatch(READY), true, "1. reserved ready match is recoverable");
  const resume = decideMatchRecovery({ occupancyUnknown: false, occupancyMatch: LIVE });
  assert.equal(resume.kind, "resume");
  assert.equal(resume.source, "occupancy");
  const home = decideHomeSessionRecovery({
    savedMatchId: LIVE.id,
    occupancyUnknown: false,
    occupancyMatch: LIVE,
  });
  assert.equal(home.enter, true);
  assert.equal(home.clearSession, false);
}

{
  beginCase();
  const completed = { id: "m-completed", status: "finished", finishReason: "completed" };
  assert.equal(isTerminalMatch(completed), true);
  assert.equal(canRecoverMatch(completed), false, "2. completed is not resumable");
  assert.equal(isNotedTerminalMatch("m-completed"), true, "2. completed is noted so stale snapshots cannot resume");
  const playingSnapshot = { id: "m-completed", status: "playing" };
  assert.equal(canRecoverMatch(playingSnapshot), false);
  const decision = decideMatchRecovery({
    occupancyUnknown: false,
    occupancyMatch: null,
    lastKnown: playingSnapshot,
    acceptedMatchId: "m-completed",
    hydratedAcceptedMatch: playingSnapshot,
  });
  assert.equal(decision.kind, "clear");
  assert.equal(decision.source, "occupancy_none");
  const session = decideHomeSessionRecovery({
    savedMatchId: "m-completed",
    occupancyUnknown: false,
    occupancyMatch: null,
  });
  assert.equal(session.enter, false);
  assert.equal(session.clearSession, true);
}

{
  beginCase();
  const forfeited = { id: "m-forfeit", status: "finished", finishReason: "forfeit" };
  assert.equal(canRecoverMatch(forfeited), false, "3. forfeited is not resumable");
  const decision = decideMatchRecovery({
    occupancyUnknown: false,
    occupancyMatch: null,
    lastKnown: { id: "m-forfeit", status: "playing" },
    acceptedMatchId: "m-forfeit",
    hydratedAcceptedMatch: { id: "m-forfeit", status: "playing" },
  });
  assert.equal(decision.kind, "clear", "3. occupancy-none does not reopen via leftover accepted request");
}

{
  beginCase();
  const joinTimeout = { id: "m-join", status: "aborted", finishReason: "join_timeout" };
  assert.equal(canRecoverMatch(joinTimeout), false, "4. join_timeout is not resumable");
  assert.equal(
    decideMatchRecovery({ occupancyUnknown: false, occupancyMatch: joinTimeout }).kind,
    "clear"
  );
}

{
  beginCase();
  const aborted = { id: "m-abort", status: "aborted", finishReason: "aborted" };
  assert.equal(canRecoverMatch(aborted), false, "5. aborted is not resumable");
}

{
  beginCase();
  const turnTimeout = { id: "m-timeout", status: "finished", finishReason: "timeout" };
  assert.equal(isTerminalMatch(turnTimeout), true);
  assert.equal(canRecoverMatch(turnTimeout), false, "6. turn-timeout terminal is not resumable");
  assert.equal(canRecoverMatch({ id: "m-timeout", status: "playing", finish_reason: "timeout" }), false);
}

{
  beginCase();
  const staleOccupancy = { id: "m-stale", status: "aborted", finishReason: "aborted" };
  assert.equal(canRecoverMatch(staleOccupancy), false, "7. stale occupancy abort is not resumable");
  const occupancyGone = decideMatchRecovery({
    occupancyUnknown: false,
    occupancyMatch: null,
    lastKnown: { id: "m-stale", status: "playing" },
    acceptedMatchId: "m-stale",
    hydratedAcceptedMatch: { id: "m-stale", status: "playing" },
  });
  assert.equal(occupancyGone.kind, "clear", "7. leftover accepted request cannot resurrect occupancy-cleared match");
}

{
  beginCase();
  const afterTerminal = decideMatchRecovery({
    occupancyUnknown: false,
    occupancyMatch: null,
    lastKnown: { id: "m-old", status: "playing" },
    acceptedMatchId: "m-old",
    hydratedAcceptedMatch: { id: "m-old", status: "playing" },
  });
  assert.equal(afterTerminal.kind, "clear", "8. after terminal occupancy, Find Match is not Match Ready");
  assert.equal(afterTerminal.match, null);
  assert.equal(isNotedTerminalMatch("m-old"), false, "8. occupancy-none does not invent a terminal note");
  assert.equal(
    isActiveMatchLockError(new MatchmakingError("PLAYER_BUSY")),
    true,
    "8/10. PLAYER_BUSY still blocks a genuinely active seat"
  );
}

{
  beginCase();
  noteTerminalMatch("m-old-friend");
  assert.equal(canRecoverMatch({ id: "m-old-friend", status: "playing" }), false);
  const home = decideHomeSessionRecovery({
    savedMatchId: "m-old-friend",
    occupancyUnknown: true,
    occupancyMatch: null,
  });
  assert.equal(home.enter, false, "9. noted terminal never auto-enters even during outage");
  assert.equal(home.clearSession, true);
  assert.equal(
    isActiveMatchLockError(new MatchmakingError("PLAYER_BUSY")),
    true,
    "9/10. friend accept still uses PLAYER_BUSY for a live match"
  );
}

{
  beginCase();
  const busy = decideMatchRecovery({ occupancyUnknown: false, occupancyMatch: LIVE });
  assert.equal(busy.kind, "resume", "10. genuine active match still resumes");
  assert.equal(isActiveMatchLockError(new MatchmakingError("ACTIVE_MATCH_EXISTS")), true);
}

{
  beginCase();
  const outage = decideMatchRecovery({
    occupancyUnknown: true,
    occupancyMatch: null,
    lastKnown: LIVE,
  });
  assert.equal(outage.kind, "keep", "11. outage keeps last known live match");
  assert.equal(outage.source, "outage_last_known");
  assert.equal(outage.match.id, LIVE.id);
  assert.equal(isNotedTerminalMatch(LIVE.id), false, "11. outage does not note the live match as terminal");
  const home = decideHomeSessionRecovery({
    savedMatchId: LIVE.id,
    occupancyUnknown: true,
    occupancyMatch: null,
  });
  assert.equal(home.enter, false, "11. outage does not auto-enter");
  assert.equal(home.clearSession, false, "11. outage preserves stored recovery id");
  assert.equal(shouldDropLastKnownOnOccupancyFailure(LIVE), false);
}

{
  beginCase();
  const gone = decideHomeSessionRecovery({
    savedMatchId: "stale-local-id",
    occupancyUnknown: false,
    occupancyMatch: null,
  });
  assert.equal(gone.clearSession, true, "12. authoritative empty occupancy clears stale stored id");
  assert.equal(gone.enter, false);
  const unknown = decideHomeSessionRecovery({
    savedMatchId: "stale-local-id",
    occupancyUnknown: true,
    occupancyMatch: null,
  });
  assert.equal(unknown.clearSession, false, "12. unknown/outage does not destroy stored id");
  assert.equal(isMissingActiveMatchRow({ code: "PGRST116", message: "JSON object requested, 0 rows" }), true);
  assert.equal(
    isMissingActiveMatchRow({ code: "MATCH_FAILED", cause: { status: 521, message: "Web server is down" } }),
    false,
    "12. 521 is not a missing row"
  );
  assert.equal(isInfrastructureOutageError({ status: 521, message: "Web server is down" }), true);
}

{
  beginCase();
  noteTerminalMatch("m-left");
  assert.equal(canRecoverMatch({ id: "m-left", status: "playing" }), false, "13. leaving player cannot recover the old match");
  assert.equal(shouldDropLastKnownOnOccupancyFailure({ id: "m-left", status: "playing" }), true);
  const find = decideMatchRecovery({
    occupancyUnknown: true,
    lastKnown: { id: "m-left", status: "playing" },
  });
  assert.equal(find.kind, "clear", "13. outage cannot resurrect a noted forfeit/leave");
}

{
  beginCase();
  const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 42,
  });
  const forfeited = applyOnlineForfeit(state, PLAYER_A_SEAT);
  const viewB = projectGameView(forfeited.state, { viewerSeat: PLAYER_B_SEAT, playerId: PLAYER_B });
  assert.equal(viewB.matchWinnerSeat, PLAYER_B_SEAT, "14. opponent remains winner after forfeit");
  assert.equal(viewB.phase, "matchOver");
}

{
  const sql = readFileSync(join(root, "supabase/migrations/20260827220000_global_rp.sql"), "utf8");
  assert.match(sql, /rp integer NOT NULL DEFAULT 1000 CHECK \(rp >= 0\)/, "15. starting RP 1000 / floor 0 contract unchanged");
  assert.match(sql, /1000 beats 1000 => 1016 \/ 984/, "15. Global RP vector unchanged");
  assert.match(sql, /GREATEST\(0, winner_old \+ winner_delta\)/, "15. RP floor unchanged");
  assert.match(sql, /k integer NOT NULL DEFAULT 32/, "15. K=32 unchanged");
}

{
  const globalSql = readFileSync(join(root, "supabase/migrations/20260827220000_global_rp.sql"), "utf8");
  assert.match(globalSql, /Unrated friend matches store rated=false/, "16. friend matches remain unrated");
  assert.match(
    globalSql,
    /COALESCE\(request\.visibility, 'public'\) = 'friend'/,
    "16. friend invite / Play With a Friend is unrated"
  );
}

{
  assert.equal(TURN_TIMEOUT_MS, 60_000, "17. 60-second turn timeout unchanged");
  assert.equal(JOIN_GRACE_MS, 3 * 60 * 1000, "18. 3-minute join timeout unchanged");
}

{
  beginCase();
  const storage = memoryStorage();
  noteTerminalMatch("persisted-1", storage);
  assert.equal(isNotedTerminalMatch("persisted-1", storage), true);
  assert.equal(isResumableMatch({ id: "persisted-1", status: "playing" }), true, "structural isResumableMatch stays pure");
}

{
  const findMatch = read("pages/FindMatchPage.jsx");
  const app = read("App.jsx");
  const hook = read("hooks/useActiveOnlineMatch.js");
  const matchHook = read("hooks/useOnlineMatch.js");
  const home = read("pages/HomePage.jsx");
  const invites = read("hooks/useFriendMatchInvites.js");
  const matchmaking = read("online/matchmaking.js");

  assert.match(findMatch, /decideMatchRecovery/);
  assert.match(findMatch, /occupancyUnknown/);
  assert.match(findMatch, /nextOwn\?\.status === ["']accepted["']/);
  assert.match(findMatch, /canRecoverMatch/);
  assert.doesNotMatch(
    findMatch,
    /getMyActiveMatch\(\)\.catch\(\(\) => matchedRef\.current\)/,
    "Find Match must not treat occupancy errors as a live matched snapshot"
  );

  assert.match(app, /decideHomeSessionRecovery/);
  assert.match(app, /occupancyUnknown: true/);
  assert.match(app, /canRecoverMatch/);
  assert.match(app, /isNotedTerminalMatch\(saved\.matchId\)/);

  assert.match(hook, /canRecoverMatch/);
  assert.match(hook, /shouldDropLastKnownOnOccupancyFailure/);
  assert.match(hook, /keep last known occupancy unless it is already terminal/);
  assert.match(hook, /Do not invent a cancellation of a live match/);

  assert.match(matchHook, /noteTerminalMatch\(kept\.matchId\)/);
  assert.match(matchHook, /noteTerminalMatch\(id\)/);
  assert.match(matchHook, /clearOnlineSession\(\)/);

  assert.match(home, /canRecoverMatch\(activeOnlineMatch\)/);
  assert.match(invites, /canRecoverMatch\(match\)/);
  assert.match(matchmaking, /isMissingActiveMatchRow/);
  assert.match(matchmaking, /isImmediateInfrastructureOutage\(error\)/);
  assert.doesNotMatch(matchmaking, /schema cache/i);
}

console.log("  ✓ stale terminal match recovery");
