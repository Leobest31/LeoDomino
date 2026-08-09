/**
 * Haitian ruleset — verified V1 regional style (match points, Dekabès, 6-6 open).
 * Engine id is "haitian"; UI exposes 🇭🇹 Haitian / Ayisyen.
 */

import { HAND_SIZE, PIP_MAX, TILE_COUNT } from "../constants.js";
import { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT } from "../players.js";
import { isDekabes } from "../rules/dekabes.js";
import {
  applyHaitianAfterRoundScoreUpdate,
  calculateHaitianRoundPoints,
  isHaitianMatchWon,
} from "../rules/haitianScoring.js";
import { chooseDoubleSixStarter } from "../rules/haitianStart.js";

/** Engine ruleset id. */
export const HAITIAN_RULESET_ID = "haitian";

/** Match target for Haitian shutout win (must also hold opponent at 0). */
export const HAITIAN_MATCH_TARGET = 4;

/**
 * Frozen config + policies for Haitian V1.
 * 3-player deal is intentionally unsupported until research is finalized.
 */
export const haitianRuleset = Object.freeze({
  id: HAITIAN_RULESET_ID,
  version: 1,

  nameKey: "setup.gameStyle.haitian",
  descriptionKey: "setup.gameStyle.haitianDescription",
  summaryKey: "setup.gameStyle.haitianSummary",

  // —— Set / deal ——
  deckType: "double-six",
  pipMax: PIP_MAX,
  tileCount: TILE_COUNT,
  handSize: HAND_SIZE,

  // —— Seats ——
  playerCount: Object.freeze({
    min: MIN_PLAYER_COUNT,
    max: MAX_PLAYER_COUNT,
    default: 2,
  }),
  /** 3-player Haitian dealing not verified for V1 — Setup disables this pair. */
  supportedPlayerCounts: Object.freeze([2, 4]),
  partnerships: null,

  // —— Opening ——
  /** Round 1: seat holding 6-6 must open with it. */
  round1Starter: "doubleSix",
  forceOpeningTile: true,
  /** Re-deal when 6-6 sits in the reserve (2p) so Round 1 can open legally. */
  redealUntilOpeningTile: true,
  laterRoundStarter: "previousWinner",
  freeOpenAfterRound1: true,

  // —— Legal placement ——
  boardModel: "linearTwoEnds",

  // —— Turn order (match logic; board geometry untouched) ——
  turnOrder: "counterClockwise",

  // —— Draw / pass / blocked ——
  drawPolicy: "drawUntilPlayable",
  passPolicy: "passWhenReserveEmpty",
  blockedDetection: "allStuckOrConsecutivePasses",
  blockedWinnerMode: "lowestPips",
  /** Same engine policy as legacy — not a new silent Haitian invent. */
  blockedTieBreak: "lowerSeatIndex",

  // —— Scoring / match ——
  roundScoreMode: "matchPoints",
  defaultTargetScore: HAITIAN_MATCH_TARGET,
  /**
   * Shutout-to-target: afterRoundScoreUpdate resets opponents, then
   * isMatchWon requires winner >= target AND all opponents at 0 (4–0).
   */
  matchWinMode: "shutoutToTarget",
  /** HUD: show seat score as "X / 4". */
  hudScoreFormat: "ofTarget",

  policies: Object.freeze({
    chooseStartingPlayer: chooseDoubleSixStarter,
    calculateRoundPoints: calculateHaitianRoundPoints,
    afterRoundScoreUpdate: applyHaitianAfterRoundScoreUpdate,
    isMatchWon: isHaitianMatchWon,
    isDekabes,
  }),
});
