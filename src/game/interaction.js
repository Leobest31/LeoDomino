/**
 * Human interaction helpers — unique-destination auto vs multi-end choice.
 * Pure JS (no React). Supports American Spinner ends (N/S) as well as L/R.
 */

import { END } from "./constants.js";
import {
  hasUniqueDestination,
  resolveAmericanPlayChoice,
} from "./rules/americanSpinner.js";

/**
 * @typedef {import("./moves.js").LegalMove} LegalMove
 */

const KNOWN_ENDS = new Set([
  END.LEFT,
  END.RIGHT,
  END.NORTH,
  END.SOUTH,
  "left",
  "right",
  "north",
  "south",
]);

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
 * @returns {string[]}
 */
export function legalEndsForTile(legalMoves, tileId) {
  const ends = [];
  for (const move of movesForTile(legalMoves, tileId)) {
    if (!ends.includes(move.end)) ends.push(move.end);
  }
  return ends;
}

/**
 * True when the tile can be played on more than one end (player must choose).
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAmbiguousPlacement(legalMoves, tileId) {
  return legalEndsForTile(legalMoves, tileId).length > 1;
}

/**
 * True when exactly one legal destination exists (safe to auto-place / loose drop).
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @returns {boolean}
 */
export function isAutoPlaceable(legalMoves, tileId) {
  return hasUniqueDestination(legalMoves, tileId);
}

/**
 * Resolve the move to play for a tile.
 * - If `end` is provided, that placement must be legal.
 * - If omitted and exactly one end is legal, that move is returned.
 * - If multiple ends are legal and `end` is omitted, returns null.
 *
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @param {string|null|undefined} [end]
 * @returns {LegalMove|null}
 */
export function resolvePlayChoice(legalMoves, tileId, end) {
  if (typeof end === "string" && KNOWN_ENDS.has(end)) {
    return resolveAmericanPlayChoice(legalMoves, tileId, end);
  }
  return resolveAmericanPlayChoice(legalMoves, tileId, end ?? null);
}

/**
 * Smart-drag resolution after a table drop.
 * - 0 destinations → reject
 * - 1 destination → auto-place (drop need not hit a precise zone)
 * - 2+ destinations → require targetedEnd to match a legal end
 *
 * @param {LegalMove[]} legalMoves
 * @param {string} tileId
 * @param {string|null|undefined} targetedEnd - end from hit-test, or null if none
 * @returns {{ ok: true, move: LegalMove } | { ok: false, reason: "none"|"ambiguous"|"mismatch" }}
 */
export function resolveDragDestination(legalMoves, tileId, targetedEnd) {
  const moves = movesForTile(legalMoves, tileId);
  if (!moves.length) return { ok: false, reason: "none" };

  const ends = legalEndsForTile(legalMoves, tileId);
  if (ends.length === 1) {
    const move = moves.find((m) => m.end === ends[0]);
    return move
      ? { ok: true, move }
      : { ok: false, reason: "none" };
  }

  if (typeof targetedEnd !== "string" || !targetedEnd) {
    return { ok: false, reason: "ambiguous" };
  }

  const move = moves.find((m) => m.end === targetedEnd);
  if (!move) return { ok: false, reason: "mismatch" };
  return { ok: true, move };
}
