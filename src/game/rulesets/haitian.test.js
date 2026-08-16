/**
 * Haitian ruleset — comprehensive V1 verification.
 * Run: node src/game/rulesets/haitian.test.js
 */

import assert from "node:assert/strict";
import {
  DEFAULT_DIFFICULTY,
  HAITIAN_MATCH_TARGET,
  HAITIAN_OPENING_TILE_ID,
  HAITIAN_RULESET_ID,
  LEGACY_RULESET_ID,
  PHASE,
  ROUND_END_REASON,
  applyAiTurn,
  applyHaitianAfterRoundScoreUpdate,
  chooseAiAction,
  calculateHaitianRoundPoints,
  calculateRoundPoints,
  gameStyleToRulesetId,
  getAvailableActions,
  getGameStyle,
  isDekabes,
  isHaitianMatchWon,
  isGameStyleCompatibleWithPlayerCount,
  isKnownRulesetId,
  isPlayerCountSupported,
  listAvailableGameStyles,
  nextPlayerIndex,
  playTile,
  resolveRuleset,
  startMatch,
  startNextRound,
  passTurn,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset as normalizeSaveRuleset,
} from "../../persistence/matchSave.js";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { handPipTotal } from "../rules/scoring.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function haitianMatch(overrides = {}) {
  return startMatch({
    seed: 1001,
    playerIds: ["you", "rival"],
    rulesetId: HAITIAN_RULESET_ID,
    ...overrides,
  });
}

