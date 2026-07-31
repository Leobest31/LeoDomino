/**
 * Human interaction helpers — one-end auto vs both-ends choice.
 * Pure JS (no React).
 */

import { END } from "./constants.js";

/**
 * @typedef {import("./moves.js").LegalMove} LegalMove
 */

/**
 * Legal placements for a single tile id.
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {LegalMove[]}
 */
export function movesForTile(legalMoves, tileId) {
  return legalMoves.filter((move) => move.tileId === tileId);
}

/**
 * Distinct board ends a tile can legally attach to.
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {("left"|"right")[]}
 */
export function legalEndsForTile(legalMoves, tileId) {
  const ends = [];
  for (const move of movesForTile(legalMoves, tileId)) {
    if (!ends.includes(move.end)) ends.push(move.end);
  }
  return ends;
}

/**
 * True when the tile can be played on both chain ends (player must choose).
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAmbiguousPlacement(legalMoves, tileId) {
  return legalEndsForTile(legalMoves, tileId).length > 1;
}

/**
 * True when exactly one legal end exists (safe to auto-place).
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAutoPlaceable(legalMoves, tileId) {
  return legalEndsForTile(legalMoves, tileId).length === 1;
}

/**
 * Resolve the move to play for a tile.
 * - If `end` is provided, that placement must be legal.
 * - If omitted and exactly one end is legal, that move is returned.
 * - If both ends are legal and `end` is omitted, returns null (needs drag/choice).
 *
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @param {"left"|"right"|null|undefined} [end]
 * @returns {LegalMove|null}
 */
export function resolvePlayChoice(legalMoves, tileId, end) {
  const moves = movesForTile(legalMoves, tileId);
  if (!moves.length) return null;

  if (end === END.LEFT || end === END.RIGHT) {
    return moves.find((move) => move.end === end) ?? null;
  }

  if (moves.length === 1) return moves[0];

  const ends = legalEndsForTile(legalMoves, tileId);
  if (ends.length === 1) {
    return moves.find((move) => move.end === ends[0]) ?? null;
  }

  return null;
}
