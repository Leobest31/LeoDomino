/**
 * Dominican Standard ruleset — comprehensive V1 verification.
 * Run: node src/game/rulesets/dominican.test.js
 */

import assert from "node:assert/strict";
import {
  AMERICAN_RULESET_ID,
  DEFAULT_DIFFICULTY,
  DOMINICAN_MATCH_TARGET,
  DOMINICAN_OPENING_TILE_ID,
  DOMINICAN_RULESET_ID,
  END,
  HAITIAN_RULESET_ID,
  LEGACY_RULESET_ID,
  PHASE,
  ROUND_END_REASON,
  applyAiTurn,
  applyDominicanAfterRoundScoreUpdate,
  arePartners,
  calculateDominicanRoundPoints,
  chooseAiAction,
  chooseDominicanBlockedStarter,
  chooseDominicanNextRoundStarter,
  createBoard,
  createTile,
  getAvailableActions,
  getDominicanTeams,
  handPipTotal,
  indexTiles,
  isCapicua,
  isDominicanMatchWon,
  isGameStyleCompatibleWithPlayerCount,
  isKnownRulesetId,
  isPlayerCountSupported,
  listAvailableGameStyles,
  nextPlayerIndex,
  partnerSeat,
  passTurn,
  placeTile,
  playTile,
  resolveRuleset,
  startMatch,
  startNextRound,
  teamIdForSeat,
  teamPipTotal,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset as normalizeSaveRuleset,
} from "../../persistence/matchSave.js";
import {
  gameStyleFlagDataUrl,
  gameStyleFlagEmoji,
} from "../../data/gameStyles.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function dominicanMatch(overrides = {}) {
  return startMatch({
    seed: 42,
    playerCount: 4,
    playerIds: ["you", "rival", "rival-2", "rival-3"],
    rulesetId: DOMINICAN_RULESET_ID,
    ...overrides,
  });
}

/**
 * Synthetic 4p playing state for forced outcomes.
 */
