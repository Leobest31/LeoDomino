/**
 * American Game Style — All Fives-style count scoring.
 * Engine id is "american". V1 Play vs LeoBest exposes this as American 🇺🇸.
 *
 * Live play: sum currently exposed terminal ends after every legal placement.
 * Award that exact total when it is a positive multiple of 5 (5, 10, 15, …).
 * An exposed double counts both halves. Spinner branches use the All Fives
 * terminal topology. Target 150.
 *
 * Deal / draw / pass chassis matches Classic. Scoring does not.
 */

import { legacyRuleset } from "./legacy.js";
import {
  allFivesScorePlay,
  explainAllFivesScore,
  explainAllFivesRoundEnd,
  calculateAllFivesRoundPoints,
} from "../rules/allFivesScoring.js";

/** Engine ruleset id. */
export const AMERICAN_RULESET_ID = "american";

/** Cumulative match target for American (All Fives-style) scoring. */
export const AMERICAN_MATCH_TARGET = 150;

/**
 * Frozen config — Classic chassis + All Fives count / round-end policies.
 */
export const americanRuleset = Object.freeze({
  ...legacyRuleset,
  id: AMERICAN_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.american",
  descriptionKey: "setup.gameStyle.americanDescription",
  summaryKey: "setup.gameStyle.americanSummary",

  supportedPlayerCounts: Object.freeze([2, 3, 4]),

  /**
   * Mid-play count scoring via scorePlay; round-end uses All Fives
   * nearest-5 remaining pips, not Classic raw pip sums.
   */
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: AMERICAN_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "ofTarget",
  spinner: true,
  roundSummary: true,

  policies: Object.freeze({
    ...legacyRuleset.policies,
    scorePlay: allFivesScorePlay,
    explainPlayScore: explainAllFivesScore,
    explainRoundEnd: explainAllFivesRoundEnd,
    calculateRoundPoints: calculateAllFivesRoundPoints,
  }),
});
