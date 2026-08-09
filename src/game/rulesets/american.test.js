/**
 * American Draw Dominoes ruleset — V1 verification.
 * Run: node src/game/rulesets/american.test.js
 *
 * Scoring convention (reused from Classic/legacy calculateRoundPoints):
 * - Domino out (empty hand): winner scores sum of all opponents' remaining pips.
 * - Blocked: lowest pip total wins; same award — sum of opponents' remaining pips
 *   (2p: opponent hand total). Tie → lower seat index.
 * - Match: first seat whose score >= target (100) wins (matchWinMode firstToReach).
 */

import assert from "node:assert/strict";
import {
  AMERICAN_RULESET_ID,
  DEFAULT_DIFFICULTY,
  END,
  HAITIAN_RULESET_ID,
  LEGACY_RULESET_ID,
  PHASE,
  ROUND_END_REASON,
  applyAiTurn,
  applyAutoAction,
  calculateRoundPoints,
  chooseAiAction,
  chooseAutoAction,
  chooseStartingPlayer,
  drawTile,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
  getAvailableActions,
  getGameStyle,
  isBoardBlocked,
  isGameStyleCompatibleWithPlayerCount,
  isKnownRulesetId,
  isPlayerCountSupported,
  listAvailableGameStyles,
  normalizeGameStyleId,
  passTurn,
  playTile,
  resolveRuleset,
  startMatch,
  startNextRound,
  startingStrength,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset as normalizeSaveRuleset,
} from "../../persistence/matchSave.js";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import {
  gameStyleFlagDataUrl as flagDataUrl,
  gameStyleFlagEmoji as flagEmoji,
} from "../../data/gameStyles.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function americanMatch(overrides = {}) {
  return startMatch({
    seed: 1001,
    playerIds: ["you", "rival"],
    rulesetId: AMERICAN_RULESET_ID,
    ...overrides,
  });
}

/** Seat 0 plays last tile for a pip-sum win. */
function dominoWinState(scores, extras = {}) {
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
    round: 3,
    targetScore: 100,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    ...extras,
  };
}

/** Both seats stuck; A has fewer pips. */
function blockedState(scores = [0, 0]) {
  const byId = indexTiles([
    createTile(6, 6),
    createTile(0, 0),
    createTile(1, 1),
    createTile(2, 3),
  ]);
  return {
    seed: 2,
    byId,
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: ["1-1", "2-3"] },
    ],
    reserve: [],
    board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores,
    round: 2,
    targetScore: 100,
    rulesetId: AMERICAN_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
}

// --- Registry / UI catalog ---
{
  assert.equal(isKnownRulesetId("american"), true);
  assert.equal(AMERICAN_RULESET_ID, "american");
  const american = resolveRuleset("american");
  assert.equal(american.id, "american");
  assert.equal(american.deckType, "double-six");
  assert.equal(american.tileCount, 28);
  assert.equal(american.handSize, 7);
  assert.equal(american.defaultTargetScore, 100);
  assert.equal(american.roundScoreMode, "sumOpponentPips");
  assert.equal(american.matchWinMode, "firstToReach");
  assert.equal(american.drawPolicy, "drawUntilPlayable");
  assert.equal(american.passPolicy, "passWhenReserveEmpty");
  assert.equal(american.round1Starter, "highestDoubleElseHighest");
  assert.equal(american.laterRoundStarter, "previousWinner");
  assert.equal(american.blockedWinnerMode, "lowestPips");
  assert.equal(american.blockedTieBreak, "lowerSeatIndex");
  assert.equal(american.boardModel, "linearTwoEnds");
  assert.deepEqual(american.supportedPlayerCounts, [2, 3, 4]);
  assert.equal(isPlayerCountSupported(american, 2), true);
  assert.equal(isPlayerCountSupported(american, 3), true);
  assert.equal(isPlayerCountSupported(american, 4), true);
  assert.equal(american.policies.chooseStartingPlayer, resolveRuleset("legacy").policies.chooseStartingPlayer);
  assert.equal(american.policies.calculateRoundPoints, resolveRuleset("legacy").policies.calculateRoundPoints);

  const style = getGameStyle("american");
  assert.ok(style);
  assert.equal(style.rulesetId, "american");
  assert.equal(style.countryCode, "US");
  assert.equal(style.enabled, true);
  assert.equal(style.available, true);
  assert.equal(gameStyleToRulesetId("american"), "american");
  assert.equal(gameStyleForRulesetId("american")?.id, "american");
  assert.equal(normalizeGameStyleId("american"), "american");
  assert.ok(flagDataUrl(style).startsWith("data:image/svg+xml"));
  assert.equal(flagEmoji(style), "🇺🇸");

  const styles = listAvailableGameStyles();
  assert.equal(styles.length, 5);
  assert.ok(styles.some((s) => s.id === "american"));
  assert.ok(styles.some((s) => s.id === "dominican"));
  assert.ok(styles.some((s) => s.id === "puertorican"));
  assert.equal(isGameStyleCompatibleWithPlayerCount("american", 3), true);
  section("registry + GAME_STYLES american / US flag");
}

