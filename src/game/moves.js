/**
 * Legal move detection for the current hand and board.
 */

import { END } from "./constants.js";
import { canPlaceOnEnd, createOpeningPlacement, getOpenEnds, resolvePlacement } from "./board.js";

/**
 * @typedef {object} LegalMove
 * @property {string} tileId
 * @property {"left"|"right"} end
 * @property {number} left       - Resulting left pip of the placed tile
 * @property {number} right      - Resulting right pip of the placed tile
 * @property {"horizontal"|"vertical"} orientation
 */

/**
 * List every legal placement for the given hand on the current board.
 *
 * - Empty board: each hand tile has one opening move (recorded as end "right").
 * - Non-empty: a tile may be playable on left, right, or both.
 *
 * @param {string[]} handIds - Tile ids in the player's hand
 * @param {object[]} board - Current table chain
 * @param {Record<string, { id: string, a: number, b: number, isDouble: boolean }>} byId
 * @returns {LegalMove[]}
 */
export function getLegalMoves(handIds, board, byId) {
  /** @type {LegalMove[]} */
  const moves = [];

  if (!handIds.length) {
    return moves;
  }

  // Opening play: any tile may start the chain.
  if (!board.length) {
    for (const id of handIds) {
      const tile = byId[id];
      if (!tile) {
        throw new Error(`Unknown tile id in hand: ${id}`);
      }
      const placement = createOpeningPlacement(tile);
      moves.push({
        tileId: id,
        end: END.RIGHT,
        left: placement.left,
        right: placement.right,
        orientation: placement.orientation,
      });
    }
    return moves;
  }

  const ends = getOpenEnds(board);

  for (const id of handIds) {
    const tile = byId[id];
    if (!tile) {
      throw new Error(`Unknown tile id in hand: ${id}`);
    }

    if (canPlaceOnEnd(board, tile, END.LEFT)) {
      const placement = resolvePlacement(tile, /** @type {number} */ (ends.left), END.LEFT);
      moves.push({
        tileId: id,
        end: END.LEFT,
        left: placement.left,
        right: placement.right,
        orientation: placement.orientation,
      });
    }

    if (canPlaceOnEnd(board, tile, END.RIGHT)) {
      const placement = resolvePlacement(tile, /** @type {number} */ (ends.right), END.RIGHT);
      moves.push({
        tileId: id,
        end: END.RIGHT,
        left: placement.left,
        right: placement.right,
        orientation: placement.orientation,
      });
    }
  }

  return moves;
}

/**
 * True if the hand has at least one legal placement.
 *
 * @param {string[]} handIds
 * @param {object[]} board
 * @param {Record<string, object>} byId
 * @returns {boolean}
 */
export function hasLegalMove(handIds, board, byId) {
  return getLegalMoves(handIds, board, byId).length > 0;
}

/**
 * Find a specific legal move, or null if it is not allowed.
 *
 * @param {string[]} handIds
 * @param {object[]} board
 * @param {Record<string, object>} byId
 * @param {string} tileId
 * @param {"left"|"right"} end
 * @returns {LegalMove|null}
 */
export function findLegalMove(handIds, board, byId, tileId, end) {
  return (
    getLegalMoves(handIds, board, byId).find(
      (move) => move.tileId === tileId && move.end === end
    ) ?? null
  );
}
