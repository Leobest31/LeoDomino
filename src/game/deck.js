/**
 * Deck operations: shuffle the set, deal hands, form the reserve (boneyard).
 */

import { DEFAULT_PLAYER_COUNT, HAND_SIZE, TILE_COUNT } from "./constants.js";
import { generateSet } from "./tiles.js";
import { createRng, shuffle } from "../utils/rng.js";

/**
 * Shuffle a full double-six set.
 *
 * @param {number} [seed] - Optional seed for reproducible deals
 * @returns {{ tiles: object[], order: string[], seed: number }}
 */
export function createShuffledDeck(seed = Date.now()) {
  const rng = createRng(seed);
  const tiles = shuffle(generateSet(), rng);
  return {
    tiles,
    order: tiles.map((tile) => tile.id),
    seed,
  };
}

/**
 * Deal hands and leave the remainder as the reserve.
 *
 * @param {object[]} shuffledTiles - Ordered tile objects after shuffle
 * @param {object} [options]
 * @param {number} [options.playerCount=2]
 * @param {number} [options.handSize=7]
 * @returns {{
 *   hands: string[][],
 *   reserve: string[],
 *   byId: Record<string, object>
 * }}
 */
export function deal(shuffledTiles, options = {}) {
  const playerCount = options.playerCount ?? DEFAULT_PLAYER_COUNT;
  const handSize = options.handSize ?? HAND_SIZE;

  if (!Array.isArray(shuffledTiles) || shuffledTiles.length !== TILE_COUNT) {
    throw new Error(`Deal expects a full set of ${TILE_COUNT} tiles`);
  }
  if (playerCount < 2 || playerCount > 4) {
    throw new Error("playerCount must be between 2 and 4");
  }

  const totalDealt = playerCount * handSize;
  if (totalDealt > TILE_COUNT) {
    throw new Error(`Cannot deal ${totalDealt} tiles from a set of ${TILE_COUNT}`);
  }

  /** @type {Record<string, object>} */
  const byId = Object.create(null);
  for (const tile of shuffledTiles) {
    byId[tile.id] = tile;
  }

  /** @type {string[][]} */
  const hands = Array.from({ length: playerCount }, () => []);
  let cursor = 0;

  // Round-robin deal keeps the distribution fair and familiar.
  for (let i = 0; i < handSize; i += 1) {
    for (let p = 0; p < playerCount; p += 1) {
      hands[p].push(shuffledTiles[cursor].id);
      cursor += 1;
    }
  }

  const reserve = shuffledTiles.slice(cursor).map((tile) => tile.id);

  return { hands, reserve, byId };
}
