/**
 * Offline seat helpers — human at index 0, AI on remaining seats.
 */

export const HUMAN_INDEX = 0;
export const MIN_PLAYER_COUNT = 2;
export const MAX_PLAYER_COUNT = 4;
export const PLAYER_COUNT_STORAGE_KEY = "leodomino.playerCount";

/**
 * @param {unknown} value
 * @returns {2|3|4}
 */
export function normalizePlayerCount(value) {
  const n = Number(value);
  if (n === 3 || n === 4) return /** @type {3|4} */ (n);
  return 2;
}

/**
 * Stable offline ids: seat 0 = you, others = rival / rival-2 / rival-3.
 * @param {number} playerCount
 * @returns {string[]}
 */
export function buildOfflinePlayerIds(playerCount) {
  const count = normalizePlayerCount(playerCount);
  /** @type {string[]} */
  const ids = ["you"];
  for (let i = 1; i < count; i += 1) {
    ids.push(i === 1 ? "rival" : `rival-${i}`);
  }
  return ids;
}

/**
 * @param {number} index
 * @returns {boolean}
 */
export function isHumanSeat(index) {
  return index === HUMAN_INDEX;
}

/**
 * @param {number} index
 * @returns {boolean}
 */
export function isAiSeat(index) {
  return index !== HUMAN_INDEX;
}
