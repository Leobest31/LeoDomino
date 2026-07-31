/**
 * AI difficulty levels and tuning knobs.
 * Extensible: add a level here + a scorer branch in policies.js.
 */

/** @typedef {"beginner"|"easy"|"medium"|"hard"|"expert"} DifficultyId */

export const DIFFICULTY = Object.freeze({
  BEGINNER: "beginner",
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
  EXPERT: "expert",
});

/** Ordered for UI selectors (beginner → expert). */
export const DIFFICULTY_ORDER = Object.freeze([
  DIFFICULTY.BEGINNER,
  DIFFICULTY.EASY,
  DIFFICULTY.MEDIUM,
  DIFFICULTY.HARD,
  DIFFICULTY.EXPERT,
]);

export const AI_DIFFICULTY_STORAGE_KEY = "leodomino.aiDifficulty";

/** Default seat when not overridden. */
export const DEFAULT_DIFFICULTY = DIFFICULTY.MEDIUM;

/**
 * @type {Readonly<Record<DifficultyId, {
 *   thinkMinMs: number,
 *   thinkMaxMs: number,
 *   mistakeRate: number,
 *   noise: number,
 *   trackTiles: boolean,
 *   useProbabilities: boolean,
 *   preserveDoubles: boolean,
 *   blockAggressively: boolean,
 * }>>}
 */
export const DIFFICULTY_CONFIG = Object.freeze({
  beginner: {
    thinkMinMs: 500,
    thinkMaxMs: 900,
    mistakeRate: 0.55,
    noise: 1.2,
    trackTiles: false,
    useProbabilities: false,
    preserveDoubles: false,
    blockAggressively: false,
  },
  easy: {
    thinkMinMs: 550,
    thinkMaxMs: 1000,
    mistakeRate: 0.22,
    noise: 0.65,
    trackTiles: false,
    useProbabilities: false,
    preserveDoubles: false,
    blockAggressively: false,
  },
  medium: {
    thinkMinMs: 650,
    thinkMaxMs: 1200,
    mistakeRate: 0.08,
    noise: 0.28,
    trackTiles: true,
    useProbabilities: false,
    preserveDoubles: true,
    blockAggressively: false,
  },
  hard: {
    thinkMinMs: 750,
    thinkMaxMs: 1400,
    mistakeRate: 0.02,
    noise: 0.1,
    trackTiles: true,
    useProbabilities: true,
    preserveDoubles: true,
    blockAggressively: true,
  },
  expert: {
    thinkMinMs: 850,
    thinkMaxMs: 1500,
    mistakeRate: 0,
    noise: 0.02,
    trackTiles: true,
    useProbabilities: true,
    preserveDoubles: true,
    blockAggressively: true,
  },
});

/**
 * @param {string} value
 * @returns {value is DifficultyId}
 */
export function isDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_CONFIG, value);
}

/**
 * @param {string} [value]
 * @returns {DifficultyId}
 */
export function normalizeDifficulty(value) {
  return isDifficulty(value) ? value : DEFAULT_DIFFICULTY;
}

/**
 * @param {DifficultyId} difficulty
 */
export function getDifficultyConfig(difficulty) {
  return DIFFICULTY_CONFIG[normalizeDifficulty(difficulty)];
}