/** Ordinary (non-Dekabès) final play for seat 0 — ends 0/1, tile 1-2 on right. */
function ordinaryWinState(scores, extras = {}) {
  const byId = indexTiles([
    createTile(0, 1),
    createTile(1, 2),
    createTile(2, 2),
    createTile(3, 4),
    createTile(5, 6),
  ]);
  let board = createBoard();
  board = placeTile(board, byId["0-1"], END.RIGHT);
  return {
    seed: 5,
    byId,
    players: [
      { id: "a", hand: ["1-2"] },
      { id: "b", hand: ["2-2", "3-4"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores,
    round: 5,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    ...extras,
  };
}

/** Seat 1 ordinary win — same board shape, B to play. */
function ordinaryWinStateB(scores) {
  const state = ordinaryWinState(scores);
  return {
    ...state,
    players: [
      { id: "a", hand: ["2-2", "3-4"] },
      { id: "b", hand: ["1-2"] },
    ],
    currentPlayer: 1,
  };
}

/** Dekabès setup: ends 3 and 5, final tile 3-5. */
function dekabesWinState(scores) {
  const t33 = createTile(3, 3);
  const t36 = createTile(3, 6);
  const t56 = createTile(5, 6);
  const t35 = createTile(3, 5);
  const byId = indexTiles([t33, t36, t56, t35, createTile(0, 1)]);
  let board = createBoard();
  board = placeTile(board, t33, END.RIGHT);
  board = placeTile(board, t36, END.RIGHT);
  board = placeTile(board, t56, END.RIGHT);
  return {
    seed: 2,
    byId,
    players: [
      { id: "a", hand: ["3-5"] },
      { id: "b", hand: ["0-1"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores,
    round: 2,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
}

// --- Registry ---
{
  assert.equal(isKnownRulesetId("haitian"), true);
  assert.equal(isKnownRulesetId("legacy"), true);
  const haitian = resolveRuleset("haitian");
  assert.equal(haitian.id, HAITIAN_RULESET_ID);
  assert.equal(haitian.deckType, "double-six");
  assert.equal(haitian.tileCount, 28);
  assert.equal(haitian.defaultTargetScore, 4);
  assert.equal(haitian.defaultTargetScore, HAITIAN_MATCH_TARGET);
  assert.equal(haitian.roundScoreMode, "matchPoints");
  assert.equal(haitian.matchWinMode, "shutoutToTarget");
  assert.equal(typeof haitian.policies.afterRoundScoreUpdate, "function");
  assert.equal(typeof haitian.policies.isMatchWon, "function");
  assert.equal(haitian.round1Starter, "doubleSix");
  assert.equal(haitian.hudScoreFormat, "ofTarget");
  assert.deepEqual(haitian.supportedPlayerCounts, [2, 4]);
  assert.equal(isPlayerCountSupported(haitian, 2), true);
  assert.equal(isPlayerCountSupported(haitian, 4), true);
  assert.equal(isPlayerCountSupported(haitian, 3), false);

  const classic = getGameStyle("classic");
  assert.equal(classic.rulesetId, LEGACY_RULESET_ID);
  assert.equal(gameStyleToRulesetId("haitian"), "haitian");
  const styles = listAvailableGameStyles();
  assert.equal(styles.length, 5);
  assert.ok(styles.some((s) => s.id === "haitian"));
  assert.equal(styles.some((s) => s.id === "american"), false);
  assert.ok(styles.some((s) => s.id === "allFives"));
  assert.ok(styles.some((s) => s.id === "puertorican"));
  assert.equal(isGameStyleCompatibleWithPlayerCount("haitian", 3), false);
  assert.equal(isGameStyleCompatibleWithPlayerCount("haitian", 2), true);
  assert.equal(isGameStyleCompatibleWithPlayerCount("classic", 3), true);
  section("registry resolves haitian; Classic still legacy; 3p unsupported");
}

// --- Deal ---
{
  const two = haitianMatch({ seed: 7, playerCount: 2 });
  assert.equal(two.rulesetId, "haitian");
  assert.equal(two.targetScore, 4);
  assert.equal(two.players[0].hand.length, 7);
  assert.equal(two.players[1].hand.length, 7);
  assert.equal(two.reserve.length, 14);

  const four = startMatch({
    seed: 8,
    playerCount: 4,
    playerIds: ["you", "rival", "rival-2", "rival-3"],
    rulesetId: "haitian",
  });
  assert.equal(four.players.every((p) => p.hand.length === 7), true);
  assert.equal(four.reserve.length, 0);
  section("Haitian 2p/4p deal = 7 each");
}

// --- 3p cannot start ---
{
  assert.throws(
    () =>
      startMatch({
        seed: 9,
        playerCount: 3,
        playerIds: ["a", "b", "c"],
        rulesetId: "haitian",
      }),
    /does not support 3-player/
  );
  section("unsupported 3-player Haitian cannot start");
}

// --- Opening 6-6 ---
{
  const state = haitianMatch({ seed: 42 });
  assert.equal(state.mustPlayTileId, HAITIAN_OPENING_TILE_ID);
  assert.equal(state.mustPlayTileId, "6-6");
  const holder = state.players[state.currentPlayer];
  assert.ok(holder.hand.includes("6-6"));
  assert.throws(() => playTile(state, holder.hand.find((id) => id !== "6-6")), /Must open/);
  const after = playTile(state, "6-6");
  assert.equal(after.board[0].id, "6-6");
  assert.equal(after.mustPlayTileId, null);
  section("first round requires 6-6 opener");
}

// --- Subsequent round free open ---
{
  let state = haitianMatch({ seed: 55 });
  state = playTile(state, "6-6");
  const fakeOver = {
    ...state,
    phase: PHASE.ROUND_OVER,
    roundResult: { reason: ROUND_END_REASON.DOMINO, winnerIndex: 1, points: 1 },
    scores: [0, 1],
  };
  const next = startNextRound(fakeOver, { seed: 901 });
  assert.equal(next.rulesetId, "haitian");
  assert.equal(next.round, state.round + 1);
  assert.equal(next.currentPlayer, 1);
  assert.equal(next.mustPlayTileId, null);
  const opener = next.players[1].hand[0];
  const opened = playTile(next, opener);
  assert.equal(opened.board[0].id, opener);
  section("subsequent-round winner opens with any tile");
}

// --- Turn order CCW ---
{
  assert.equal(nextPlayerIndex(0, 2), 1);
  assert.equal(nextPlayerIndex(1, 2), 0);
  assert.equal(nextPlayerIndex(0, 4), 3);
  assert.equal(nextPlayerIndex(1, 4), 2);
  assert.equal(nextPlayerIndex(2, 4), 0);
  assert.equal(nextPlayerIndex(3, 4), 1);

  let state = startMatch({
    seed: 77,
    playerCount: 4,
    playerIds: ["you", "rival", "rival-2", "rival-3"],
    rulesetId: "haitian",
  });
  const starter = state.currentPlayer;
  state = playTile(state, "6-6");
  assert.equal(state.currentPlayer, nextPlayerIndex(starter, 4));
  section("counter-clockwise turn order (2p/4p)");
}

// --- Scoring helpers ---
{
  assert.equal(calculateHaitianRoundPoints({ reason: ROUND_END_REASON.DOMINO }), 1);
  assert.equal(calculateHaitianRoundPoints({ reason: ROUND_END_REASON.BLOCKED }), 1);
  assert.equal(calculateHaitianRoundPoints({ reason: ROUND_END_REASON.DEKABES }), 2);
  assert.equal(calculateHaitianRoundPoints({ isDekabes: true }), 2);
  section("Haitian scoring: win/blocked +1, Dekabès +2");
}

// --- Normal win +1 (not pip totals) ---
{
  // Ends 1 and 0 — final tile 1-2 matches only the left end (not Dekabès).
  const byId = indexTiles([
    createTile(0, 1),
    createTile(1, 2),
    createTile(3, 4),
    createTile(5, 6),
  ]);
  let board = createBoard();
  board = placeTile(board, byId["0-1"], END.RIGHT); // ends 0 / 1
  const playable = {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: ["1-2"] },
      { id: "b", hand: ["3-4", "5-6"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 2,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  assert.equal(
    isDekabes({ tileId: "1-2", hand: ["1-2"], board, byId }),
    false
  );
  const opponentPips = handPipTotal(playable.players[1].hand, byId);
  assert.ok(opponentPips > 1);
  const after = playTile(playable, "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.points, 1);
  assert.notEqual(after.roundResult.points, opponentPips);
  assert.deepEqual(after.scores, [1, 0]);
  section("normal Haitian win = +1 (not Classic pip scoring)");
}

// --- Dekabès +2 (classic bridge: ends 3 and 5, final tile 3-5) ---
{
  const t33 = createTile(3, 3);
  const t36 = createTile(3, 6);
  const t56 = createTile(5, 6);
  const t35 = createTile(3, 5);
  const byId = indexTiles([t33, t36, t56, t35, createTile(0, 1)]);
  // Chain: [3|3]-[3|6]-[6|5] → open ends 3 and 5.
  let board = createBoard();
  board = placeTile(board, t33, END.RIGHT);
  board = placeTile(board, t36, END.RIGHT);
  board = placeTile(board, t56, END.RIGHT);
  assert.equal(
    isDekabes({ tileId: "3-5", hand: ["3-5"], board, byId }),
    true
  );
  const state = {
    seed: 2,
    byId,
    players: [
      { id: "a", hand: ["3-5"] },
      { id: "b", hand: ["0-1"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [1, 0],
    round: 2,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const after = playTile(state, "3-5", END.LEFT);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DEKABES);
  assert.equal(after.roundResult.points, 2);
  assert.equal(after.roundResult.dekabes, true);
  assert.deepEqual(after.scores, [3, 0]);
  section("Dekabès = +2 match points");
}

// --- Ordinary double-out is +1, not Dekabès ---
{
  const t33 = createTile(3, 3);
  const t36 = createTile(3, 6);
  const byId = indexTiles([t33, t36, createTile(0, 1)]);
  let board = createBoard();
  board = placeTile(board, t36, END.RIGHT); // ends 3 / 6
  const state = {
    seed: 3,
    byId,
    players: [
      { id: "a", hand: ["3-3"] },
      { id: "b", hand: ["0-1"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 2,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  assert.equal(
    isDekabes({ tileId: "3-3", hand: ["3-3"], board, byId }),
    false
  );
  const after = playTile(state, "3-3", END.LEFT);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.points, 1);
  section("ordinary domino-out (double) = +1, not Dekabès");
}

// --- Blocked +1 ---
{
  // Force blocked: empty reserve, no legal moves, consecutive passes.
  const byId = indexTiles([
    createTile(0, 0),
    createTile(1, 1),
    createTile(2, 2),
    createTile(6, 6),
  ]);
  let board = createBoard();
  board = placeTile(board, byId["6-6"], END.RIGHT);
  const state = {
    seed: 4,
    byId,
    players: [
      { id: "a", hand: ["0-0"] }, // 0 pips
      { id: "b", hand: ["1-1", "2-2"] }, // 6 pips
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 2,
    targetScore: 4,
    rulesetId: "haitian",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const actions = getAvailableActions(state);
  assert.equal(actions.canPass, true);
  let next = passTurn(state);
  if (next.phase === PHASE.PLAYING) {
    next = passTurn(next);
  }
  assert.ok(
    next.phase === PHASE.ROUND_OVER || next.phase === PHASE.MATCH_OVER
  );
  assert.equal(next.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.equal(next.roundResult.points, 1);
  assert.equal(next.roundResult.winnerIndex, 0);
  assert.equal(next.scores[0], 1);
  section("blocked Haitian win = +1 for lowest pips");
}

// --- Reset rule: winner keeps streak; opponent wiped ---
{
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [1, 0],
      winnerIndex: 1,
      points: 1,
    }),
    [0, 1]
  );
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [2, 0],
      winnerIndex: 1,
      points: 1,
    }),
    [0, 1]
  );
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [3, 0],
      winnerIndex: 1,
      points: 1,
    }),
    [0, 1]
  );
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [0, 1],
      winnerIndex: 0,
      points: 1,
    }),
    [1, 0]
  );
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [0, 2],
      winnerIndex: 0,
      points: 1,
    }),
    [1, 0]
  );
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [0, 3],
      winnerIndex: 0,
      points: 1,
    }),
    [1, 0]
  );
  // A=3 B=0, B Dekabès +2 → 0–2
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [3, 0],
      winnerIndex: 1,
      points: 2,
    }),
    [0, 2]
  );
  // Migration-like both non-zero: next round still applies reset going forward.
  assert.deepEqual(
    applyHaitianAfterRoundScoreUpdate({
      scores: [2, 1],
      winnerIndex: 0,
      points: 1,
    }),
    [3, 0]
  );
  section("Haitian afterRoundScoreUpdate resets opponent then awards winner");
}

