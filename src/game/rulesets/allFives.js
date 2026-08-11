/**
 * All Fives (American All Fives / count) ruleset — engine id "allFives".
 *
 * Play scoring: special opening (only exposed 10 → +10); later plays award
 * every positive multiple of 5 at full value. Target 150.
 *
 * Round-end: opponents' remaining pips rounded to nearest 5 (not Classic raw).
 * Deal / draw / pass chassis matches Classic draw-dominoes.
 */

import { legacyRuleset } from "./legacy.js";
import {
  ALL_FIVES_MATCH_TARGET,
  allFivesScorePlay,
  calculateAllFivesRoundPoints,
} from "../rules/allFivesScoring.js";

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

  nameKey: "setup.gameStyle.allFives",
  descriptionKey: "setup.gameStyle.allFivesDescription",
  summaryKey: "setup.gameStyle.allFivesSummary",

  supportedPlayerCounts: Object.freeze([2, 3, 4]),

  /**
   * Mid-play count scoring via scorePlay; round-end uses the All Fives
   * calculateRoundPoints policy (nearest-5), not Classic raw pips.
   */
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: ALL_FIVES_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "ofTarget",

  policies: Object.freeze({
    ...legacyRuleset.policies,
    scorePlay: allFivesScorePlay,
    calculateRoundPoints: calculateAllFivesRoundPoints,
  }),
});
