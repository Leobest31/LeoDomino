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

import { applyAutoAction } from "../rules/drawDominoes.js";
import { chooseAiAction } from "./policies.js";

/**
 * Decide and apply an AI action in one step.
 * @param {object} state
 * @param {object} [options]
 */
export function applyAiTurn(state, options = {}) {
  const action = chooseAiAction(state, options);
  if (!action) return state;
  return applyAutoAction(state, action);
}
