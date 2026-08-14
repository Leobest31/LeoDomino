/**
 * Legacy All Fives ruleset id — no longer a separate registered ruleset.
 *
 * American now owns All Fives count scoring (target 150). Saves / prefs that
 * still store "allFives" are migrated via coerceRulesetId → "american".
 */

export { ALL_FIVES_MATCH_TARGET } from "../rules/allFivesScoring.js";

/** @deprecated Legacy engine id; coerce / resolve map this to "american". */
export const ALL_FIVES_RULESET_ID = "allFives";