function playingState({
  hands,
  boardTiles = [],
  scores = [0, 0, 0, 0],
  currentPlayer = 0,
  round = 2,
  roundStarterIndex = 0,
  consecutivePasses = 0,
} = {}) {
  const tiles = [];
  for (const hand of hands) {
    for (const id of hand) {
      const [a, b] = id.split("-").map(Number);
      tiles.push(createTile(a, b));
    }
  }
  for (const id of boardTiles) {
    const [a, b] = id.split("-").map(Number);
    tiles.push(createTile(a, b));
  }
  const byId = indexTiles(tiles);
  let board = createBoard();
  for (const id of boardTiles) {
    board = placeTile(board, byId[id], END.RIGHT);
  }
  return {
    seed: 1,
    byId,
    players: hands.map((hand, i) => ({
      id: ["you", "rival", "rival-2", "rival-3"][i],
      hand: hand.slice(),
    })),
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer,
    scores: scores.slice(),
    round,
    targetScore: DOMINICAN_MATCH_TARGET,
    rulesetId: DOMINICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses,
    roundStarterIndex,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
}

// --- Registration ---
{
  assert.equal(isKnownRulesetId("dominican"), true);
  const dominican = resolveRuleset("dominican");
  assert.equal(dominican.id, DOMINICAN_RULESET_ID);
  assert.equal(dominican.deckType, "double-six");
  assert.equal(dominican.tileCount, 28);
  assert.equal(dominican.handSize, 7);
  assert.equal(dominican.defaultTargetScore, 100);
  assert.equal(dominican.defaultTargetScore, DOMINICAN_MATCH_TARGET);
  assert.equal(dominican.drawPolicy, "none");
  assert.equal(dominican.passPolicy, "passWhenNoMove");
  assert.equal(dominican.blockedWinnerMode, "lowestTeamPips");
  assert.equal(dominican.blockedTieBreak, "noScore");
  assert.equal(dominican.round1Starter, "doubleSix");
  assert.equal(dominican.partnerships, "oppositeSeats");
  assert.equal(dominican.capicua?.enabled, false);
  assert.equal(dominican.capicua?.awardBonus, false);
  assert.equal(isCapicua(), false);
  assert.deepEqual(dominican.supportedPlayerCounts, [4]);
  assert.equal(isPlayerCountSupported(dominican, 4), true);
  assert.equal(isPlayerCountSupported(dominican, 2), false);
  assert.equal(isPlayerCountSupported(dominican, 3), false);

  const styles = listAvailableGameStyles();
  assert.ok(styles.some((s) => s.id === "dominican"));
  const style = styles.find((s) => s.id === "dominican");
  assert.equal(style.countryCode, "DO");
  assert.equal(style.rulesetId, "dominican");
  assert.ok(gameStyleFlagDataUrl(style).startsWith("data:image/svg+xml"));
  assert.equal(gameStyleFlagEmoji(style), "🇩🇴");
  assert.equal(isGameStyleCompatibleWithPlayerCount("dominican", 4), true);
  assert.equal(isGameStyleCompatibleWithPlayerCount("dominican", 2), false);
  assert.equal(isGameStyleCompatibleWithPlayerCount("dominican", 3), false);
  section("Dominican registration + 4p-only + DO flag");
}

// --- Deal / reserve empty / no-draw / pass ---
{
  const state = dominicanMatch({ seed: 11 });
  assert.equal(state.rulesetId, "dominican");
  assert.equal(state.players.length, 4);
  assert.equal(state.players.every((p) => p.hand.length === 7), true);
  assert.equal(state.reserve.length, 0);
  assert.equal(state.targetScore, 100);

  const actions = getAvailableActions(state);
  assert.equal(actions.canDraw, false);
  // Opening must play 6-6 — pass locked until opening tile is played.
  assert.equal(actions.canPass, false);
  assert.equal(actions.canPlay, true);

  assert.throws(
    () =>
      startMatch({
        seed: 2,
        playerCount: 2,
        playerIds: ["a", "b"],
        rulesetId: "dominican",
      }),
    /does not support 2-player/
  );
  assert.throws(
    () =>
      startMatch({
        seed: 3,
        playerCount: 3,
        playerIds: ["a", "b", "c"],
        rulesetId: "dominican",
      }),
    /does not support 3-player/
  );
  section("4p deal 7 each, reserve empty, no-draw; 2p/3p rejected");
}

// --- Opening 6-6 ---
{
  const state = dominicanMatch({ seed: 42 });
  assert.equal(state.mustPlayTileId, DOMINICAN_OPENING_TILE_ID);
  assert.equal(state.mustPlayTileId, "6-6");
  const holder = state.players[state.currentPlayer];
  assert.ok(holder.hand.includes("6-6"));
  assert.throws(
    () => playTile(state, holder.hand.find((id) => id !== "6-6")),
    /Must open/
  );
  const after = playTile(state, "6-6");
  assert.equal(after.board[0].id, "6-6");
  assert.equal(after.mustPlayTileId, null);
  assert.equal(after.roundStarterIndex, state.currentPlayer);

  // After opening, a seat with no move may pass (no draw).
  const stuck = playingState({
    hands: [["0-0"], ["1-1"], ["2-2"], ["3-3"]],
    boardTiles: ["6-6"],
    currentPlayer: 0,
    round: 1,
    roundStarterIndex: 1,
  });
  const stuckActions = getAvailableActions(stuck);
  assert.equal(stuckActions.canDraw, false);
  assert.equal(stuckActions.canPass, true);
  section("Round 1 requires 6-6 opener; later passWhenNoMove");
}

// --- Opposite partnerships ---
{
  assert.deepEqual(getDominicanTeams(), [
    [0, 1],
    [2, 3],
  ]);
  assert.equal(partnerSeat(0), 1);
  assert.equal(partnerSeat(1), 0);
  assert.equal(partnerSeat(2), 3);
  assert.equal(partnerSeat(3), 2);
  assert.equal(teamIdForSeat(0), 0);
  assert.equal(teamIdForSeat(1), 0);
  assert.equal(teamIdForSeat(2), 1);
  assert.equal(teamIdForSeat(3), 1);
  assert.equal(arePartners(0, 1), true);
  assert.equal(arePartners(2, 3), true);
  assert.equal(arePartners(0, 2), false);
  assert.equal(arePartners(0, 3), false);
  section("Opposite partnerships: 0↔1 and 2↔3");
}

// --- Later winner starts free ---
{
  let state = dominicanMatch({ seed: 55 });
  state = playTile(state, "6-6");
  const starter = state.roundStarterIndex;
  const fakeOver = {
    ...state,
    phase: PHASE.ROUND_OVER,
    roundResult: {
      reason: ROUND_END_REASON.DOMINO,
      winnerIndex: 2,
      points: 10,
      nextStarterIndex: 2,
    },
    scores: [0, 0, 10, 10],
    roundStarterIndex: starter,
  };
  const next = startNextRound(fakeOver, { seed: 902 });
  assert.equal(next.rulesetId, "dominican");
  assert.equal(next.currentPlayer, 2);
  assert.equal(next.mustPlayTileId, null);
  const opener = next.players[2].hand[0];
  const opened = playTile(next, opener);
  assert.equal(opened.board[0].id, opener);
  section("Later round: previous winner opens with any tile");
}

// --- Domino-out: team wins opposing pips; mirror scores ---
{
  // Seat 0 empties hand; opposing team seats 2+3 hold pips.
  const winState = playingState({
    hands: [["0-1"], ["6-5", "4-4"], ["2-2", "3-3"], ["1-1", "5-5"]],
    boardTiles: ["0-0"],
    currentPlayer: 0,
    scores: [10, 10, 5, 5],
    roundStarterIndex: 1,
  });
  const oppPips =
    handPipTotal(winState.players[2].hand, winState.byId) +
    handPipTotal(winState.players[3].hand, winState.byId);
  // Partner seat 1 pips must NOT be included in award.
  const partnerPips = handPipTotal(winState.players[1].hand, winState.byId);
  assert.ok(partnerPips > 0);
  assert.equal(
    calculateDominicanRoundPoints({
      winnerIndex: 0,
      players: winState.players,
      byId: winState.byId,
      reason: ROUND_END_REASON.DOMINO,
    }),
    oppPips
  );
  const after = playTile(winState, "0-1", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.winnerIndex, 0);
  assert.equal(after.roundResult.points, oppPips);
  assert.equal(after.scores[0], 10 + oppPips);
  assert.equal(after.scores[1], 10 + oppPips);
  assert.equal(after.scores[2], 5);
  assert.equal(after.scores[3], 5);
  assert.equal(after.roundResult.nextStarterIndex, 0);
  section("Domino-out: opposing team pips; scores mirrored on partners");
}

// --- Partner win still awards the team ---
{
  const state = playingState({
    hands: [["6-5", "4-4"], ["0-1"], ["2-2", "3-3"], ["1-1", "5-5"]],
    boardTiles: ["0-0"],
    currentPlayer: 1,
    scores: [0, 0, 0, 0],
    roundStarterIndex: 0,
  });
  const oppPips =
    handPipTotal(state.players[2].hand, state.byId) +
    handPipTotal(state.players[3].hand, state.byId);
  const after = playTile(state, "0-1", END.RIGHT);
  assert.equal(after.roundResult.winnerIndex, 1);
  assert.equal(after.roundResult.points, oppPips);
  assert.deepEqual(after.scores, [oppPips, oppPips, 0, 0]);
  section("Partner (seat 1) win still scores the team");
}

// --- Blocked: lower team pips wins by difference ---
{
  // Team 0 pips = (0+1)+(1+2) = 4; team 1 pips = (4+6)+(6+6) = 22; difference = 18
  const state = playingState({
    hands: [["0-1"], ["1-2"], ["4-6"], ["6-6"]],
    boardTiles: ["3-3"],
    currentPlayer: 0,
    consecutivePasses: 3,
    roundStarterIndex: 2,
    scores: [0, 0, 0, 0],
  });
  assert.equal(teamPipTotal(0, state.players, state.byId), 4);
  assert.equal(teamPipTotal(1, state.players, state.byId), 22);
  // No legal moves on ends 3/3 with these hands → pass completes block.
  const after = passTurn(state);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.equal(after.roundResult.tied, undefined);
  assert.equal(after.roundResult.points, 18);
  // Winner is on team 0; block causer seat 0 is on winning team → starts next.
  assert.equal(teamIdForSeat(after.roundResult.winnerIndex), 0);
  assert.equal(after.roundResult.nextStarterIndex, 0);
  assert.equal(after.scores[0], 18);
  assert.equal(after.scores[1], 18);
  assert.equal(after.scores[2], 0);
  assert.equal(after.scores[3], 0);
  section("Blocked: lower team pips wins difference; causer on team starts");
}

// --- Blocked starter fallback: causer not on winning team → min seat ---
{
  assert.equal(
    chooseDominicanBlockedStarter({ winningTeamId: 0, blockCauserIndex: 2 }),
    0
  );
  assert.equal(
    chooseDominicanBlockedStarter({ winningTeamId: 1, blockCauserIndex: 1 }),
    2
  );
  assert.equal(
    chooseDominicanBlockedStarter({ winningTeamId: 1, blockCauserIndex: 3 }),
    3
  );
  section("Blocked starter: causer if on team else lowest seat");
}

// --- Dominican blocked golden outcomes (regression lock for shared engine path) ---
{
  // Causer on losing team → starter falls back to lowest seat on winning team.
  // Team 0 = 4 pips, team 1 = 22; passer seat 2 is NOT on winning team.
  const causerOffTeam = playingState({
    hands: [["0-1"], ["1-2"], ["4-6"], ["6-6"]],
    boardTiles: ["3-3"],
    currentPlayer: 2,
    consecutivePasses: 3,
    roundStarterIndex: 1,
    scores: [5, 5, 0, 0],
  });
  const afterOff = passTurn(causerOffTeam);
  assert.equal(afterOff.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.equal(afterOff.roundResult.tied, undefined);
  // Difference scoring (22 - 4 = 18), NOT opposing total alone.
  assert.equal(afterOff.roundResult.points, 18);
  assert.notEqual(afterOff.roundResult.points, 22);
  assert.equal(teamIdForSeat(afterOff.roundResult.winnerIndex), 0);
  assert.equal(afterOff.roundResult.nextStarterIndex, 0);
  assert.equal(afterOff.roundResult.winnerIndex, 0);
  assert.deepEqual(afterOff.scores, [23, 23, 0, 0]);

  // Causer on winning team but not min seat → causer still starts (Dominican-only).
  // Seat 1 passes into block; team 0 wins; starter must be causer seat 1 (not 0).
  const causerOnTeam = playingState({
    hands: [["0-1"], ["1-2"], ["4-6"], ["6-6"]],
    boardTiles: ["3-3"],
    currentPlayer: 1,
    consecutivePasses: 3,
    roundStarterIndex: 3,
    scores: [0, 0, 0, 0],
  });
  const afterOn = passTurn(causerOnTeam);
  assert.equal(afterOn.roundResult.points, 18);
  assert.equal(afterOn.roundResult.nextStarterIndex, 1);
  assert.equal(afterOn.roundResult.winnerIndex, 1);
  assert.deepEqual(afterOn.scores, [18, 18, 0, 0]);
  section("Dominican blocked golden lock: difference + causer starter semantics");
}

// --- Blocked equal-pip TIE: no score; same starter again ---
{
  // Team 0: 4+2=6; team 1: 3+3=6
  const state = playingState({
    hands: [["0-4"], ["1-1"], ["0-3"], ["1-2"]],
    boardTiles: ["6-6"],
    currentPlayer: 0,
    consecutivePasses: 3,
    roundStarterIndex: 3,
    scores: [20, 20, 8, 8],
  });
  assert.equal(teamPipTotal(0, state.players, state.byId), 6);
  assert.equal(teamPipTotal(1, state.players, state.byId), 6);
  const after = passTurn(state);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.tied, true);
  assert.equal(after.roundResult.winnerIndex, null);
  assert.equal(after.roundResult.points, 0);
  assert.equal(after.roundResult.nextStarterIndex, 3);
  assert.deepEqual(after.scores, [20, 20, 8, 8]);
  assert.equal(after.statusKey, "rules.roundTied");

  const next = startNextRound(after, { seed: 777 });
  assert.equal(next.currentPlayer, 3);
  assert.equal(next.mustPlayTileId, null);
  assert.deepEqual(next.scores, [20, 20, 8, 8]);
  assert.equal(
    chooseDominicanNextRoundStarter({
      roundResult: after.roundResult,
      roundStarterIndex: 3,
    }),
    3
  );
  section("Tied tranque: zero points; previous starter opens again");
}

// --- Score mirror helper + match 100+ ---
{
  assert.deepEqual(
    applyDominicanAfterRoundScoreUpdate({
      scores: [40, 40, 10, 10],
      winnerIndex: 2,
      points: 15,
    }),
    [40, 40, 25, 25]
  );
  assert.equal(
    isDominicanMatchWon({
      scores: [100, 100, 40, 40],
      winnerIndex: 0,
      targetScore: 100,
    }),
    true
  );
  assert.equal(
    isDominicanMatchWon({
      scores: [99, 99, 40, 40],
      winnerIndex: 0,
      targetScore: 100,
    }),
    false
  );

  const near = playingState({
    hands: [["0-1"], ["6-5"], ["2-2"], ["3-3"]],
    boardTiles: ["0-0"],
    currentPlayer: 0,
    scores: [95, 95, 10, 10],
    roundStarterIndex: 0,
  });
  const after = playTile(near, "0-1", END.RIGHT);
  assert.ok(after.scores[0] >= 100);
  assert.equal(after.scores[0], after.scores[1]);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  // Team lead seat for team 0 is 0.
  assert.equal(after.matchWinner, 0);
  section("Score mirror + first team ≥100 wins match");
}

// --- Persistence ---
{
  const state = dominicanMatch({ seed: 4242 });
  assert.equal(state.rulesetId, "dominican");
  const withScores = { ...state, scores: [30, 30, 12, 12] };
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: withScores }),
    true
  );
  assert.equal(normalizeSaveRuleset(withScores).rulesetId, "dominican");
  assert.deepEqual(normalizeSaveRuleset(withScores).scores, [30, 30, 12, 12]);
  section("Persistence: dominican rulesetId + mirrored team scores");
}