// --- Deal 7 for 2/3/4 ---
{
  const two = americanMatch({ seed: 7, playerCount: 2 });
  assert.equal(two.rulesetId, "american");
  assert.equal(two.targetScore, 100);
  assert.equal(two.players[0].hand.length, 7);
  assert.equal(two.players[1].hand.length, 7);
  assert.equal(two.reserve.length, 14);

  const three = startMatch({
    seed: 8,
    playerCount: 3,
    playerIds: ["you", "rival", "rival-2"],
    rulesetId: "american",
  });
  assert.equal(three.players.every((p) => p.hand.length === 7), true);
  assert.equal(three.reserve.length, 7);

  const four = startMatch({
    seed: 9,
    playerCount: 4,
    playerIds: ["you", "rival", "rival-2", "rival-3"],
    rulesetId: "american",
  });
  assert.equal(four.players.every((p) => p.hand.length === 7), true);
  assert.equal(four.reserve.length, 0);
  section("American 2/3/4p deal = 7 each (mirror Classic)");
}

// --- Opening: R1 highest double else highest ---
{
  const state = americanMatch({ seed: 42 });
  const { playerIndex, tileId } = chooseStartingPlayer(state.players, state.byId);
  assert.equal(state.currentPlayer, playerIndex);
  assert.equal(state.mustPlayTileId, tileId);
  assert.ok(state.players[playerIndex].hand.includes(tileId));
  let best = -1;
  for (const p of state.players) {
    for (const id of p.hand) {
      best = Math.max(best, startingStrength(state.byId[id]));
    }
  }
  assert.equal(startingStrength(state.byId[tileId]), best);

  const forced = state.mustPlayTileId;
  const other = state.players[state.currentPlayer].hand.find((id) => id !== forced);
  if (other) {
    assert.throws(() => playTile(state, other, END.RIGHT), /Must open|Illegal/);
  }
  const next = playTile(state, forced, END.RIGHT);
  assert.equal(next.mustPlayTileId, null);
  assert.equal(next.rulesetId, "american");
  section(`opening forced highest tile ${tileId}`);
}

// --- Forced drawing one-at-a-time; pass only when boneyard empty ---
{
  let found = false;
  for (let seed = 200; seed < 500 && !found; seed += 1) {
    let s = americanMatch({ seed });
    s = playTile(s, s.mustPlayTileId, END.RIGHT);
    if (s.phase !== PHASE.PLAYING) continue;
    const actions = getAvailableActions(s);
    if (!actions.canPlay && actions.canDraw) {
      assert.equal(actions.canPass, false, "cannot pass while reserve has tiles");
      const beforeHand = s.players[s.currentPlayer].hand.length;
      const beforeReserve = s.reserve.length;
      s = drawTile(s);
      assert.equal(s.players[s.currentPlayer].hand.length, beforeHand + 1);
      assert.equal(s.reserve.length, beforeReserve - 1);
      found = true;
      section(`forced draw one tile (seed ${seed}); pass blocked while reserve remains`);
    }
  }
  assert.ok(found, "expected a draw-required American position");

  const stuck = {
    ...americanMatch({ seed: 1 }),
    board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
    reserve: [],
    mustPlayTileId: null,
    consecutivePasses: 0,
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["0-1", "0-2"] },
      { id: "b", hand: ["0-3", "1-2"] },
    ],
    phase: PHASE.PLAYING,
  };
  const passActions = getAvailableActions(stuck);
  assert.equal(passActions.canPlay, false);
  assert.equal(passActions.canDraw, false);
  assert.equal(passActions.canPass, true);
  section("pass only when boneyard empty and no legal move");
}

