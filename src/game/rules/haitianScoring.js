/**
 * Haitian match-point scoring — not Classic pip totals.
 *
 * Round awards (each is exactly one won part):
 *   Normal win / blocked win / Dekabès → +1
 *
 * Scores accumulate. There is no opponent reset to zero.
 *
 * Match win: first player to reach target (default 4).
 * Valid finals include 4–0, 4–1, 4–2, and 4–3.
 */

/**
 * @param {object} [options]
 * @param {string} [options.reason]
 * @param {boolean} [options.isDekabes]
 * @returns {number}
 */
export function calculateHaitianRoundPoints() {
  return 1;
}

/**
 * Add round points to the winner only. Opponent scores are left unchanged.
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
  const next = scores.slice();
  next[winnerIndex] += points;
  return next;
}

/**
 * Haitian match is won when the round winner reaches the target (first to 4).
 * Opponent score may be 0, 1, 2, or 3.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.targetScore
 * @returns {boolean}
 */
export function isHaitianMatchWon({ scores, winnerIndex, targetScore }) {
  return (scores[winnerIndex] ?? 0) >= targetScore;
}
