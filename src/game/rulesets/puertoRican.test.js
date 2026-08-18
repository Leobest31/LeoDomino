/**
 * Puerto Rican Standard ruleset — V1 locked-rule verification.
 * Run: node src/game/rulesets/puertoRican.test.js
 */

import assert from "node:assert/strict";
import {
  AMERICAN_RULESET_ID,
  DEFAULT_DIFFICULTY,
  DOMINICAN_RULESET_ID,
  END,
  HAITIAN_RULESET_ID,
  LEGACY_RULESET_ID,
  PHASE,
  PUERTO_RICAN_MATCH_TARGET,
  PUERTO_RICAN_OPENING_TILE_ID,
  PUERTO_RICAN_RULESET_ID,
  ROUND_END_REASON,
  applyAiTurn,
  applyPuertoRicanAfterRoundScoreUpdate,
  calculatePuertoRicanRoundPoints,
  chooseAiAction,
  choosePuertoRicanBlockedStarter,
  choosePuertoRicanNextRoundStarter,
  createBoard,
  createTile,
  getAvailableActions,
  getPuertoRicanTeams,
  handPipTotal,
  indexTiles,
  isChuchazo,
  isGameStyleCompatibleWithPlayerCount,
  isKnownRulesetId,
  isPlayerCountSupported,
  isPuertoRicanCapicua,
  isPuertoRicanMatchWon,
  listAvailableGameStyles,
  resolveHandSize,
  nextPlayerIndex,
  placeTile,
  playTile,
  passTurn,
  puertoRicanArePartners,
  puertoRicanPartnerSeat,
  puertoRicanTeamIdForSeat,
  puertoRicanTeamPipTotal,
  resolveRuleset,
  startMatch,
  startNextRound,
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

function prMatch(overrides = {}) {
  return startMatch({
    seed: 42,
    playerCount: 4,
    playerIds: ["you", "rival", "rival-2", "rival-3"],
    rulesetId: PUERTO_RICAN_RULESET_ID,
    ...overrides,
  });
}

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
    targetScore: PUERTO_RICAN_MATCH_TARGET,
    rulesetId: PUERTO_RICAN_RULESET_ID,
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
  assert.equal(isKnownRulesetId("puertorican"), true);
  const pr = resolveRuleset("puertorican");
  assert.equal(pr.id, PUERTO_RICAN_RULESET_ID);
  assert.equal(pr.deckType, "double-six");
  assert.equal(pr.tileCount, 28);
  assert.equal(typeof pr.handSize, "function");
  assert.equal(resolveHandSize(pr, 4), 7);
  assert.equal(resolveHandSize(pr, 2), 14);
  assert.equal(pr.defaultTargetScore, 200);
  assert.equal(pr.defaultTargetScore, PUERTO_RICAN_MATCH_TARGET);
  assert.equal(pr.drawPolicy, "none");
  assert.equal(pr.passPolicy, "passWhenNoMove");
  assert.equal(pr.blockedWinnerMode, "lowestTeamPips");
  assert.equal(pr.blockedTieBreak, "noScore");
  assert.equal(pr.round1Starter, "doubleSix");
  assert.equal(pr.partnerships, "oppositeSeats");
  assert.equal(pr.capicua?.enabled, false);
  assert.equal(pr.capicua?.awardBonus, false);
  assert.equal(pr.capicua?.value, 0);
  assert.equal(pr.chuchazo?.enabled, false);
  assert.equal(pr.chuchazo?.value, 0);
  assert.equal(isPuertoRicanCapicua(), false);
  assert.equal(isChuchazo(), false);
  assert.deepEqual(pr.supportedPlayerCounts, [2, 4]);
  assert.equal(isPlayerCountSupported(pr, 4), true);
  assert.equal(isPlayerCountSupported(pr, 2), true);
  assert.equal(isPlayerCountSupported(pr, 3), false);

  const styles = listAvailableGameStyles();
  assert.ok(styles.some((s) => s.id === "puertorican"));
  const style = styles.find((s) => s.id === "puertorican");
  assert.equal(style.countryCode, "PR");
  assert.equal(style.rulesetId, "puertorican");
  assert.ok(gameStyleFlagDataUrl(style).startsWith("data:image/svg+xml"));
  assert.equal(gameStyleFlagEmoji(style), "🇵🇷");
  assert.equal(isGameStyleCompatibleWithPlayerCount("puertorican", 4), true);
  assert.equal(isGameStyleCompatibleWithPlayerCount("puertorican", 2), true);
  section("PR registration + V1 2p + 4p partnership engine + PR flag + stubs");
}