{
  // A=1 B=0, B wins → 0–1
  const after = playTile(ordinaryWinStateB([1, 0]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [0, 1]);
  section("A 1–0, B wins → 0–1 (1→0)");
}

{
  // A=2 B=0, B wins → 0–1 (explicit 2→0 reset)
  const after = playTile(ordinaryWinStateB([2, 0]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [0, 1]);
  section("A 2–0, B wins → 0–1 (2→0)");
}

{
  // A=3 B=0, B wins → 0–1 (explicit 3→0 reset)
  const after = playTile(ordinaryWinStateB([3, 0]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [0, 1]);
  section("A 3–0, B wins → 0–1 (3→0)");
}

{
  // A=0 B=1, A wins → 1–0
  const after = playTile(ordinaryWinState([0, 1]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [1, 0]);
  section("A 0–1, A wins → 1–0 (1→0 opposite)");
}

{
  // A=0 B=2, A wins → 1–0 (explicit 2→0 opposite)
  const after = playTile(ordinaryWinState([0, 2]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [1, 0]);
  section("A 0–2, A wins → 1–0 (2→0 opposite)");
}

{
  // A=0 B=3, A wins → 1–0 (explicit 3→0 opposite)
  const after = playTile(ordinaryWinState([0, 3]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.matchWinner, null);
  assert.deepEqual(after.scores, [1, 0]);
  section("A 0–3, A wins → 1–0 (3→0 opposite)");
}

// --- Match win only on valid shutout (4–0 / 0–4) ---
{
  assert.equal(
    isHaitianMatchWon({ scores: [4, 0], winnerIndex: 0, targetScore: 4 }),
    true
  );
  assert.equal(
    isHaitianMatchWon({ scores: [0, 4], winnerIndex: 1, targetScore: 4 }),
    true
  );
  assert.equal(
    isHaitianMatchWon({ scores: [5, 0], winnerIndex: 0, targetScore: 4 }),
    true
  );
  // score >= 4 alone is NOT a win when opponent ≠ 0
  assert.equal(
    isHaitianMatchWon({ scores: [4, 1], winnerIndex: 0, targetScore: 4 }),
    false
  );
  assert.equal(
    isHaitianMatchWon({ scores: [5, 2], winnerIndex: 0, targetScore: 4 }),
    false
  );
  assert.equal(
    isHaitianMatchWon({ scores: [3, 0], winnerIndex: 0, targetScore: 4 }),
    false
  );
  section("isHaitianMatchWon requires score>=4 and opponent===0");
}

{
  // A=3 B=0, A wins +1 → 4–0 match
  const after = playTile(ordinaryWinState([3, 0]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  assert.deepEqual(after.scores, [4, 0]);
  section("A reaches valid 4–0 → A wins match");
}

{
  // A=0 B=3, B wins +1 → 0–4 match
  const after = playTile(ordinaryWinStateB([0, 3]), "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 1);
  assert.deepEqual(after.scores, [0, 4]);
  section("B reaches valid 0–4 → B wins match");
}

{
  // Migration scores [4, 1]: engine must NOT declare match win on play that
  // leaves both non-zero before reset — after reset A wins to [5, 0] (or [4,0]).
  // Direct predicate: [4,1] is not a Haitian match win.
  assert.equal(
    resolveRuleset("haitian").policies.isMatchWon({
      scores: [4, 1],
      winnerIndex: 0,
      targetScore: 4,
    }),
    false
  );
  // Engine path from both-nonzero: A=3 B=1 wins +1 → reset → [4, 0] match.
  const after = playTile(ordinaryWinState([3, 1]), "1-2", END.RIGHT);
  assert.deepEqual(after.scores, [4, 0]);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  section("engine does not win Haitian on >=4 when opponent ≠ 0");
}

{
  // A=1 B=0, B wins Dekabès: reset A, B gets +2 → 0–2
  const state = dekabesWinState([1, 0]);
  const flipped = {
    ...state,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["3-5"] },
    ],
    currentPlayer: 1,
  };
  assert.equal(
    isDekabes({
      tileId: "3-5",
      hand: ["3-5"],
      board: flipped.board,
      byId: flipped.byId,
    }),
    true
  );
  const after = playTile(flipped, "3-5", END.LEFT);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DEKABES);
  assert.equal(after.roundResult.points, 2);
  assert.deepEqual(after.scores, [0, 2]);
  assert.equal(after.matchWinner, null);
  section("Dekabès +2 after reset (A 1–0 → 0–2)");
}

{
  // A=3 B=0, B wins Dekabès: reset A from 3→0, B gets +2 → 0–2
  const state = dekabesWinState([3, 0]);
  const flipped = {
    ...state,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["3-5"] },
    ],
    currentPlayer: 1,
  };
  const after = playTile(flipped, "3-5", END.LEFT);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DEKABES);
  assert.equal(after.roundResult.points, 2);
  assert.deepEqual(after.scores, [0, 2]);
  assert.equal(after.matchWinner, null);
  section("Dekabès +2 after reset (A 3–0 → 0–2)");
}

{
  // A=3 B=0 + Dekabès → 5–0 match (apply points, then check; no cap)
  const after = playTile(dekabesWinState([3, 0]), "3-5", END.LEFT);
  assert.equal(after.roundResult.points, 2);
  assert.deepEqual(after.scores, [5, 0]);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  section("Dekabès from 3–0 yields 5–0 match win (no cap)");
}

// --- Classic/legacy scoring unchanged ---
{
  const classic = startMatch({ seed: 12, playerIds: ["you", "rival"] });
  assert.equal(classic.rulesetId, "legacy");
  assert.equal(classic.targetScore, 100);
  assert.equal(resolveRuleset("legacy").matchWinMode, "firstToReach");
  assert.equal(typeof resolveRuleset("legacy").policies.afterRoundScoreUpdate, "undefined");
  assert.equal(typeof resolveRuleset("legacy").policies.isMatchWon, "undefined");
  assert.ok(classic.mustPlayTileId);
  // Classic still sums opponent pips (not Haitian match points / reset).
  const pipPoints = calculateRoundPoints({
    winnerIndex: 0,
    players: [
      { id: "a", hand: [] },
      { id: "b", hand: ["6-6", "5-5"] },
    ],
    byId: indexTiles([createTile(6, 6), createTile(5, 5)]),
  });
  assert.equal(pipPoints, 22);
  section("Classic/legacy scoring unchanged regression");
}

// --- Save / resume ---
{
  const state = haitianMatch({ seed: 4242 });
  assert.equal(state.rulesetId, "haitian");
  const withPoints = { ...state, scores: [2, 1], targetScore: 4 };
  assert.equal(isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: withPoints }), true);
  assert.equal(normalizeSaveRuleset(withPoints).rulesetId, "haitian");
  // Resume preserves stored scores (even both non-zero from older saves).
  assert.deepEqual(normalizeSaveRuleset(withPoints).scores, [2, 1]);
  const shutout = { ...state, scores: [3, 0], targetScore: 4 };
  assert.deepEqual(normalizeSaveRuleset(shutout).scores, [3, 0]);

  const { rulesetId: _drop, ...without } = state;
  assert.equal(normalizeSaveRuleset(without).rulesetId, "legacy");
  section("save/resume preserves Haitian scores; old saves → legacy");
}

// --- AI ---
{
  let state = haitianMatch({ seed: 321 });
  const action = chooseAiAction(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.ok(action);
  assert.ok(["play", "draw", "pass"].includes(action.type));
  const after = applyAiTurn(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.equal(after.rulesetId, "haitian");
  assert.equal(after.targetScore, 4);
  assert.notEqual(after, state);
  section("AI completes legal Haitian turns");
}

// --- Draw/pass policies shared ---
{
  const state = haitianMatch({ seed: 88 });
  assert.equal(resolveRuleset(state.rulesetId).drawPolicy, "drawUntilPlayable");
  assert.equal(resolveRuleset(state.rulesetId).passPolicy, "passWhenReserveEmpty");
  assert.equal(resolveRuleset(state.rulesetId).blockedTieBreak, "lowerSeatIndex");
  section("Haitian draw/pass/blocked tiebreak reuse engine policies");
}

console.log("\nHaitian ruleset tests passed.");
