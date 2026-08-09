/**
 * Draw Dominoes rules engine (Phase 4).
 * Pure JS — turn flow, draw-until-playable, pass, round/match end, scoring.
 * Behavior is driven by the match's resolved Ruleset (default: legacy).
 */

import { END } from "../constants.js";
import {
  applyDraw,
  applyPlace,
  createMatch,
  listLegalMoves,
  playerHasLegalMove,
} from "../match.js";
import { nextPlayerIndex } from "../players.js";
import {
  DEFAULT_RULESET_ID,
  isPlayerCountSupported,
  normalizeRulesetId,
  resolveHandSize,
  resolveRuleset,
} from "../rulesets/index.js";
import { PHASE, ROUND_END_REASON } from "./constants.js";
import { handPipTotal } from "./scoring.js";

/**
 * @typedef {object} GameState
 * @property {number} seed
 * @property {Record<string, object>} byId
 * @property {{ id: string, hand: string[] }[]} players
 * @property {string[]} reserve
 * @property {object[]} board
 * @property {string} phase
 * @property {number} currentPlayer
 * @property {number[]} scores
 * @property {number} round
 * @property {number} targetScore
 * @property {string} rulesetId
 * @property {string|null} mustPlayTileId
 * @property {number} consecutivePasses
 * @property {object|null} roundResult
 * @property {number|null} matchWinner
 * @property {string|null} statusKey
 * @property {Record<string, string|number>|null} statusVars
 */

const OPENING_TILE_MISSING = "OPENING_TILE_MISSING";
const MAX_OPENING_REDEALS = 256;

/**
 * @param {GameState|object} state
 */
function rulesetOf(state) {
  return resolveRuleset(state?.rulesetId ?? DEFAULT_RULESET_ID);
}

/**
 * @param {object} [options]
 * @returns {GameState}
 */
