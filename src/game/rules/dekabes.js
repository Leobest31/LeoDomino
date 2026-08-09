/**
 * Dekabès detection — Haitian round-ending bonus condition.
 * Pure helper: no ruleset id branching; callers decide when to apply.
 */

import { END } from "../constants.js";
import { canPlaceOnEnd } from "../board.js";

/**
 * True when playing `tileId` from `hand` would be a Dekabès:
 * - final tile in hand
 * - not a double
 * - legally playable on BOTH open ends before the play
 *
 * @param {object} options
 * @param {string} options.tileId
 * @param {string[]} options.hand - hand before the play
 * @param {object[]} options.board - board before the play
 * @param {Record<string, { id: string, a: number, b: number, isDouble: boolean }>} options.byId
 * @returns {boolean}
 */
export function isDekabes({ tileId, hand, board, byId }) {
  if (typeof tileId !== "string" || !tileId) return false;
  if (!Array.isArray(hand) || hand.length !== 1 || hand[0] !== tileId) return false;
  if (!Array.isArray(board) || board.length === 0) return false;

  const tile = byId?.[tileId];
  if (!tile || tile.isDouble) return false;

  return (
    canPlaceOnEnd(board, tile, END.LEFT) && canPlaceOnEnd(board, tile, END.RIGHT)
  );
}
