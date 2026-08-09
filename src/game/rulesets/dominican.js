/**
 * Dominican Standard ruleset — partnership drawless double-six.
 * Engine id is "dominican"; UI exposes 🇩🇴 Dominican.
 *
 * Separate ruleset (Haitian-style), not an American/legacy rename.
 * Capicúa is an architecture stub only — no bonus awarded.
 */

import { HAND_SIZE, PIP_MAX, TILE_COUNT } from "../constants.js";
import {
  applyDominicanAfterRoundScoreUpdate,
  calculateDominicanRoundPoints,
  DOMINICAN_MATCH_TARGET,
  isCapicua,
  isDominicanMatchWon,
  resolveDominicanMatchWinner,
} from "../rules/dominicanScoring.js";
import {
  chooseDominicanNextRoundStarter,
  chooseDominicanRound1Starter,
  DOMINICAN_OPENING_TILE_ID,
  resolveDominicanTeamBlockedOutcome,
} from "../rules/dominicanStart.js";
import { getDominicanTeams } from "../rules/dominicanTeams.js";

/** Engine ruleset id. */
export const DOMINICAN_RULESET_ID = "dominican";

export { DOMINICAN_MATCH_TARGET, DOMINICAN_OPENING_TILE_ID };

/**
 * Frozen config + policies for Dominican Standard V1.
 * Exactly 4 players; opposite-seat partnerships; no boneyard draws.
 */
export const dominicanRuleset = Object.freeze({
  id: DOMINICAN_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.dominican",
  descriptionKey: "setup.gameStyle.dominicanDescription",
  summaryKey: "setup.gameStyle.dominicanSummary",

  // —— Set / deal ——
  deckType: "double-six",
  pipMax: PIP_MAX,
  tileCount: TILE_COUNT,
  handSize: HAND_SIZE,

  // —— Seats ——
  playerCount: Object.freeze({
    min: 4,
    max: 4,
    default: 4,
  }),
  /** Dominican Standard is 4-hand partnership only. */
  supportedPlayerCounts: Object.freeze([4]),
  /** Physically opposite partners: 0↔1 and 2↔3 (see dominicanTeams.js). */
  partnerships: "oppositeSeats",
  teams: getDominicanTeams(),

  // —— Opening ——
  /** Round 1: seat holding 6-6 must open with it. */
  round1Starter: "doubleSix",
  forceOpeningTile: true,
  /** 4p deals all 28 tiles so 6-6 is always held; redeal kept for safety. */
  redealUntilOpeningTile: true,
  laterRoundStarter: "dominicanPolicy",
  freeOpenAfterRound1: true,

  // —— Legal placement ——
  boardModel: "linearTwoEnds",

  // —— Turn order (felt CCW via nextPlayerIndex; unchanged) ——
  turnOrder: "counterClockwise",

  // —— Draw / pass / blocked ——
  drawPolicy: "none",
  passPolicy: "passWhenNoMove",
  blockedDetection: "allStuckOrConsecutivePasses",
  blockedWinnerMode: "lowestTeamPips",
  /** Equal team pips → tie, zero points, same starter again. */
  blockedTieBreak: "noScore",

  // —— Scoring / match ——
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: DOMINICAN_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "absolute",

  /**
   * Capicúa architecture stub — detection always false; no bonus.
   * Future authenticity work can enable without reshaping the ruleset shape.
   */
  capicua: Object.freeze({
    enabled: false,
    awardBonus: false,
  }),

  policies: Object.freeze({
    chooseStartingPlayer: chooseDominicanRound1Starter,
    chooseNextRoundStarter: chooseDominicanNextRoundStarter,
    calculateRoundPoints: calculateDominicanRoundPoints,
    afterRoundScoreUpdate: applyDominicanAfterRoundScoreUpdate,
    isMatchWon: isDominicanMatchWon,
    resolveMatchWinner: resolveDominicanMatchWinner,
    resolveTeamBlockedOutcome: resolveDominicanTeamBlockedOutcome,
    isCapicua,
  }),
});