// --- Deal / no draw ---
{
  const state = prMatch({ seed: 11 });
  assert.equal(state.rulesetId, "puertorican");
  assert.equal(state.players.length, 4);
  assert.equal(state.players.every((p) => p.hand.length === 7), true);
  assert.equal(state.reserve.length, 0);
  assert.equal(state.targetScore, 200);
  const actions = getAvailableActions(state);
  assert.equal(actions.canDraw, false);
  assert.equal(actions.canPass, false);
  assert.equal(actions.canPlay, true);
  const two = startMatch({
    seed: 2,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "puertorican",
  });
  assert.equal(two.players.length, 2);
  assert.equal(two.players.every((p) => p.hand.length === 14), true);
  assert.equal(two.reserve.length, 0);
  assert.equal(getAvailableActions(two).canDraw, false);
  section("4p deal 7 each; 2p deal 14 each, reserve empty, no-draw");
}

// --- Opening 6-6 ---
{
  const state = prMatch({ seed: 42 });
  assert.equal(state.mustPlayTileId, PUERTO_RICAN_OPENING_TILE_ID);
  assert.ok(state.players[state.currentPlayer].hand.includes("6-6"));
  assert.throws(
    () =>
      playTile(
        state,
        state.players[state.currentPlayer].hand.find((id) => id !== "6-6")
      ),
    /Must open/
  );
  const after = playTile(state, "6-6");
  assert.equal(after.board[0].id, "6-6");
  assert.equal(after.mustPlayTileId, null);
  section("Round 1 requires 6-6 opener");
}

// --- Teams ---
{
  assert.deepEqual(getPuertoRicanTeams(), [
    [0, 1],
    [2, 3],
  ]);
  assert.equal(puertoRicanPartnerSeat(0), 1);
  assert.equal(puertoRicanPartnerSeat(2), 3);
  assert.equal(puertoRicanTeamIdForSeat(0), 0);
  assert.equal(puertoRicanTeamIdForSeat(3), 1);
  assert.equal(puertoRicanArePartners(0, 1), true);
  assert.equal(puertoRicanArePartners(0, 2), false);
  section("Opposite partnerships: 0↔1 and 2↔3");
}

// --- Later winner free-opens ---
{
  let state = prMatch({ seed: 55 });
  state = playTile(state, "6-6");
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
  };
  const next = startNextRound(fakeOver, { seed: 902 });
  assert.equal(next.currentPlayer, 2);
  assert.equal(next.mustPlayTileId, null);
  const opener = next.players[2].hand[0];
  const opened = playTile(next, opener);
  assert.equal(opened.board[0].id, opener);
  section("Later round: previous winner opens freely");
}

// --- Domino-out: opposing team pips; mirror; no Capicúa/Chuchazo ---
{
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
  assert.equal(
    calculatePuertoRicanRoundPoints({
      winnerIndex: 0,
      players: winState.players,
      byId: winState.byId,
      reason: ROUND_END_REASON.DOMINO,
    }),
    oppPips
  );
  const after = playTile(winState, "0-1", END.RIGHT);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.winnerIndex, 0);
  assert.equal(after.roundResult.points, oppPips);
  assert.equal(after.scores[0], 10 + oppPips);
  assert.equal(after.scores[1], 10 + oppPips);
  assert.equal(after.roundResult.nextStarterIndex, 0);
  section("Domino-out: opposing team pips; mirrored; winner starts next");
}

