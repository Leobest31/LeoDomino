/**
 * Both seats see the same forfeit terminal outcome; RP display is ledger-shaped.
 * Run: node src/online/forfeitRp.sync.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOnlineForfeit,
  dealOnlineGame,
  isForfeitView,
  PLAYER_A_SEAT,
  PLAYER_B_SEAT,
  projectGameView,
} from "./gameAuthority.js";
import {
  applyForfeitTerminalFields,
  isMatchOverView,
  occupancyTouchMissed,
} from "./onlineTable.js";
import { matchRpDisplayFromResult, normalizeMatchRpResult } from "./globalRp.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
const onlinePage = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 42,
  });
  const forfeited = applyOnlineForfeit(state, PLAYER_A_SEAT);
  const viewA = projectGameView(forfeited.state, {
    matchId: "m1",
    viewerSeat: PLAYER_A_SEAT,
    version: 1,
  });
  const viewB = projectGameView(forfeited.state, {
    matchId: "m1",
    viewerSeat: PLAYER_B_SEAT,
    version: 1,
  });
  assert.equal(viewA.matchWinnerSeat, PLAYER_B_SEAT);
  assert.equal(viewB.matchWinnerSeat, PLAYER_B_SEAT);
  assert.equal(isForfeitView(viewA), true);
  assert.equal(isForfeitView(viewB), true);
  assert.equal(isMatchOverView(viewA), true);
  assert.equal(isMatchOverView(viewB), true);
  assert.equal(viewA.roundResult.reason, viewB.roundResult.reason);
}

{
  const ratedLoser = normalizeMatchRpResult({
    settled: true,
    rated: true,
    old_rp: 1000,
    new_rp: 984,
    delta: -16,
    finish_reason: "forfeit",
  });
  const ratedWinner = normalizeMatchRpResult({
    settled: true,
    rated: true,
    old_rp: 1000,
    new_rp: 1016,
    delta: 16,
    finish_reason: "forfeit",
  });
  assert.equal(matchRpDisplayFromResult(ratedLoser).kind, "rated");
  assert.equal(matchRpDisplayFromResult(ratedLoser).delta, -16);
  assert.equal(matchRpDisplayFromResult(ratedWinner).kind, "rated");
  assert.equal(matchRpDisplayFromResult(ratedWinner).delta, 16);

  const unrated = normalizeMatchRpResult({
    settled: true,
    rated: false,
    old_rp: 1180,
    new_rp: 1180,
    delta: 0,
    finish_reason: "forfeit",
  });
  assert.equal(matchRpDisplayFromResult(unrated).kind, "unrated");
}

{
  const live = {
    matchId: "m1",
    phase: "playing",
    status: "playing",
    viewerSeat: 1,
    matchWinnerSeat: null,
  };
  const patched = applyForfeitTerminalFields(live, { winnerSeat: 0, forfeitSeat: 1 });
  assert.equal(patched.matchWinnerSeat, 0, "seat 0 winner is not treated as missing");
  assert.equal(occupancyTouchMissed({ touched: false }), true);
}

{
  const leave = hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {"));
  const afterSettle = leave.slice(leave.indexOf("if (!settled?.ok)"));
  assert.match(leave, /forfeitOnlineMatch\(id\)/);
  assert.match(leave, /getGameView\(id\)/);
  assert.match(leave, /applyForfeitTerminalFields/);
  assert.match(leave, /applyView\(next, \{ force: true \}\)/);
  assert.match(
    afterSettle,
    /clearOnlineSession\(\)/,
    "successful forfeit drops session restore so Home cannot resume the terminal match"
  );
  assert.match(afterSettle, /noteTerminalMatch\(id\)/);
  assert.match(hook, /occupancyTouchMissed\(result\)/);
  assert.match(hook, /force: isMatchOverView\(merged\)/);
  assert.match(hook, /force: isMatchOverView\(last\)/);
  assert.match(hook, /force: isMatchOverView\(next\)/);
  assert.match(hook, /keepAuthoritativeView/);
  assert.match(hook, /MATCH_NOT_ELIGIBLE/);
  assert.match(hook, /getGameView\(id\)/);
  assert.doesNotMatch(hook, /settle_match_global_rp/);
  assert.doesNotMatch(onlinePage, /settle_match_global_rp/);
}

{
  const abandon = onlinePage.slice(
    onlinePage.indexOf("const handleAbandonLeave"),
    onlinePage.indexOf("const tableEpochRef")
  );
  assert.doesNotMatch(abandon, /onMainMenu/, "confirming abandon does not skip the result modal");
  assert.match(onlinePage, /online\.matchLostForfeit/);
  assert.match(onlinePage, /online\.matchWonForfeit/);
  assert.match(onlinePage, /fetchSettledMatchRpResult/);
  assert.match(onlinePage, /notifyGlobalRatingRefresh/);
}

{
  assert.match(app, /canRecoverMatch/);
  assert.doesNotMatch(app, /match.status === "aborted"/);
}

console.log("  ✓ forfeit RP sync (both clients, rated/unrated display, occupancy miss)");
