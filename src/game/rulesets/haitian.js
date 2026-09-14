/**
 * Haitian ruleset — verified V1 regional style (match points, Dekabès,
 * highest-double round-1 open — no fixed tile).
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
import { chooseStartingPlayer } from "../rules/start.js";

/** Engine ruleset id. */
export const HAITIAN_RULESET_ID = "haitian";

/** Match target: first player to this many won parts wins. */
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
  /**
   * Round 1: highest double across both hands opens (else highest tile by
   * normal ranking). Shared by legacy/Haitian/American — no fixed tile.
   */
  round1Starter: "highestDoubleElseHighest",
  forceOpeningTile: true,
  /** The highest-double/highest-tile chooser always finds a starter — never redeal. */
  redealUntilOpeningTile: false,
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
   * First-to-target: scores accumulate (no reset). Dekabès is one part.
   * isMatchWon: winner score >= 4. Finals may be 4–0 through 4–3.
   */
  matchWinMode: "firstToReach",
  /** HUD: show seat score as "X / 4". */
  hudScoreFormat: "ofTarget",

  policies: Object.freeze({
    chooseStartingPlayer,
    calculateRoundPoints: calculateHaitianRoundPoints,
    afterRoundScoreUpdate: applyHaitianAfterRoundScoreUpdate,
    isMatchWon: isHaitianMatchWon,
    isDekabes,
  }),
});