// --- CCW turn order unchanged ---
{
  assert.equal(nextPlayerIndex(0, 4), 3);
  assert.equal(nextPlayerIndex(1, 4), 2);
  assert.equal(nextPlayerIndex(2, 4), 0);
  assert.equal(nextPlayerIndex(3, 4), 1);
  let state = dominicanMatch({ seed: 77 });
  const starter = state.currentPlayer;
  state = playTile(state, "6-6");
  assert.equal(state.currentPlayer, nextPlayerIndex(starter, 4));
  section("CCW turn order unchanged under Dominican");
}

// --- AI legal under Dominican ---
{
  let state = dominicanMatch({ seed: 321 });
  const action = chooseAiAction(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.ok(action);
  assert.ok(["play", "draw", "pass"].includes(action.type));
  assert.notEqual(action.type, "draw");
  const after = applyAiTurn(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.equal(after.rulesetId, "dominican");
  section("AI completes legal Dominican turns (never draws)");
}

// --- Capicúa stub ---
{
  const ruleset = resolveRuleset("dominican");
  assert.equal(typeof ruleset.policies.isCapicua, "function");
  assert.equal(ruleset.policies.isCapicua(), false);
  assert.equal(isCapicua(), false);
  section("Capicúa architecture stub only (no bonus)");
}

// --- Haitian / American / Classic regressions ---
{
  const classic = startMatch({ seed: 12, playerIds: ["you", "rival"] });
  assert.equal(classic.rulesetId, LEGACY_RULESET_ID);
  assert.equal(classic.targetScore, 100);
  assert.equal(resolveRuleset("legacy").drawPolicy, "drawUntilPlayable");
  assert.equal(resolveRuleset("legacy").passPolicy, "passWhenReserveEmpty");
  assert.equal(resolveRuleset("legacy").blockedWinnerMode, "lowestPips");
  assert.equal(resolveRuleset("legacy").partnerships, null);

  const haitian = startMatch({
    seed: 13,
    playerIds: ["you", "rival"],
    rulesetId: HAITIAN_RULESET_ID,
  });
  assert.equal(haitian.rulesetId, "haitian");
  assert.equal(haitian.targetScore, 4);
  assert.equal(resolveRuleset("haitian").roundScoreMode, "matchPoints");
  assert.equal(resolveRuleset("haitian").drawPolicy, "drawUntilPlayable");
  assert.deepEqual(resolveRuleset("haitian").supportedPlayerCounts, [2, 4]);

  const american = startMatch({
    seed: 14,
    playerIds: ["you", "rival"],
    rulesetId: AMERICAN_RULESET_ID,
  });
  assert.equal(american.rulesetId, "american");
  assert.equal(american.targetScore, 100);
  assert.equal(resolveRuleset("american").drawPolicy, "drawUntilPlayable");
  assert.equal(resolveRuleset("american").blockedWinnerMode, "lowestPips");

  // Classic still uses individual lowest-pips blocked, not team / noScore.
  assert.notEqual(resolveRuleset("legacy").blockedTieBreak, "noScore");
  assert.notEqual(resolveRuleset("haitian").blockedWinnerMode, "lowestTeamPips");
  assert.notEqual(resolveRuleset("american").drawPolicy, "none");
  section("Haitian / American / Classic behavior unchanged regression");
}

console.log("\nDominican ruleset tests passed.");
