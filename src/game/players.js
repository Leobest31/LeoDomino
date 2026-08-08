/**
 * Offline seat helpers — human at index 0, AI on remaining seats.
 *
 * Table positions (UI):
 *   2p: Top=1, Bottom=0
 *   3p: Top=1, Left=2, Bottom=0
 *   4p: Top=1, Left=2, Bottom=0, Right=3
 *
 * Turn direction is counter-clockwise around the felt.
 * For 2p/3p, sequential indices (i+1)%n already match CCW.
 * For 4p, sequential order is NOT CCW — use NEXT_PLAYER_4P.
 */

export const HUMAN_INDEX = 0;
export const MIN_PLAYER_COUNT = 2;
export const MAX_PLAYER_COUNT = 4;
export const PLAYER_COUNT_STORAGE_KEY = "leodomino.playerCount";

/**
 * 4-player counter-clockwise successor by seat index.
 * Index meaning: 0=bottom, 1=top, 2=left, 3=right.
 * Cycle: 1 → 2 → 0 → 3 → 1 (Top → Left → Bottom → Right).
 * @type {ReadonlyArray<number>}
 */
export const NEXT_PLAYER_4P = Object.freeze([3, 2, 0, 1]);

/**
 * Felt position for each non-bottom player index, keyed by table size.
 * @type {Readonly<Record<number, Readonly<Record<number, "top"|"left"|"right">>>>}
 */
export const OPPONENT_FELT_POSITION = Object.freeze({
  2: Object.freeze({ 1: "top" }),
  3: Object.freeze({ 1: "top", 2: "left" }),
  4: Object.freeze({ 1: "top", 2: "left", 3: "right" }),
});

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
 * Next seat in table turn order (counter-clockwise on 4p).
 * @param {number} currentIndex
 * @param {number} playerCount
 * @returns {number}
 */
export function nextPlayerIndex(currentIndex, playerCount) {
  const count = Math.max(2, Math.floor(Number(playerCount)) || 2);
  const current = Math.floor(Number(currentIndex));
  if (!Number.isFinite(current) || current < 0 || current >= count) {
    return 0;
  }
  if (count === 4) {
    return NEXT_PLAYER_4P[current] ?? 0;
  }
  return (current + 1) % count;
}

/**
 * Felt position for a player index on a given table size (null for bottom / unknown).
 * @param {number} playerIndex
 * @param {number} playerCount
 * @returns {"top"|"left"|"right"|null}
 */
export function opponentFeltPosition(playerIndex, playerCount) {
  const count = normalizePlayerCount(playerCount);
  const map = OPPONENT_FELT_POSITION[count];
  return map?.[playerIndex] ?? null;
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
