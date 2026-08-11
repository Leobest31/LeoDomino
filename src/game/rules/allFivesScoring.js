/**
 * All Fives count scoring — exposed-end totals, special opening rule,
 * and round-end awards (opponents' remaining pips rounded to nearest 5).
 *
 * Opening tile of each round:
 *   - exposed total exactly 10 → award 10
 *   - exposed total 5 (or any other value) → award 0
 *
 * Second and later plays:
 *   - every positive multiple of 5 awards its full value
 *
 * Round end (domino-out or blocked):
 *   - winner scores the sum of opponents' remaining pips,
 *     rounded to the nearest multiple of 5 (1–2 → 0, 3–7 → 5, …).
 *   - Classic raw pip totals are NOT used.
 */

import { getOpenEnds } from "../board.js";
import { handPipTotal } from "./scoring.js";

/** Cumulative match target for All Fives. */
export const ALL_FIVES_MATCH_TARGET = 150;

/**
 * Sum of the two open end faces (linear two-end board).
 * Opening doubles contribute 2× face (both ends equal).
 *
 * @param {object[]} board - board after the play
 * @returns {number}
 */
export function exposedEndTotal(board) {
  if (!Array.isArray(board) || board.length === 0) return 0;
  const ends = getOpenEnds(board);
  if (ends.left == null || ends.right == null) return 0;
  return ends.left + ends.right;
}

/**
 * Points awarded for a single play under All Fives count scoring.
 *
 * @param {object} options
 * @param {object[]} options.board - board after the play
 * @param {boolean} options.isOpening - true when this was the first tile of the round
 * @returns {number}
 */
export function scoreAllFivesPlay({ board, isOpening }) {
  const total = exposedEndTotal(board);

  if (isOpening) {
    // Special opening rule: only an exposed 10 scores (never a lone 5).
    return total === 10 ? 10 : 0;
  }

  // Normal All Fives: positive multiples of 5 award their full value.
  if (total > 0 && total % 5 === 0) return total;
  return 0;
}

/**
 * Ruleset policy adapter — called after a successful place.
 *
 * @param {object} options
 * @param {object[]} options.board
 * @param {boolean} options.isOpening
 * @returns {number}
 */
export function allFivesScorePlay(options) {
  return scoreAllFivesPlay(options);
}

/**
 * Round a pip total to the nearest multiple of 5.
 * Non-positive / non-finite → 0. Standard half-up via Math.round:
 * 1–2→0, 3–7→5, 8–12→10, …
 *
 * @param {number} value
 * @returns {number}
 */
export function roundToNearestFive(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * End-of-round All Fives award (domino-out or blocked).
 * Sum opponents' remaining pips, then round to nearest multiple of 5.
 * Isolates All Fives from Classic raw `sumOpponentPips`.
 *
 * @param {object} options
 * @param {number} options.winnerIndex
 * @param {{ hand: string[] }[]} options.players
 * @param {Record<string, { a: number, b: number }>} options.byId
 * @returns {number}
 */
export function calculateAllFivesRoundPoints({ winnerIndex, players, byId }) {
  let raw = 0;
  for (let i = 0; i < players.length; i += 1) {
    if (i === winnerIndex) continue;
    raw += handPipTotal(players[i].hand, byId);
  }
  return roundToNearestFive(raw);
}