// --- Trancado: opposing total (NOT difference); lowest individual pips starter ---
{
  // Team 0 = 4; team 1 = 22. Opposing total for winner = 22 (not difference 18).
  // Seat 0 pips=1, seat 1 pips=3 → lowest individual on team 0 is seat 0.
  const state = playingState({
    hands: [["0-1"], ["1-2"], ["4-6"], ["6-6"]],
    boardTiles: ["3-3"],
    currentPlayer: 0,
    consecutivePasses: 3,
    roundStarterIndex: 2,
    scores: [0, 0, 0, 0],
  });
  assert.equal(puertoRicanTeamPipTotal(0, state.players, state.byId), 4);
  assert.equal(puertoRicanTeamPipTotal(1, state.players, state.byId), 22);
  const after = passTurn(state);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.equal(after.roundResult.tied, undefined);
  assert.equal(after.roundResult.points, 22);
  assert.notEqual(after.roundResult.points, 18);
  assert.equal(puertoRicanTeamIdForSeat(after.roundResult.winnerIndex), 0);
  assert.equal(after.roundResult.nextStarterIndex, 0);
  assert.deepEqual(after.scores, [22, 22, 0, 0]);
  section("Trancado: opposing pip total; lowest individual pips starts");
}

// --- Blocked starter: lowest individual pips; seat-index tie-break; NOT causer ---
{
  // Team 0 wins (4 vs 22). Seat 0 holds 3 pips, seat 1 holds 1 pip → starter = 1.
  // Passer is seat 0 (would be Dominican causer) — PR must still pick seat 1.
  assert.equal(
    choosePuertoRicanBlockedStarter({
      winningTeamId: 0,
      players: [
        { hand: ["0-3"] },
        { hand: ["0-1"] },
        { hand: ["4-6"] },
        { hand: ["6-6"] },
      ],
      byId: indexTiles([
        createTile(0, 3),
        createTile(0, 1),
        createTile(4, 6),
        createTile(6, 6),
      ]),
    }),
    1
  );

  const state = playingState({
    hands: [["1-2"], ["0-1"], ["4-6"], ["6-6"]],
    boardTiles: ["3-3"],
    currentPlayer: 0,
    consecutivePasses: 3,
    roundStarterIndex: 3,
  });
  // Seat 0 = 3 pips, seat 1 = 1 pip; causer = 0.
  const after = passTurn(state);
  assert.equal(after.roundResult.points, 22);
  assert.equal(after.roundResult.nextStarterIndex, 1);
  assert.equal(after.roundResult.winnerIndex, 1);
  assert.notEqual(after.roundResult.nextStarterIndex, 0);

  // Equal individual pips on winning team → lower seat index.
  assert.equal(
    choosePuertoRicanBlockedStarter({
      winningTeamId: 1,
      players: [
        { hand: ["0-1"] },
        { hand: ["1-2"] },
        { hand: ["3-3"] },
        { hand: ["2-4"] },
      ],
      byId: indexTiles([
        createTile(0, 1),
        createTile(1, 2),
        createTile(3, 3),
        createTile(2, 4),
      ]),
    }),
    2
  );
  section("PR blocked starter: lowest seat pips; not Dominican causer");
}

// --- Tied Trancado ---
{
  const state = playingState({
    hands: [["0-4"], ["1-1"], ["0-3"], ["1-2"]],
    boardTiles: ["6-6"],
    currentPlayer: 0,
    consecutivePasses: 3,
    roundStarterIndex: 3,
    scores: [20, 20, 8, 8],
  });
  const after = passTurn(state);
  assert.equal(after.roundResult.tied, true);
  assert.equal(after.roundResult.winnerIndex, null);
  assert.equal(after.roundResult.points, 0);
  assert.equal(after.roundResult.nextStarterIndex, 3);
  assert.deepEqual(after.scores, [20, 20, 8, 8]);
  const next = startNextRound(after, { seed: 777 });
  assert.equal(next.currentPlayer, 3);
  assert.equal(next.mustPlayTileId, null);
  assert.equal(
    choosePuertoRicanNextRoundStarter({
      roundResult: after.roundResult,
      roundStarterIndex: 3,
    }),
    3
  );
  section("Tied Trancado: 0 pts; same starter free-opens");
}