export function startMatch(options = {}) {
  const rulesetId = normalizeRulesetId(options.rulesetId);
  const ruleset = resolveRuleset(rulesetId);
  const targetScore = options.targetScore ?? ruleset.defaultTargetScore;
  const playerCount = options.playerCount ?? options.playerIds?.length ?? 2;
  if (!isPlayerCountSupported(ruleset, playerCount)) {
    throw new Error(
      `Ruleset ${rulesetId} does not support ${playerCount}-player matches`
    );
  }
  const handSize = options.handSize ?? resolveHandSize(ruleset, playerCount);
  const seed0 = options.seed ?? Date.now();
  const allowRedeal = Boolean(ruleset.redealUntilOpeningTile);
  const maxAttempts = allowRedeal ? MAX_OPENING_REDEALS : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const seed =
      typeof seed0 === "number" && Number.isFinite(seed0) ? seed0 + attempt : seed0;
    const base = createMatch({
      ...options,
      seed,
      handSize,
      rulesetId,
      playerCount,
    });
    try {
      return beginRound(base, {
        scores: Array.from({ length: base.players.length }, () => 0),
        round: 1,
        targetScore,
        rulesetId,
      });
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code;
      if (code === OPENING_TILE_MISSING && attempt + 1 < maxAttempts) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Unable to deal a legal Round 1 opening");
}

/**
 * Deal is already done on `base`; attach round fields + starter.
 *
 * Round 1: ruleset round1Starter policy (legacy highest double / Haitian 6-6).
 * Later rounds: previous round winner starts and may open with any tile.
 *
 * @param {object} base - createMatch result
 * @param {object} meta
 * @param {number[]} meta.scores
 * @param {number} meta.round
 * @param {number} meta.targetScore
 * @param {string} [meta.rulesetId]
 * @param {number} [meta.starterIndex] - previous winner (required for round > 1)
 * @returns {GameState}
 */
function beginRound(base, meta) {
  const rulesetId = normalizeRulesetId(base.rulesetId ?? meta.rulesetId);
  const ruleset = resolveRuleset(rulesetId);
  const freeOpen = meta.round > 1 && ruleset.freeOpenAfterRound1;
  let playerIndex;
  /** @type {string|null} */
  let tileId = null;

  if (freeOpen) {
    if (
      meta.starterIndex == null ||
      meta.starterIndex < 0 ||
      meta.starterIndex >= base.players.length
    ) {
      throw new Error("Later rounds require the previous round winner as starter");
    }
    playerIndex = meta.starterIndex;
  } else if (
    ruleset.round1Starter === "highestDoubleElseHighest" ||
    ruleset.round1Starter === "doubleSix"
  ) {
    const chosen = ruleset.policies.chooseStartingPlayer(base.players, base.byId);
    if (!chosen) {
      const err = new Error("Opening tile not dealt");
      /** @type {{ code?: string }} */ (err).code = OPENING_TILE_MISSING;
      throw err;
    }
    playerIndex = chosen.playerIndex;
    tileId = ruleset.forceOpeningTile ? chosen.tileId : null;
  } else {
    throw new Error(`Unsupported round1Starter: ${ruleset.round1Starter}`);
  }

  return {
    ...base,
    rulesetId,
    phase: PHASE.PLAYING,
    currentPlayer: playerIndex,
    scores: meta.scores.slice(),
    round: meta.round,
    targetScore: meta.targetScore,
    mustPlayTileId: tileId,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: tileId ? "rules.starter" : "rules.starterFree",
    statusVars: tileId
      ? {
          name: base.players[playerIndex].id,
          tile: tileId,
        }
      : {
          name: base.players[playerIndex].id,
        },
  };
}

/**
 * Legal moves for the current player, respecting mandatory opening tile.
 * @param {GameState} state
 */
export function getCurrentLegalMoves(state) {
  if (state.phase !== PHASE.PLAYING) return [];
  const moves = listLegalMoves(state, state.currentPlayer);
  if (state.mustPlayTileId) {
    return moves.filter((move) => move.tileId === state.mustPlayTileId);
  }
  return moves;
}

/**
 * What the current player is allowed to do (policies from active ruleset).
 * @param {GameState} state
 */
export function getAvailableActions(state) {
  if (state.phase !== PHASE.PLAYING) {
    return { canPlay: false, canDraw: false, canPass: false, legalMoves: [] };
  }

  const ruleset = rulesetOf(state);
  const legalMoves = getCurrentLegalMoves(state);
  const hasMove = legalMoves.length > 0;
  const reserveEmpty = state.reserve.length === 0;
  const lockedOpen = Boolean(state.mustPlayTileId);

  let canDraw = false;
  let canPass = false;

  if (ruleset.drawPolicy === "drawUntilPlayable") {
    canDraw = !hasMove && !reserveEmpty && !lockedOpen;
  }

  if (ruleset.passPolicy === "passWhenReserveEmpty") {
    canPass = !hasMove && reserveEmpty && !lockedOpen;
  }

  return {
    canPlay: hasMove,
    canDraw,
    canPass,
    legalMoves,
  };
}

function advancePlayer(state) {
  const next = nextPlayerIndex(state.currentPlayer, state.players.length);
  return {
    ...state,
    currentPlayer: next,
    statusKey: null,
    statusVars: null,
  };
}

/**
 * @param {GameState} state
 * @param {number} winnerIndex
 * @param {string} reason
 * @returns {GameState}
 */
function finishRound(state, winnerIndex, reason) {
  const ruleset = rulesetOf(state);
  const isDekabes = reason === ROUND_END_REASON.DEKABES;
  let points = 0;
  if (
    ruleset.roundScoreMode === "sumOpponentPips" ||
    ruleset.roundScoreMode === "matchPoints"
  ) {
    points = ruleset.policies.calculateRoundPoints({
      winnerIndex,
      players: state.players,
      byId: state.byId,
      reason,
      isDekabes,
    });
  } else {
    throw new Error(`Unsupported roundScoreMode: ${ruleset.roundScoreMode}`);
  }

  /** @type {number[]} */
  let scores;
  if (typeof ruleset.policies.afterRoundScoreUpdate === "function") {
    scores = ruleset.policies.afterRoundScoreUpdate({
      scores: state.scores,
      winnerIndex,
      points,
      targetScore: state.targetScore,
    });
  } else {
    scores = state.scores.slice();
    scores[winnerIndex] += points;
  }

  /** @type {number|null} */
  let matchWinner = null;
  if (typeof ruleset.policies.isMatchWon === "function") {
    if (
      ruleset.policies.isMatchWon({
        scores,
        winnerIndex,
        targetScore: state.targetScore,
      })
    ) {
      matchWinner = winnerIndex;
    }
  } else if (ruleset.matchWinMode === "firstToReach") {
    const reached = scores.findIndex((score) => score >= state.targetScore);
    if (reached !== -1) matchWinner = reached;
  }
  const matchOver = matchWinner != null;

  /** @type {string} */
  let statusKey = matchOver ? "rules.matchWon" : "rules.roundWon";
  if (!matchOver && isDekabes) {
    statusKey = "rules.dekabes";
  }

  return {
    ...state,
    scores,
    phase: matchOver ? PHASE.MATCH_OVER : PHASE.ROUND_OVER,
    matchWinner,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: {
      reason,
      winnerIndex,
      points,
      ...(isDekabes ? { dekabes: true } : {}),
    },
    statusKey,
    statusVars: {
      name: state.players[winnerIndex].id,
      points,
    },
  };
}

/**
 * Detect blocked table: reserve empty and no player has a legal move.
 * @param {GameState} state
 * @returns {boolean}
 */
export function isBoardBlocked(state) {
  if (state.reserve.length > 0) return false;
  return state.players.every((_, index) => !playerHasLegalMove(state, index));
}

/**
 * When blocked, lowest remaining pip total wins (tie → lower seat index).
 * @param {GameState} state
 */
function resolveBlockedWinner(state) {
  const ruleset = rulesetOf(state);
  if (ruleset.blockedWinnerMode !== "lowestPips") {
    throw new Error(`Unsupported blockedWinnerMode: ${ruleset.blockedWinnerMode}`);
  }

  let winnerIndex = 0;
  let best = Infinity;

  for (let i = 0; i < state.players.length; i += 1) {
    const total = handPipTotal(state.players[i].hand, state.byId);
    const better =
      total < best ||
      (total === best &&
        ruleset.blockedTieBreak === "lowerSeatIndex" &&
        i < winnerIndex);
    if (better) {
      best = total;
      winnerIndex = i;
    }
  }

  return winnerIndex;
}

/**
 * Play a tile for the current player.
 * @param {GameState} state
 * @param {string} tileId
 * @param {"left"|"right"} [end]
 * @returns {GameState}
 */
export function playTile(state, tileId, end = END.RIGHT) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error("Cannot play: round is not active");
  }

  if (state.mustPlayTileId && tileId !== state.mustPlayTileId) {
    throw new Error(`Must open with ${state.mustPlayTileId}`);
  }

  const actions = getAvailableActions(state);
  const exact = actions.legalMoves.find((move) => move.tileId === tileId && move.end === end);
  const opening =
    state.board.length === 0
      ? actions.legalMoves.find((move) => move.tileId === tileId)
      : null;
  const chosen = exact ?? opening;

  if (!chosen) {
    throw new Error(`Illegal placement: ${tileId} on ${end}`);
  }

  const ruleset = rulesetOf(state);
  const handBefore = state.players[state.currentPlayer].hand;
  const dekabes =
    typeof ruleset.policies.isDekabes === "function" &&
    ruleset.policies.isDekabes({
      tileId,
      hand: handBefore,
      board: state.board,
      byId: state.byId,
    });

  let next = /** @type {GameState} */ ({
    ...applyPlace(state, state.currentPlayer, tileId, chosen.end),
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    round: state.round,
    targetScore: state.targetScore,
    rulesetId: state.rulesetId,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  });

  // Domino out?
  if (next.players[state.currentPlayer].hand.length === 0) {
    const reason = dekabes ? ROUND_END_REASON.DEKABES : ROUND_END_REASON.DOMINO;
    return finishRound(next, state.currentPlayer, reason);
  }

  return advancePlayer(next);
}

