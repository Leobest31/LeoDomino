/**
 * Legacy ruleset — exact current LeoDomino V1 draw-dominoes behavior.
 * Engine id is "legacy"; UI exposes this as Classic (never show "legacy" to users).
 */

import { HAND_SIZE, PIP_MAX, TILE_COUNT } from "../constants.js";
import { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT } from "../players.js";
import { DEFAULT_TARGET_SCORE } from "../rules/constants.js";
import { calculateRoundPoints } from "../rules/scoring.js";
import { chooseStartingPlayer } from "../rules/start.js";

/** Engine ruleset id — not a user-facing label. */
export const LEGACY_RULESET_ID = "legacy";

/**
 * Frozen config + policies for today's shipped rules.
 * Future country styles register separately after authenticity verification.
 */
export const legacyRuleset = Object.freeze({
  id: LEGACY_RULESET_ID,
  version: 1,

  /** i18n — Classic labels (UI must not surface the word "legacy"). */
  nameKey: "setup.gameStyle.classic",
  descriptionKey: "setup.gameStyle.classicDescription",
  /** Ready for a short rules summary surface; optional UI consumer. */
  summaryKey: "setup.gameStyle.classicSummary",

  // —— Set / deal ——
  deckType: "double-six",
  pipMax: PIP_MAX,
  tileCount: TILE_COUNT,
  /** Tiles dealt per seat (constant for legacy). */
  handSize: HAND_SIZE,

  // —— Seats ——
  playerCount: Object.freeze({
    min: MIN_PLAYER_COUNT,
    max: MAX_PLAYER_COUNT,
    default: 2,
  }),
  /** No partnerships in legacy — free-for-all seat scores. */
  partnerships: null,

  // —— Opening ——
  /** Round 1: highest double, else highest tile. */
  round1Starter: "highestDoubleElseHighest",
  forceOpeningTile: true,
  laterRoundStarter: "previousWinner",
  freeOpenAfterRound1: true,

  // —— Legal placement ——
  boardModel: "linearTwoEnds",

  // —— Turn order (felt CCW via nextPlayerIndex; unchanged) ——
  turnOrder: "counterClockwise",

  // —— Draw / pass / blocked ——
  drawPolicy: "drawUntilPlayable",
  passPolicy: "passWhenReserveEmpty",
  blockedDetection: "allStuckOrConsecutivePasses",
  blockedWinnerMode: "lowestPips",
  blockedTieBreak: "lowerSeatIndex",

  // —— Scoring / match ——
  roundScoreMode: "sumOpponentPips",
  defaultTargetScore: DEFAULT_TARGET_SCORE,
  matchWinMode: "firstToReach",
  hudScoreFormat: "absolute",

  /**
   * Strategy hooks — used only where enum config is insufficient.
   * Keep these thin wrappers over existing pure functions.
   */
  policies: Object.freeze({
    chooseStartingPlayer,
    calculateRoundPoints,
  }),
});
