/**
 * American count scoring — open-end totals (Spinner-aware) and round-end
 * awards (opponents' remaining pips rounded to nearest 5).
 *
 * Live scoring: exact open-end total when divisible by 5 (no rounding).
 * Opening plays may score. Exposed doubles count both halves.
 *
 * Round end: opponents' pip sum → nearest multiple of 5.
 */

import { handPipTotal } from "./scoring.js";
import {
  AMERICAN_MATCH_TARGET,
  americanExposedEndTotal,
  scoreAmericanPlay,
} from "./americanSpinner.js";

/** @deprecated Use AMERICAN_MATCH_TARGET — kept for import compatibility. */
export const ALL_FIVES_MATCH_TARGET = AMERICAN_MATCH_TARGET;

export { AMERICAN_MATCH_TARGET, americanExposedEndTotal };

/**
 * Sum of open ends after a play (Spinner-aware when state carries spinner fields).
 * @param {object[]|object} boardOrState - board array (legacy) or full state
 * @returns {number}
 */
export function exposedEndTotal(boardOrState) {
  if (Array.isArray(boardOrState)) {
    return americanExposedEndTotal({ board: boardOrState, byId: {} });
  }
  return americanExposedEndTotal(boardOrState ?? {});
}

/**
 * Points awarded for a single American play.
 *
 * @param {object} options
 * @param {object[]} [options.board]
 * @param {object} [options.state] - preferred: full post-place state
 * @param {boolean} [options.isOpening] - ignored (opening may score)
 * @returns {number}
 */
export function scoreAllFivesPlay(options = {}) {
  const state =
    options.state ??
    ({
      board: options.board ?? [],
      byId: options.byId ?? {},
      spinnerId: options.spinnerId ?? null,
      spinnerNorth: options.spinnerNorth ?? [],
      spinnerSouth: options.spinnerSouth ?? [],
    });
  return scoreAmericanPlay(state);
}

/**
 * Ruleset policy adapter — called after a successful place.
 * @param {object} options
 * @returns {number}
 */
export function allFivesScorePlay(options) {
  return scoreAllFivesPlay(options);
}

/**
 * Round a pip total to the nearest multiple of 5.
 * Non-positive / non-finite → 0. Half-up via Math.round (deterministic):
 * 1–2→0, 3–7→5, 8–12→10, 13→15, …
 * Midpoint examples: 2.5→3→ rounds as Math.round(2.5)=3 → 15 for value 12.5
 * but we only receive integers. For n.5 pip totals: Math.round uses
 * banker's rounding in some engines; for integers /5:
 * 12/5=2.4→2→10, 13/5=2.6→3→15. Explicit midpoint 7.5 not used (integer pips).
 *
 * @param {number} value
 * @returns {number}
 */
export function roundToNearestFive(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * End-of-round American award (domino-out or blocked).
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