/**
 * Draw one tile from the reserve (only when no legal move).
 * @param {GameState} state
 * @returns {GameState}
 */
export function drawTile(state) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error("Cannot draw: round is not active");
  }

  const actions = getAvailableActions(state);
  if (!actions.canDraw) {
    throw new Error("Draw is not allowed now");
  }

  const drawn = applyDraw(state, state.currentPlayer);
  if (!drawn) {
    throw new Error("Reserve is empty");
  }

  return {
    ...drawn,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    round: state.round,
    targetScore: state.targetScore,
    rulesetId: state.rulesetId,
    mustPlayTileId: state.mustPlayTileId,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: "notification.drewTile",
    statusVars: null,
  };
}

/**
 * Pass turn — only when reserve empty and no legal moves.
 * @param {GameState} state
 * @returns {GameState}
 */
export function passTurn(state) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error("Cannot pass: round is not active");
  }

  const actions = getAvailableActions(state);
  if (!actions.canPass) {
    throw new Error("Pass is not allowed now");
  }

  const ruleset = rulesetOf(state);
  const passer = state.currentPlayer;
  let next = {
    ...state,
    consecutivePasses: state.consecutivePasses + 1,
    statusKey: "notification.passed",
    statusVars: { name: state.players[passer].id },
  };

  next = advancePlayer(next);
  next.consecutivePasses = state.consecutivePasses + 1;

  const blockedByStuck = isBoardBlocked(next);
  const blockedByPasses =
    ruleset.blockedDetection === "allStuckOrConsecutivePasses" &&
    next.consecutivePasses >= next.players.length;

  if (blockedByStuck || blockedByPasses) {
    const winnerIndex = resolveBlockedWinner(next);
    return finishRound(
      { ...next, statusKey: "rules.roundBlocked", statusVars: null },
      winnerIndex,
      ROUND_END_REASON.BLOCKED
    );
  }

  return next;
}

