/**
 * Human interaction helpers — one-end auto vs both-ends choice.
 * Pure JS (no React).
 */

import { END } from "./constants.js";
import { coercePlayEnd } from "./boardTopology.js";

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
 * @returns {("left"|"right"|"north"|"south")[]}
 */
export function legalEndsForTile(legalMoves, tileId) {
  const ends = [];
  for (const move of movesForTile(legalMoves, tileId)) {
    if (!ends.includes(move.end)) ends.push(move.end);
  }
  return ends;
}

function isMainPlayEnd(end) {
  return end === END.LEFT || end === END.RIGHT;
}

/**
 * Main-chain destinations only (LEFT / RIGHT). Spinner TOP/BOTTOM are
 * explicit-choice ports and must not steal auto-place of the main line.
 *
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {("left"|"right")[]}
 */
export function legalMainEndsForTile(legalMoves, tileId) {
  return legalEndsForTile(legalMoves, tileId).filter(isMainPlayEnd);
}

/**
 * True when the tile can be played on both chain ends (player must choose).
 * Spinner TOP/BOTTOM do not count — those are explicit drag targets.
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAmbiguousPlacement(legalMoves, tileId) {
  const main = legalMainEndsForTile(legalMoves, tileId);
  if (main.length > 1) return true;
  if (main.length === 1) return false;
  return legalEndsForTile(legalMoves, tileId).length > 1;
}

/**
 * True when exactly one automatic destination exists.
 * A unique MAIN_LEFT / MAIN_RIGHT wins even if spinner TOP/BOTTOM are also
 * legal — those arms are never used to auto-continue the main chain.
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAutoPlaceable(legalMoves, tileId) {
  const main = legalMainEndsForTile(legalMoves, tileId);
  if (main.length === 1) return true;
  if (main.length > 1) return false;
  return legalEndsForTile(legalMoves, tileId).length === 1;
}

/**
 * Resolve the move to play for a tile.
 * - If `end` is provided, that placement must be legal (including explicit N/S).
 * - If omitted, a unique MAIN_LEFT / MAIN_RIGHT is chosen automatically.
 * - TOP/BOTTOM are used only when `end` names them, or when they are the
 *   sole remaining legal destinations.
 *
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @param {"left"|"right"|"north"|"south"|null|undefined} [end]
 * @returns {LegalMove|null}
 */
export function resolvePlayChoice(legalMoves, tileId, end) {
  const moves = movesForTile(legalMoves, tileId);
  if (!moves.length) return null;

  const playEnd = coercePlayEnd(end);
  if (
    playEnd === END.LEFT ||
    playEnd === END.RIGHT ||
    playEnd === END.NORTH ||
    playEnd === END.SOUTH
  ) {
    return (
      moves.find((move) => move.end === playEnd || move.destination === end) ?? null
    );
  }

  const main = legalMainEndsForTile(legalMoves, tileId);
  if (main.length === 1) {
    return moves.find((move) => move.end === main[0]) ?? null;
  }
  if (main.length > 1) return null;

  if (moves.length === 1) return moves[0];

  const ends = legalEndsForTile(legalMoves, tileId);
  if (ends.length === 1) {
    return moves.find((move) => move.end === ends[0]) ?? null;
  }

  return null;
}
