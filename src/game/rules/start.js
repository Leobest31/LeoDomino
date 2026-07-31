/**
 * Round 1 starter selection — highest double, else highest tile.
 */

import { startingStrength } from "./scoring.js";

/**
 * Find the strongest tile across all hands and its owner (Round 1 only).
 * Prefers highest double (6-6 > 5-5 > … > 0-0); if nobody holds a double,
 * uses normal ranking (6-5 > 6-4 > …).
 *
 * @param {{ hand: string[] }[]} players
 * @param {Record<string, { id: string, a: number, b: number, isDouble: boolean }>} byId
 * @returns {{ playerIndex: number, tileId: string }}
 */
export function chooseStartingPlayer(players, byId) {
  let best = null;

  for (let p = 0; p < players.length; p += 1) {
    for (const tileId of players[p].hand) {
      const tile = byId[tileId];
      if (!tile) continue;
      const strength = startingStrength(tile);
      if (
        !best ||
        strength > best.strength ||
        (strength === best.strength && p < best.playerIndex)
      ) {
        best = { playerIndex: p, tileId, strength };
      }
    }
  }

  if (!best) {
    throw new Error("Cannot choose starting player: no tiles in hands");
  }

  return { playerIndex: best.playerIndex, tileId: best.tileId };
}