/**
 * Start the next round after roundOver (keeps match scores).
 * Previous round winner always opens and may play any tile.
 *
 * @param {GameState} state
 * @param {object} [dealOptions] - optional seed override for next deal
 * @returns {GameState}
 */
export function startNextRound(state, dealOptions = {}) {
  if (state.phase !== PHASE.ROUND_OVER) {
    throw new Error("Next round only after a finished round");
  }
  if (!state.roundResult || state.roundResult.winnerIndex == null) {
    throw new Error("Cannot start next round without a round winner");
  }

  const rulesetId = normalizeRulesetId(state.rulesetId);
  const ruleset = resolveRuleset(rulesetId);
  if (!isPlayerCountSupported(ruleset, state.players.length)) {
    throw new Error(
      `Ruleset ${rulesetId} does not support ${state.players.length}-player matches`
    );
  }
  const handSize =
    dealOptions.handSize ?? resolveHandSize(ruleset, state.players.length);

  const base = createMatch({
    seed: dealOptions.seed ?? Date.now(),
    playerCount: state.players.length,
    playerIds: state.players.map((p) => p.id),
    handSize,
    rulesetId,
  });

  return beginRound(base, {
    scores: state.scores,
    round: state.round + 1,
    targetScore: state.targetScore,
    starterIndex: state.roundResult.winnerIndex,
    rulesetId,
  });
}

/**
 * Minimal auto-action for the non-human seat until Phase 5 AI.
 * Prefers first legal play, else draw, else pass.
 * @param {GameState} state
 * @returns {{ type: "play"|"draw"|"pass", tileId?: string, end?: string }|null}
 */
export function chooseAutoAction(state) {
  const actions = getAvailableActions(state);
  if (actions.canPlay) {
    const move = actions.legalMoves[0];
    return { type: "play", tileId: move.tileId, end: move.end };
  }
  if (actions.canDraw) return { type: "draw" };
  if (actions.canPass) return { type: "pass" };
  return null;
}

/**
 * Apply an auto action object.
 * @param {GameState} state
 * @param {{ type: string, tileId?: string, end?: string }} action
 */
export function applyAutoAction(state, action) {
  if (!action) return state;
  if (action.type === "play") return playTile(state, action.tileId, action.end);
  if (action.type === "draw") return drawTile(state);
  if (action.type === "pass") return passTurn(state);
  return state;
}
