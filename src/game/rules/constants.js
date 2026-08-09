/** Draw-dominoes rules constants. */

/** Default points required to win a match. */
export const DEFAULT_TARGET_SCORE = 100;

/** Match / round lifecycle phases. */
export const PHASE = Object.freeze({
  PLAYING: "playing",
  ROUND_OVER: "roundOver",
  MATCH_OVER: "matchOver",
});

/** How a round ended. */
export const ROUND_END_REASON = Object.freeze({
  DOMINO: "domino",
  BLOCKED: "blocked",
  /** Haitian: final non-double playable on both open ends. */
  DEKABES: "dekabes",
});
