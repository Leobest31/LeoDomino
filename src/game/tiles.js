/**
 * Domino tile model and double-six set generation.
 */

import { PIP_MAX } from "./constants.js";

/**
 * Build a stable unique id for a tile (normalized low-high).
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
export function tileId(a, b) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return `${low}-${high}`;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {{ id: string, a: number, b: number, isDouble: boolean }}
 */
export function createTile(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new Error(`Tile pips must be integers (got ${a}, ${b})`);
  }
  if (a < 0 || b < 0 || a > PIP_MAX || b > PIP_MAX) {
    throw new Error(`Tile pips must be between 0 and ${PIP_MAX}`);
  }

  return {
    id: tileId(a, b),
    a: Math.min(a, b),
    b: Math.max(a, b),
    isDouble: a === b,
  };
}

/**
 * Generate the complete double-six set (28 unique tiles).
 * @returns {Array<{ id: string, a: number, b: number, isDouble: boolean }>}
 */
export function generateSet() {
  const tiles = [];

  for (let a = 0; a <= PIP_MAX; a += 1) {
    for (let b = a; b <= PIP_MAX; b += 1) {
      tiles.push(createTile(a, b));
    }
  }

  return tiles;
}

/**
 * Map of tile id → tile for O(1) lookup.
 * @param {Array<{ id: string }>} tiles
 * @returns {Record<string, object>}
 */
export function indexTiles(tiles) {
  /** @type {Record<string, object>} */
  const map = Object.create(null);
  for (const tile of tiles) {
    map[tile.id] = tile;
  }
  return map;
}

/**
 * True when the tile has a half equal to `pip`.
 * @param {{ a: number, b: number }} tile
 * @param {number} pip
 * @returns {boolean}
 */
export function tileHasPip(tile, pip) {
  return tile.a === pip || tile.b === pip;
}

/**
 * The pip on the opposite half from `pip`.
 * @param {{ a: number, b: number }} tile
 * @param {number} pip
 * @returns {number}
 */
export function oppositePip(tile, pip) {
  if (tile.a === pip) return tile.b;
  if (tile.b === pip) return tile.a;
  throw new Error(`Tile ${tile.id} does not contain pip ${pip}`);
}
