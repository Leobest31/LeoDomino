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
 * @property {number|null} [roundStarterIndex]
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
    roundStarterIndex: playerIndex,
    roundResult: null,
    matchWinner: null,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
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
  } else if (ruleset.drawPolicy === "none") {
    canDraw = false;
  }

  if (ruleset.passPolicy === "passWhenReserveEmpty") {
    canPass = !hasMove && reserveEmpty && !lockedOpen;
  } else if (ruleset.passPolicy === "passWhenNoMove") {
    canPass = !hasMove && !lockedOpen;
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
 * Skip the current seat without treating it as a stuck/blocked pass.
 * Used for online turn timeout when the seat had a legal play and did not act.
 * Does not change Classic/Haitian/American play, draw, or pass rules.
 */
export function skipTurn(state) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error("Cannot skip: round is not active");
  }
  return {
    ...advancePlayer(state),
    consecutivePasses: 0,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
  };
}

/**
 * @param {GameState} state
 * @param {number} winnerIndex
 * @param {string} reason
 * @param {object} [extras]
 * @param {number} [extras.nextStarterIndex]
 * @returns {GameState}
 */
function finishRound(state, winnerIndex, reason, extras = {}) {
  const ruleset = rulesetOf(state);
  const isDekabes = reason === ROUND_END_REASON.DEKABES;
  const explainRoundEnd =
    typeof ruleset.policies.explainRoundEnd === "function"
      ? ruleset.policies.explainRoundEnd
      : null;
  const explanation =
    explainRoundEnd && winnerIndex != null
      ? explainRoundEnd({
          winnerIndex,
          players: state.players,
          byId: state.byId,
          reason,
          isDekabes,
        })
      : null;

  let points = 0;
  if (explanation) {
    points = Number(explanation.awarded) || 0;
  } else if (
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

  const nextStarterIndex =
    extras.nextStarterIndex != null ? extras.nextStarterIndex : winnerIndex;

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
      matchWinner =
        typeof ruleset.policies.resolveMatchWinner === "function"
          ? ruleset.policies.resolveMatchWinner({
              scores,
              winnerIndex,
              targetScore: state.targetScore,
            })
          : winnerIndex;
    }
  } else if (ruleset.matchWinMode === "firstToReach") {
    const reached = scores.findIndex((score) => score >= state.targetScore);
    if (reached !== -1) matchWinner = reached;
  }
  const matchOver = matchWinner != null;
  const usesSummary = Boolean(ruleset.roundSummary) && explanation != null;

  /** @type {string} */
  let statusKey = matchOver && !usesSummary ? "rules.matchWon" : "rules.roundWon";
  if (!matchOver && isDekabes) {
    statusKey = "rules.dekabes";
  }

  return {
    ...state,
    scores,
    phase: usesSummary || !matchOver ? PHASE.ROUND_OVER : PHASE.MATCH_OVER,
    matchWinner: usesSummary ? null : matchWinner,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: {
      reason,
      winnerIndex,
      points,
      nextStarterIndex,
      ...(isDekabes ? { dekabes: true } : {}),
      ...(usesSummary
        ? {
            summary: true,
            rawPips: explanation.rawTotal,
            hands: explanation.hands,
            pendingMatchWinner: matchOver ? matchWinner : null,
          }
        : {}),
    },
    statusKey,
    statusVars: {
      name: state.players[winnerIndex].id,
      points,
    },
  };
}

/**
 * Blocked equal-pip / equal-team tie — zero points, no fabricated winner.
 * Next round reuses the previous round starter.
 *
 * @param {GameState} state
 * @returns {GameState}
 */
