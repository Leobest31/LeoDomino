/**
 * All Fives count ruleset — engine id "allFives".
 *
 * Product-facing Game Style is American. This id is the internal match
 * ruleset so in-progress allFives saves resume without a rename.
 *
 * Play scoring: exact terminal-end total; award that total only when it is
 * >= 10 and a multiple of 5. Live 5 does not score. No live-play rounding.
 * Target 200.
 *
 * Round-end (domino-out): opponents' remaining pips rounded to nearest 5.
 * Blocked: every seat at the minimum remaining hand-pip total wins; loser
 * pips are shared (nearest-5 for one winner, floored 5-point shares for ties).
 * Deal / draw / pass chassis matches Classic draw-dominoes.
 */

import { legacyRuleset } from "./legacy.js";
import {
  ALL_FIVES_MATCH_TARGET,
  allFivesScorePlay,
  explainAllFivesScore,
  explainAllFivesRoundEnd,
  calculateAllFivesRoundPoints,
} from "../rules/allFivesScoring.js";
import { resolveAllFivesBlockedOutcome } from "../rules/allFivesBlocked.js";

/** Engine ruleset id. */
export const ALL_FIVES_RULESET_ID = "allFives";

export { ALL_FIVES_MATCH_TARGET };

/**
 * Frozen config — Classic chassis + All Fives count / round-end policies.
 */
export const allFivesRuleset = Object.freeze({
  ...legacyRuleset,
  id: ALL_FIVES_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.american",
  descriptionKey: "setup.gameStyle.americanDescription",
  summaryKey: "setup.gameStyle.americanSummary",

  supportedPlayerCounts: Object.freeze([2, 3, 4]),

  /**
   * Mid-play count scoring via scorePlay; round-end uses the All Fives
   * calculateRoundPoints policy (nearest-5), not Classic raw pips.
   */
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: ALL_FIVES_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "ofTarget",
  spinner: true,
  /** Felt counting of remaining hands before HUD/next-round. */
  roundSummary: true,

  policies: Object.freeze({
    ...legacyRuleset.policies,
    scorePlay: allFivesScorePlay,
    explainPlayScore: explainAllFivesScore,
    explainRoundEnd: explainAllFivesRoundEnd,
    calculateRoundPoints: calculateAllFivesRoundPoints,
    resolveBlockedOutcome: resolveAllFivesBlockedOutcome,
  }),
});
