/**
 * Puerto Rican Standard ruleset — partnership drawless double-six.
 * Engine id is "puertorican"; UI exposes 🇵🇷 Puerto Rican.
 *
 * Separate ruleset — does not inherit Dominican blocked scoring/starter.
 * Capicúa and Chuchazo are architecture stubs only in V1.
 */

import { HAND_SIZE, PIP_MAX, TILE_COUNT } from "../constants.js";
import {
  applyPuertoRicanAfterRoundScoreUpdate,
  calculatePuertoRicanRoundPoints,
  isChuchazo,
  isPuertoRicanCapicua,
  isPuertoRicanMatchWon,
  PUERTO_RICAN_MATCH_TARGET,
  resolvePuertoRicanMatchWinner,
} from "../rules/puertoRicanScoring.js";
import {
  choosePuertoRicanNextRoundStarter,
  choosePuertoRicanRound1Starter,
  PUERTO_RICAN_OPENING_TILE_ID,
  resolvePuertoRicanTeamBlockedOutcome,
} from "../rules/puertoRicanStart.js";
import { getPuertoRicanTeams } from "../rules/puertoRicanTeams.js";

/** Engine ruleset id. */
export const PUERTO_RICAN_RULESET_ID = "puertorican";

export { PUERTO_RICAN_MATCH_TARGET, PUERTO_RICAN_OPENING_TILE_ID };

/**
 * Frozen config + policies for Puerto Rican Standard V1.
 */
export const puertoRicanRuleset = Object.freeze({
  id: PUERTO_RICAN_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.puertorican",
  descriptionKey: "setup.gameStyle.puertoricanDescription",
  summaryKey: "setup.gameStyle.puertoricanSummary",

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
  supportedPlayerCounts: Object.freeze([4]),
  /** Opposite partners: 0↔1 and 2↔3 (LeoDomino felt geometry). */
  partnerships: "oppositeSeats",
  teams: getPuertoRicanTeams(),

  // —— Opening ——
  round1Starter: "doubleSix",
  forceOpeningTile: true,
  redealUntilOpeningTile: true,
  laterRoundStarter: "puertoRicanPolicy",
  freeOpenAfterRound1: true,

  // —— Legal placement ——
  boardModel: "linearTwoEnds",

  // —— Turn order ——
  turnOrder: "counterClockwise",

  // —— Draw / pass / blocked ——
  drawPolicy: "none",
  passPolicy: "passWhenNoMove",
  blockedDetection: "allStuckOrConsecutivePasses",
  blockedWinnerMode: "lowestTeamPips",
  blockedTieBreak: "noScore",

  // —— Scoring / match ——
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: PUERTO_RICAN_MATCH_TARGET,
  matchWinMode: "firstToReach",
  hudScoreFormat: "absolute",

  /**
   * Capicúa — concept registered; no award in V1.
   */
  capicua: Object.freeze({
    enabled: false,
    awardBonus: false,
    value: 0,
  }),

  /**
   * Chuchazo — concept registered; never awarded in V1.
   */
  chuchazo: Object.freeze({
    enabled: false,
    value: 0,
  }),

  policies: Object.freeze({
    chooseStartingPlayer: choosePuertoRicanRound1Starter,
    chooseNextRoundStarter: choosePuertoRicanNextRoundStarter,
    calculateRoundPoints: calculatePuertoRicanRoundPoints,
    afterRoundScoreUpdate: applyPuertoRicanAfterRoundScoreUpdate,
    isMatchWon: isPuertoRicanMatchWon,
    resolveMatchWinner: resolvePuertoRicanMatchWinner,
    resolveTeamBlockedOutcome: resolvePuertoRicanTeamBlockedOutcome,
    isCapicua: isPuertoRicanCapicua,
    isChuchazo,
  }),
});
