/**
 * Haitian match-point scoring — not Classic pip totals.
 *
 * Round awards:
 *   Normal win / blocked win → +1
 *   Dekabès → +2
 *
 * After each round (reset rule):
 *   Opponent(s) reset to 0, then the winner receives the round points.
 *   Scores cannot both be non-zero after a round under this rule.
 *
 * Match win (4–0 shutout):
 *   Winner score >= target (default 4) AND every opponent is at 0.
 *   Points are applied first (no cap); e.g. 3–0 + Dekabès → 5–0 still wins.
 */

import { ROUND_END_REASON } from "./constants.js";

/**
 * @param {object} options
 * @param {string} [options.reason]
 * @param {boolean} [options.isDekabes]
 * @returns {number}
 */
export function calculateHaitianRoundPoints({ reason, isDekabes } = {}) {
  if (isDekabes || reason === ROUND_END_REASON.DEKABES) return 2;
  return 1;
}

/**
 * Reset every non-winner to 0, then add round points to the winner.
 * Winner streak accumulates; only opponents are wiped.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.points
 * @returns {number[]}
 */
export function applyHaitianAfterRoundScoreUpdate({
  scores,
  winnerIndex,
  points,
}) {
  const next = scores.map((score, index) => (index === winnerIndex ? score : 0));
  next[winnerIndex] += points;
  return next;
}

/**
 * Haitian match is won only on a shutout at/above target (e.g. 4–0).
 * score >= target alone is not enough when any opponent is non-zero
 * (legacy/migration scores may briefly look like that until the next round).
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.targetScore
 * @returns {boolean}
 */
export function isHaitianMatchWon({ scores, winnerIndex, targetScore }) {
  const winnerScore = scores[winnerIndex] ?? 0;
  if (winnerScore < targetScore) return false;
  for (let i = 0; i < scores.length; i += 1) {
    if (i !== winnerIndex && scores[i] !== 0) return false;
  }
  return true;
}
