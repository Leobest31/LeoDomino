/**
 * American Draw Dominoes ruleset.
 * Engine id is "american". The separate American Game Style option is
 * withdrawn; All Fives is the selectable US-style mode. This ruleset stays
 * registered so in-progress american saves can still resume.
 *
 * Audit: Classic/legacy already implements American Draw behavior
 * (double-six, hand 7, draw-until-playable, pass when empty, sum opponent
 * pips, first to 100, R1 highest double else highest). This ruleset is a
 * thin identity wrapper so American matches isolate behind their own id
 * without changing legacy.js or Haitian behavior.
 */

import { legacyRuleset } from "./legacy.js";

/** Engine ruleset id. */
export const AMERICAN_RULESET_ID = "american";

/**
 * Frozen config + policies — same gameplay as Classic/legacy, distinct id.
 */
export const americanRuleset = Object.freeze({
  ...legacyRuleset,
  id: AMERICAN_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.american",
  descriptionKey: "setup.gameStyle.americanDescription",
  summaryKey: "setup.gameStyle.americanSummary",

  /** Mirror Classic seats [2,3,4] with handSize 7 for isolation reuse. */
  supportedPlayerCounts: Object.freeze([2, 3, 4]),

  /** Shared legacy policy functions (chooseStartingPlayer, calculateRoundPoints). */
  policies: legacyRuleset.policies,
});
