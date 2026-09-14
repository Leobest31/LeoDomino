/**
 * Classic (legacy) Round 1 starter — holder of 2-2 must open.
 */

import { tileId } from "../tiles.js";

export const CLASSIC_OPENING_TILE_ID = tileId(2, 2);

/**
 * Find the seat holding 2-2. Returns null if it is still in the reserve.
 *
 * @param {{ hand: string[] }[]} players
 * @param {Record<string, object>} [_byId]
 * @returns {{ playerIndex: number, tileId: string }|null}
 */
export function chooseDoubleTwoStarter(players, _byId) {
  const id = CLASSIC_OPENING_TILE_ID;
  for (let p = 0; p < players.length; p += 1) {
    if (players[p]?.hand?.includes(id)) {
      return { playerIndex: p, tileId: id };
    }
  }
  return null;
}