// --- Score mirror + match ≥200 ---
{
  assert.deepEqual(
    applyPuertoRicanAfterRoundScoreUpdate({
      scores: [40, 40, 10, 10],
      winnerIndex: 2,
      points: 15,
    }),
    [40, 40, 25, 25]
  );
  assert.equal(
    isPuertoRicanMatchWon({
      scores: [200, 200, 40, 40],
      winnerIndex: 0,
      targetScore: 200,
    }),
    true
  );
  assert.equal(
    isPuertoRicanMatchWon({
      scores: [199, 199, 40, 40],
      winnerIndex: 0,
      targetScore: 200,
    }),
    false
  );

  const near = playingState({
    hands: [["0-1"], ["6-5"], ["2-2"], ["3-3"]],
    boardTiles: ["0-0"],
    currentPlayer: 0,
    scores: [190, 190, 10, 10],
  });
  const after = playTile(near, "0-1", END.RIGHT);
  assert.ok(after.scores[0] >= 200);
  assert.equal(after.scores[0], after.scores[1]);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  section("Score mirror + first team ≥200 wins match");
}

// --- Persistence ---
{
  const state = startMatch({
    seed: 4242,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "puertorican",
  });
  const withScores = { ...state, scores: [30, 12] };
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: withScores }),
    true
  );
  assert.equal(normalizeSaveRuleset(withScores).rulesetId, "puertorican");
  const four = prMatch({ seed: 4242 });
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: four }),
    false,
    "V1 does not resume 4-hand Puerto Rican tables"
  );
  section("Persistence: puertorican 1v1 rulesetId; 4p saves reset");
}

// --- CCW + AI ---
{
  assert.equal(nextPlayerIndex(0, 4), 3);
  let state = prMatch({ seed: 321 });
  const action = chooseAiAction(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.notEqual(action.type, "draw");
  const after = applyAiTurn(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.equal(after.rulesetId, "puertorican");
  section("CCW unchanged; AI never draws under PR");
}

// --- Capicúa / Chuchazo stubs ---
{
  const ruleset = resolveRuleset("puertorican");
  assert.equal(ruleset.policies.isCapicua(), false);
  assert.equal(ruleset.policies.isChuchazo(), false);
  assert.equal(isPuertoRicanCapicua(), false);
  assert.equal(isChuchazo(), false);
  section("Capicúa + Chuchazo stubs disabled");
}

// --- Sibling regressions ---
{
  assert.equal(resolveRuleset(DOMINICAN_RULESET_ID).defaultTargetScore, 100);
  assert.equal(resolveRuleset(PUERTO_RICAN_RULESET_ID).defaultTargetScore, 200);
  assert.equal(resolveRuleset(HAITIAN_RULESET_ID).drawPolicy, "drawUntilPlayable");
  assert.equal(resolveRuleset(AMERICAN_RULESET_ID).blockedWinnerMode, "lowestPips");
  assert.equal(resolveRuleset(LEGACY_RULESET_ID).partnerships, null);
  assert.notEqual(
    resolveRuleset(DOMINICAN_RULESET_ID).policies.resolveTeamBlockedOutcome,
    resolveRuleset(PUERTO_RICAN_RULESET_ID).policies.resolveTeamBlockedOutcome
  );
  // Same hands: Dominican blocked awards difference; PR awards opposing total.
  const hands = [
    { hand: ["0-1"] },
    { hand: ["1-2"] },
    { hand: ["4-6"] },
    { hand: ["6-6"] },
  ];
  const byId = indexTiles([
    createTile(0, 1),
    createTile(1, 2),
    createTile(4, 6),
    createTile(6, 6),
  ]);
  assert.equal(
    resolveRuleset(DOMINICAN_RULESET_ID).policies.calculateRoundPoints({
      winnerIndex: 0,
      players: hands,
      byId,
      reason: ROUND_END_REASON.BLOCKED,
    }),
    18
  );
  assert.equal(
    calculatePuertoRicanRoundPoints({
      winnerIndex: 0,
      players: hands,
      byId,
      reason: ROUND_END_REASON.BLOCKED,
    }),
    22
  );
  section("Sibling rulesets unchanged; PR block score distinct from Dominican");
}

console.log("\nPuerto Rican ruleset tests passed.");
