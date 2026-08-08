/**
 * Setup-screen AI choices — visible subset mapped onto DIFFICULTY ids.
 * Does not alter scoring / policy logic; only constrains the pre-game UI.
 */

import { DIFFICULTY, normalizeDifficulty } from "./difficulties.js";

/** @typedef {import("./difficulties.js").DifficultyId} DifficultyId */

/** Visible setup levels: Easy → Hard → Advanced (expert). */
export const SETUP_DIFFICULTY_ORDER = Object.freeze([
  DIFFICULTY.EASY,
  DIFFICULTY.HARD,
  DIFFICULTY.EXPERT,
]);

/**
 * Collapse a stored / full difficulty into one of the three setup choices.
 * @param {string} [value]
 * @returns {DifficultyId}
 */
export function toSetupDifficulty(value) {
  const difficulty = normalizeDifficulty(value);
  if (difficulty === DIFFICULTY.EXPERT) return DIFFICULTY.EXPERT;
  if (difficulty === DIFFICULTY.HARD || difficulty === DIFFICULTY.MEDIUM) {
    return DIFFICULTY.HARD;
  }
  return DIFFICULTY.EASY;
}

/**
 * i18n key for a setup difficulty chip (Advanced uses a setup-specific label).
 * @param {DifficultyId} id
 * @returns {string}
 */
export function setupDifficultyLabelKey(id) {
  if (id === DIFFICULTY.EXPERT) return "setup.difficultyAdvanced";
  return `ai.difficulty.${id}`;
}
