/**
 * LeoDomino V1 product surface — Human vs LeoBest only.
 * Engine still understands 3/4 seats for tests and a future version.
 */

export const V1_PLAYER_COUNT = 2;
export const V1_OPPONENT_ID = "leoBest";
export const V1_HUMAN_ID = "you";

/**
 * Product match creation always uses two seats.
 * @param {unknown} value
 * @returns {2}
 */
export function normalizeV1PlayerCount(value) {
  void value;
  return V1_PLAYER_COUNT;
}

/**
 * True when a persisted match can be resumed in V1.
 * @param {unknown} playerCount
 * @returns {boolean}
 */
export function isV1ResumePlayerCount(playerCount) {
  return Number(playerCount) === V1_PLAYER_COUNT;
}
