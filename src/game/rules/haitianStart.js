/**
 * Haitian Round 1 starter — holder of 6-6 must open.
 */

import { tileId } from "../tiles.js";

export const HAITIAN_OPENING_TILE_ID = tileId(6, 6);

/**
 * Find the seat holding 6-6. Returns null if it is still in the reserve.
 *
 * @param {{ hand: string[] }[]} players
 * @param {Record<string, object>} [_byId]
 * @returns {{ playerIndex: number, tileId: string }|null}
 */
export function chooseDoubleSixStarter(players, _byId) {
  const id = HAITIAN_OPENING_TILE_ID;
  for (let p = 0; p < players.length; p += 1) {
    if (players[p]?.hand?.includes(id)) {
      return { playerIndex: p, tileId: id };
    }
  }
  return null;
}