function finishTiedRound(state) {
  const starter =
    state.roundStarterIndex != null
      ? state.roundStarterIndex
      : state.currentPlayer;

  return {
    ...state,
    phase: PHASE.ROUND_OVER,
    matchWinner: null,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: {
      reason: ROUND_END_REASON.BLOCKED,
      winnerIndex: null,
      points: 0,
      tied: true,
      nextStarterIndex: starter,
    },
    statusKey: "rules.roundTied",
    statusVars: null,
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
 * @returns {number}
 */
function resolveBlockedWinnerLowestPips(state) {
  const ruleset = rulesetOf(state);
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
 * Resolve a blocked table into a scoring outcome.
 *
 * @param {GameState} state
 * @param {number|null} [blockCauserIndex] - seat that passed into the block
 * @returns {{ tied: boolean, winnerIndex: number|null, nextStarterIndex: number|null }}
 */
function resolveBlockedOutcome(state, blockCauserIndex = null) {
  const ruleset = rulesetOf(state);

  if (ruleset.blockedWinnerMode === "lowestPips") {
    const winnerIndex = resolveBlockedWinnerLowestPips(state);
    return { tied: false, winnerIndex, nextStarterIndex: winnerIndex };
  }

  if (ruleset.blockedWinnerMode === "lowestTeamPips") {
    if (typeof ruleset.policies.resolveTeamBlockedOutcome !== "function") {
      throw new Error(
        `Ruleset ${ruleset.id} requires policies.resolveTeamBlockedOutcome for lowestTeamPips`
      );
    }
    return ruleset.policies.resolveTeamBlockedOutcome({
      state,
      blockCauserIndex,
      blockedTieBreak: ruleset.blockedTieBreak,
    });
  }

  throw new Error(`Unsupported blockedWinnerMode: ${ruleset.blockedWinnerMode}`);
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
    roundStarterIndex: state.roundStarterIndex ?? null,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  });

  // Optional on-play count scoring (All Fives, etc.). Always scored from
  // the post-move board. explainPlayScore is the one source of truth for
  // both the award and the terminal glow records.
  const scoreOpts = {
    board: next.board,
    isOpening: state.board.length === 0,
    tileId,
    end: chosen.end,
    playerIndex: state.currentPlayer,
    spinnerId: next.spinnerId,
    spinnerNorth: next.spinnerNorth,
    spinnerSouth: next.spinnerSouth,
  };
  if (typeof ruleset.policies.explainPlayScore === "function") {
    const report = ruleset.policies.explainPlayScore(scoreOpts);
    const playPoints = Number(report?.awarded) || 0;
    if (playPoints > 0) {
      const scores = next.scores.slice();
      scores[state.currentPlayer] += playPoints;
      next = {
        ...next,
        scores,
        statusKey: null,
        statusVars: { playPoints },
        lastPlayPoints: playPoints,
        lastPlayPointsSeat: state.currentPlayer,
        lastPlayScoreTerminals: report.highlights ?? [],
      };
    } else {
      next = {
        ...next,
        lastPlayPoints: 0,
        lastPlayPointsSeat: null,
        lastPlayScoreTerminals: [],
      };
    }
  } else if (typeof ruleset.policies.scorePlay === "function") {
    const playPoints = ruleset.policies.scorePlay(scoreOpts);
    if (Number.isFinite(playPoints) && playPoints > 0) {
      const scores = next.scores.slice();
      scores[state.currentPlayer] += playPoints;
      next = {
        ...next,
        scores,
        statusKey: null,
        statusVars: { playPoints },
        lastPlayPoints: playPoints,
        lastPlayPointsSeat: state.currentPlayer,
        lastPlayScoreTerminals: [],
      };
    } else {
      next = {
        ...next,
        lastPlayPoints: 0,
        lastPlayPointsSeat: null,
        lastPlayScoreTerminals: [],
      };
    }
  }

  // Domino out?
  if (next.players[state.currentPlayer].hand.length === 0) {
    const reason = dekabes ? ROUND_END_REASON.DEKABES : ROUND_END_REASON.DOMINO;
    return finishRound(next, state.currentPlayer, reason, {
      nextStarterIndex: state.currentPlayer,
    });
  }

  // Mid-round match win from count scoring (e.g. All Fives to 200).
  if (typeof ruleset.policies.scorePlay === "function") {
    const won =
      typeof ruleset.policies.isMatchWon === "function"
        ? ruleset.policies.isMatchWon({
            scores: next.scores,
            winnerIndex: state.currentPlayer,
            targetScore: next.targetScore,
            reason: null,
          })
        : next.scores[state.currentPlayer] >= next.targetScore;
    if (won) {
      return {
        ...next,
        phase: PHASE.MATCH_OVER,
        matchWinner: state.currentPlayer,
        roundResult: {
          winnerIndex: state.currentPlayer,
          points: 0,
          reason: "countTarget",
          nextStarterIndex: state.currentPlayer,
        },
      };
    }
  }

  return advancePlayer(next);
}

/**
 * Draw one tile from the reserve (only when no legal move).
 * @param {GameState} state
 * @returns {GameState}
 */
export function drawTile(state, tileId = null) {
  if (state.phase !== PHASE.PLAYING) {
    throw new Error("Cannot draw: round is not active");
  }

  const actions = getAvailableActions(state);
  if (!actions.canDraw) {
    throw new Error("Draw is not allowed now");
  }

  const drawn = applyDraw(state, state.currentPlayer, tileId);
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
    roundStarterIndex: state.roundStarterIndex ?? null,
    roundResult: null,
    matchWinner: null,
    statusKey: "notification.drewTile",
    statusVars: null,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
  };
}

