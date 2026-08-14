/**
 * American Draw Dominoes with Spinner + open-end count scoring.
 * Engine id is "american"; UI exposes American (country US).
 *
 * Chassis: Classic draw-dominoes (double-six, hand 7, draw-until-playable,
 * pass when empty, R1 highest double else highest).
 *
 * Spinner: first double played becomes the Spinner (up to four arms).
 * Scoring: open-end count after every legal play (doubles count both halves).
 * Opening plays may score. Match target: 200.
 * Round-end: opponents' remaining pips rounded to nearest 5.
 */

import { legacyRuleset } from "./legacy.js";
import {
  allFivesScorePlay,
  calculateAllFivesRoundPoints,
} from "../rules/allFivesScoring.js";
import { AMERICAN_MATCH_TARGET } from "../rules/americanSpinner.js";

/** Engine ruleset id. */
export const AMERICAN_RULESET_ID = "american";

export { AMERICAN_MATCH_TARGET };

/**
 * Frozen config — Classic draw chassis + American Spinner count policies.
 */
export const americanRuleset = Object.freeze({
  ...legacyRuleset,
  id: AMERICAN_RULESET_ID,
  version: 2,

  nameKey: "setup.gameStyle.american",
  descriptionKey: "setup.gameStyle.americanDescription",
  summaryKey: "setup.gameStyle.americanSummary",

  supportedPlayerCounts: Object.freeze([2, 3, 4]),

  /** American uses Spinner-capable board topology. */
  boardModel: "americanSpinner",

  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: AMERICAN_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "ofTarget",

  /** Enables Spinner arms + four-end legal moves in the engine. */
  usesSpinner: true,

  policies: Object.freeze({
    ...legacyRuleset.policies,
    scorePlay: allFivesScorePlay,
    calculateRoundPoints: calculateAllFivesRoundPoints,
  }),
});
