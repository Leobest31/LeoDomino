/**
 * LeoDomino AI — public API (pure JS, offline).
 */

export {
  DIFFICULTY,
  DIFFICULTY_ORDER,
  DIFFICULTY_CONFIG,
  DEFAULT_DIFFICULTY,
  AI_DIFFICULTY_STORAGE_KEY,
  isDifficulty,
  normalizeDifficulty,
  getDifficultyConfig,
} from "./difficulties.js";

export { buildMemory, opponentMatchProbability, boardFingerprint } from "./memory.js";
export { scoreMove } from "./evaluate.js";
export { chooseAiAction, chooseThinkTimeMs } from "./policies.js";

import { applyAutoAction, chooseAutoAction } from "../rules/drawDominoes.js";
import { chooseAiAction } from "./policies.js";

/**
 * Clear a must-play constraint that no longer exists in the current hand.
 * Does not change move legality heuristics — only removes an impossible lock.
 * @param {object} state
 * @returns {object}
 */
function clearOrphanMustPlay(state) {
  const must = state?.mustPlayTileId;
  if (must == null) return state;
  const hand = state.players?.[state.currentPlayer]?.hand;
  if (typeof must === "string" && Array.isArray(hand) && hand.includes(must)) {
    return state;
  }
  return { ...state, mustPlayTileId: null };
}

/**
 * Legal draw / pass / first play — no scoring heuristics.
 * @param {object} state
 * @returns {object}
 */
function applyLegalFallback(state) {
  const action = chooseAutoAction(state);
  if (!action) return state;
  return applyAutoAction(state, action);
}

/**
 * Decide and apply an AI action in one step.
 * On strategy errors or null actions, recovers with a legal rules action
 * (draw/pass/play) without inventing new heuristics.
 * @param {object} state
 * @param {object} [options]
 */
export function applyAiTurn(state, options = {}) {
  try {
    const action = chooseAiAction(state, options);
    if (action) return applyAutoAction(state, action);
  } catch {
    // Strategy failed — fall through to legal recovery.
  }

  // Softlock path (e.g. orphan mustPlayTileId): unlock, then retry strategy once.
  const unlocked = clearOrphanMustPlay(state);
  if (unlocked !== state) {
    try {
      const retry = chooseAiAction(unlocked, options);
      if (retry) return applyAutoAction(unlocked, retry);
    } catch {
      // Fall through to pure legal fallback.
    }
  }

  return applyLegalFallback(unlocked);
}
