/**
 * Compatibility engine id "allFives".
 *
 * American is the V1 All Fives-style Game Style. Saved matches that still
 * store rulesetId = "allFives" must keep count scoring (and spinner play)
 * rather than falling back to Classic pip scoring.
 */

import { americanRuleset } from "./american.js";
import { ALL_FIVES_MATCH_TARGET } from "../rules/allFivesScoring.js";

/** Legacy engine ruleset id — not a V1 picker style. */
export const ALL_FIVES_RULESET_ID = "allFives";

export { ALL_FIVES_MATCH_TARGET };

/**
 * Same live/round policies as American. Distinct id so old saves resolve.
 */
export const allFivesRuleset = Object.freeze({
  ...americanRuleset,
  id: ALL_FIVES_RULESET_ID,
  nameKey: "setup.gameStyle.allFives",
  descriptionKey: "setup.gameStyle.allFivesDescription",
  summaryKey: "setup.gameStyle.allFivesSummary",
  defaultTargetScore: ALL_FIVES_MATCH_TARGET,
});
