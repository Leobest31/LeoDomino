/**
 * Board / table chain: open ends and placing tiles.
 * Independent of React — operates on plain objects only.
 */

import { END, ORIENTATION } from "./constants.js";
import { BRANCH, stampTileDestination } from "./boardTopology.js";
import { oppositePip, tileHasPip } from "./tiles.js";

/**
 * @typedef {object} BoardTile
 * @property {string} id
 * @property {number} left  - Pip facing the left open end of the chain
 * @property {number} right - Pip facing the right open end of the chain
 * @property {"horizontal"|"vertical"} orientation
 */

/**
 * Empty table chain.
 * @returns {BoardTile[]}
 */
export function createBoard() {
  return [];
}

/**
 * Open pip values on both ends of the chain.
 * When the board is empty, both ends are null.
 *
 * @param {BoardTile[]} board
 * @returns {{ left: number|null, right: number|null }}
 */
export function getOpenEnds(board) {
  if (!board.length) {
    return { left: null, right: null };
  }

  return {
    left: board[0].left,
    right: board[board.length - 1].right,
  };
}

/**
 * Build the board tile placement for an empty table (opening play).
 *
 * @param {{ id: string, a: number, b: number, isDouble: boolean }} tile
 * @returns {BoardTile}
 */
export function createOpeningPlacement(tile) {
  return stampTileDestination(
    {
      id: tile.id,
      left: tile.a,
      right: tile.b,
      orientation: tile.isDouble ? ORIENTATION.VERTICAL : ORIENTATION.HORIZONTAL,
    },
    BRANCH.MAIN_RIGHT
  );
}

/**
 * Resolve how a tile sits when attached to a given end.
 *
 * For LEFT: the matching half faces right (toward the existing chain).
 * For RIGHT: the matching half faces left (toward the existing chain).
 *
 * @param {{ id: string, a: number, b: number, isDouble: boolean }} tile
 * @param {number} endPip - Current open pip on that end
 * @param {"left"|"right"} end
 * @returns {BoardTile}
 */
export function resolvePlacement(tile, endPip, end) {
  if (!tileHasPip(tile, endPip)) {
    throw new Error(`Tile ${tile.id} cannot attach to end pip ${endPip}`);
  }

  const freePip = oppositePip(tile, endPip);
  const orientation = tile.isDouble ? ORIENTATION.VERTICAL : ORIENTATION.HORIZONTAL;

  if (end === END.LEFT) {
    return stampTileDestination(
      {
        id: tile.id,
        left: freePip,
        right: endPip,
        orientation,
      },
      END.LEFT
    );
  }

  if (end === END.RIGHT) {
    return stampTileDestination(
      {
        id: tile.id,
        left: endPip,
        right: freePip,
        orientation,
      },
      END.RIGHT
    );
  }

  throw new Error(`Unknown board end: ${end}`);
}

/**
 * Place a tile on the board. Returns a new board array (immutable update).
 *
 * @param {BoardTile[]} board
 * @param {{ id: string, a: number, b: number, isDouble: boolean }} tile
 * @param {"left"|"right"} end - Ignored for the opening tile; still accepted
 * @returns {BoardTile[]}
 */
export function placeTile(board, tile, end = END.RIGHT) {
  if (board.some((placed) => placed.id === tile.id)) {
    throw new Error(`Tile ${tile.id} is already on the board`);
  }

  if (!board.length) {
    return [createOpeningPlacement(tile)];
  }

  const ends = getOpenEnds(board);

  if (end === END.LEFT) {
    const placed = resolvePlacement(tile, /** @type {number} */ (ends.left), END.LEFT);
    return [placed, ...board];
  }

  if (end === END.RIGHT) {
    const placed = resolvePlacement(tile, /** @type {number} */ (ends.right), END.RIGHT);
    return [...board, placed];
  }

  throw new Error(`Unknown board end: ${end}`);
}

/**
 * Whether a tile can attach to a specific end of the current board.
 *
 * @param {BoardTile[]} board
 * @param {{ a: number, b: number }} tile
 * @param {"left"|"right"} end
 * @returns {boolean}
 */
export function canPlaceOnEnd(board, tile, end) {
  if (!board.length) {
    return true;
  }

  const ends = getOpenEnds(board);
  const pip = end === END.LEFT ? ends.left : ends.right;
  return tileHasPip(tile, /** @type {number} */ (pip));
}