// --- Hand-empty win → sum opponent pips ---
{
  const before = dominoWinState([10, 20]);
  // Opponent holds 2-2 (4) + 3-4 (7) = 11
  const after = playTile(before, "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.winnerIndex, 0);
  assert.equal(after.roundResult.points, 11);
  assert.deepEqual(after.scores, [21, 20]);
  assert.equal(after.rulesetId, "american");
  section("empty-hand win scores sum of opponent pips");
}

// --- Blocked → lowest pips wins, same pip-sum award ---
{
  const state = blockedState([5, 8]);
  assert.equal(isBoardBlocked(state), true);
  const actions = getAvailableActions(state);
  assert.equal(actions.canPass, true);
  const after = passTurn(state);
  assert.ok(after.phase === PHASE.ROUND_OVER || after.phase === PHASE.MATCH_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.equal(after.roundResult.winnerIndex, 0);
  // Opponent pips: 1-1 (2) + 2-3 (5) = 7
  assert.equal(after.roundResult.points, 7);
  assert.deepEqual(after.scores, [12, 8]);
  section("blocked: lowest pips wins and scores opponents' pip sum");
}

// --- Score accumulation + match end at 100+ ---
{
  const points = calculateRoundPoints({
    winnerIndex: 0,
    players: [
      { hand: [] },
      { hand: ["6-6", "5-5"] },
    ],
    byId: indexTiles([createTile(6, 6), createTile(5, 5)]),
  });
  assert.equal(points, 22);

  const nearWin = dominoWinState([90, 40]);
  const after = playTile(nearWin, "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.MATCH_OVER);
  assert.equal(after.matchWinner, 0);
  assert.equal(after.roundResult.points, 11);
  assert.deepEqual(after.scores, [101, 40]);
  assert.ok(after.scores[0] >= 100);
  section("score accumulates; match ends at >= 100");
}

// --- Later rounds: previous winner free open ---
{
  let state = americanMatch({ seed: 55, targetScore: 500 });
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < 200) {
    const action = chooseAutoAction(state);
    assert.ok(action);
    state = applyAutoAction(state, action);
    guard += 1;
  }
  if (state.phase === PHASE.ROUND_OVER) {
    const winner = state.roundResult.winnerIndex;
    const next = startNextRound(state, { seed: 56 });
    assert.equal(next.rulesetId, "american");
    assert.equal(next.currentPlayer, winner);
    assert.equal(next.mustPlayTileId, null);
    section(`later round: previous winner ${winner} free open`);
  } else {
    section("auto-play completed match (later-round skip)");
  }
}

// --- Classic + Haitian regression ---
{
  const classic = startMatch({ seed: 12, playerIds: ["you", "rival"] });
  assert.equal(classic.rulesetId, LEGACY_RULESET_ID);
  assert.equal(classic.targetScore, 100);
  assert.equal(resolveRuleset("legacy").matchWinMode, "firstToReach");
  assert.equal(resolveRuleset("legacy").id, "legacy");
  assert.notEqual(resolveRuleset("legacy").id, "american");

  const haitian = startMatch({
    seed: 77,
    playerIds: ["you", "rival"],
    rulesetId: HAITIAN_RULESET_ID,
  });
  assert.equal(haitian.rulesetId, "haitian");
  assert.equal(haitian.targetScore, 4);
  assert.equal(resolveRuleset("haitian").matchWinMode, "shutoutToTarget");
  assert.equal(resolveRuleset("haitian").roundScoreMode, "matchPoints");
  assert.deepEqual(resolveRuleset("haitian").supportedPlayerCounts, [2, 4]);
  section("Classic + Haitian behavior unchanged regression");
}

// --- Save / resume ---
{
  const state = americanMatch({ seed: 4242 });
  assert.equal(state.rulesetId, "american");
  assert.equal(isValidSavedMatch({ version: MATCH_SAVE_VERSION, state }), true);
  assert.equal(normalizeSaveRuleset(state).rulesetId, "american");
  const withScores = { ...state, scores: [40, 25] };
  assert.deepEqual(normalizeSaveRuleset(withScores).scores, [40, 25]);
  section("save/resume preserves american rulesetId");
}

// --- AI ---
{
  let state = americanMatch({ seed: 321 });
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
  assert.equal(after.rulesetId, "american");
  assert.equal(after.targetScore, 100);
  section("AI completes legal American turns");
}

console.log("\nAmerican ruleset tests passed.");
