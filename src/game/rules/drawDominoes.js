/**
 * Draw Dominoes rules engine (Phase 4).
 * Pure JS — turn flow, draw-until-playable, pass, round/match end, scoring.
 */

import { END } from "../constants.js";
import {
  applyDraw,
  applyPlace,
  createMatch,
  listLegalMoves,
  playerHasLegalMove,
} from "../match.js";
import { DEFAULT_TARGET_SCORE, PHASE, ROUND_END_REASON } from "./constants.js";
import { calculateRoundPoints, handPipTotal } from "./scoring.js";
import { chooseStartingPlayer } from "./start.js";

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
 * @property {string|null} mustPlayTileId
 * @property {number} consecutivePasses
 * @property {object|null} roundResult
 * @property {number|null} matchWinner
 * @property {string|null} statusKey
 * @property {Record<string, string|number>|null} statusVars
 */

/**
 * @param {object} [options]
 * @returns {GameState}
 */
export function startMatch(options = {}) {
  const targetScore = options.targetScore ?? DEFAULT_TARGET_SCORE;
  const base = createMatch(options);
  return beginRound(base, {
    scores: Array.from({ length: base.players.length }, () => 0),
    round: 1,
    targetScore,
  });
}

/**
 * Deal is already done on `base`; attach round fields + starter.
 *
 * Round 1: highest double (else highest tile) starts and must open with that tile.
 * Later rounds: previous round winner starts and may open with any tile.
 *
 * @param {object} base - createMatch result
 * @param {object} meta
 * @param {number[]} meta.scores
 * @param {number} meta.round
 * @param {number} meta.targetScore
 * @param {number} [meta.starterIndex] - previous winner (required for round > 1)
 * @returns {GameState}
 */
function beginRound(base, meta) {
  const freeOpen = meta.round > 1;
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
  } else {
    const chosen = chooseStartingPlayer(base.players, base.byId);
    playerIndex = chosen.playerIndex;
    tileId = chosen.tileId;
  }

  return {
    ...base,
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
 * What the current player is allowed to do.
 * @param {GameState} state
 */
export function getAvailableActions(state) {
  if (state.phase !== PHASE.PLAYING) {
    return { canPlay: false, canDraw: false, canPass: false, legalMoves: [] };
  }

  const legalMoves = getCurrentLegalMoves(state);
  const hasMove = legalMoves.length > 0;
  const reserveEmpty = state.reserve.length === 0;

  return {
    canPlay: hasMove,
    // Draw while no legal play and tiles remain (draw-until-playable).
    canDraw: !hasMove && !reserveEmpty && !state.mustPlayTileId,
    // Pass only when no legal play and reserve is empty.
    canPass: !hasMove && reserveEmpty && !state.mustPlayTileId,
    legalMoves,
  };
}

function advancePlayer(state) {
  const next = (state.currentPlayer + 1) % state.players.length;
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
  const points = calculateRoundPoints({
    winnerIndex,
    players: state.players,
    byId: state.byId,
  });

  const scores = state.scores.slice();
  scores[winnerIndex] += points;

  const reached = scores.findIndex((score) => score >= state.targetScore);
  const matchOver = reached !== -1;

  return {
    ...state,
    scores,
    phase: matchOver ? PHASE.MATCH_OVER : PHASE.ROUND_OVER,
    matchWinner: matchOver ? reached : null,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: {
      reason,
      winnerIndex,
      points,
    },
    statusKey: matchOver ? "rules.matchWon" : "rules.roundWon",
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
 * When blocked, lowest remaining pip total wins (tie → current player loses tie-break to lower index).
 * @param {GameState} state
 */
function resolveBlockedWinner(state) {
  let winnerIndex = 0;
  let best = Infinity;

  for (let i = 0; i < state.players.length; i += 1) {
    const total = handPipTotal(state.players[i].hand, state.byId);
    if (total < best || (total === best && i < winnerIndex)) {
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

  let next = /** @type {GameState} */ ({
    ...applyPlace(state, state.currentPlayer, tileId, chosen.end),
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    round: state.round,
    targetScore: state.targetScore,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  });

  // Domino out?
  if (next.players[state.currentPlayer].hand.length === 0) {
    return finishRound(next, state.currentPlayer, ROUND_END_REASON.DOMINO);
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

  const passer = state.currentPlayer;
  let next = {
    ...state,
    consecutivePasses: state.consecutivePasses + 1,
    statusKey: "notification.passed",
    statusVars: { name: state.players[passer].id },
  };

  next = advancePlayer(next);
  next.consecutivePasses = state.consecutivePasses + 1;

  if (isBoardBlocked(next) || next.consecutivePasses >= next.players.length) {
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

  const base = createMatch({
    seed: dealOptions.seed ?? Date.now(),
    playerCount: state.players.length,
    playerIds: state.players.map((p) => p.id),
    handSize: dealOptions.handSize,
  });

  return beginRound(base, {
    scores: state.scores,
    round: state.round + 1,
    targetScore: state.targetScore,
    starterIndex: state.roundResult.winnerIndex,
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