/**
 * Pass turn — when ruleset pass policy allows (reserve empty / no-move).
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
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
  };

  next = advancePlayer(next);
  next.consecutivePasses = state.consecutivePasses + 1;

  const blockedByStuck = isBoardBlocked(next);
  const blockedByPasses =
    ruleset.blockedDetection === "allStuckOrConsecutivePasses" &&
    next.consecutivePasses >= next.players.length;

  if (blockedByStuck || blockedByPasses) {
    const outcome = resolveBlockedOutcome(next, passer);
    if (outcome.tied) {
      return finishTiedRound({
        ...next,
        statusKey: "rules.roundTied",
        statusVars: null,
      });
    }
    return finishRound(
      { ...next, statusKey: "rules.roundBlocked", statusVars: null },
      outcome.winnerIndex,
      ROUND_END_REASON.BLOCKED,
      { nextStarterIndex: outcome.nextStarterIndex }
    );
  }

  return next;
}

/**
 * Start the next round after roundOver (keeps match scores).
 * Default: previous round winner opens freely.
 * Dominican: blocked-aware / tied-tranque starter policies via ruleset hooks.
 *
 * @param {GameState} state
 * @param {object} [dealOptions] - optional seed override for next deal
 * @returns {GameState}
 */
export function startNextRound(state, dealOptions = {}) {
  if (state.phase !== PHASE.ROUND_OVER) {
    throw new Error("Next round only after a finished round");
  }
  if (!state.roundResult) {
    throw new Error("Cannot start next round without a round result");
  }
  const tied = Boolean(state.roundResult.tied);
  if (state.roundResult.winnerIndex == null && !tied) {
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

  /** @type {number} */
  let starterIndex;
  if (typeof ruleset.policies.chooseNextRoundStarter === "function") {
    starterIndex = ruleset.policies.chooseNextRoundStarter({
      roundResult: state.roundResult,
      roundStarterIndex: state.roundStarterIndex,
    });
  } else if (tied) {
    starterIndex =
      state.roundResult.nextStarterIndex ?? state.roundStarterIndex;
  } else {
    starterIndex =
      state.roundResult.nextStarterIndex ?? state.roundResult.winnerIndex;
  }
  if (starterIndex == null || starterIndex < 0) {
    throw new Error("Cannot start next round without a starter");
  }

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
    starterIndex,
    rulesetId,
  });
}

/**
 * After the All Fives felt counting hold: open the match-over modal if the
 * award reached the target, otherwise deal the next round.
 * Idempotent when already PLAYING or MATCH_OVER (Strict Mode / double timer).
 *
 * @param {GameState} state
 * @returns {GameState}
 */
export function advanceAfterRoundSummary(state) {
  if (state.phase === PHASE.PLAYING || state.phase === PHASE.MATCH_OVER) {
    return state;
  }
  if (state.phase !== PHASE.ROUND_OVER) {
    throw new Error("Round summary only after a finished round");
  }
  const pending = state.roundResult?.pendingMatchWinner;
  if (pending != null) {
    return {
      ...state,
      phase: PHASE.MATCH_OVER,
      matchWinner: pending,
      statusKey: "rules.matchWon",
      statusVars: {
        name: state.players[pending]?.id,
        points: state.roundResult?.points ?? 0,
      },
    };
  }
  return startNextRound(state);
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
