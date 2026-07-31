/**
 * Pip totals and round/match scoring.
 */

/**
 * Sum of both halves for a tile id.
 * @param {string} tileId
 * @param {Record<string, { a: number, b: number }>} byId
 * @returns {number}
 */
export function tilePipValue(tileId, byId) {
  const tile = byId[tileId];
  if (!tile) return 0;
  return tile.a + tile.b;
}

/**
 * Total pips remaining in a hand.
 * @param {string[]} hand
 * @param {Record<string, { a: number, b: number }>} byId
 * @returns {number}
 */
export function handPipTotal(hand, byId) {
  return hand.reduce((sum, id) => sum + tilePipValue(id, byId), 0);
}

/**
 * Compare tiles for Round 1 starter selection.
 * Doubles always beat non-doubles: 6-6 > 5-5 > … > 0-0.
 * Non-doubles: higher max pip, then higher min pip (6-5 > 6-4 > 6-3 …).
 *
 * @param {{ a: number, b: number, isDouble: boolean, id: string }} tile
 * @returns {number} Sort key (higher is better for starting)
 */
export function startingStrength(tile) {
  if (tile.isDouble) {
    return 1000 + tile.a;
  }
  return tile.b * 10 + tile.a;
}

/**
 * Award points after a round.
 * Domino out: winner scores the sum of all opponents' remaining pips.
 * Blocked: lowest hand wins and scores each opponent's pips (2p: opponent total).
 *
 * @param {object} options
 * @param {number} options.winnerIndex
 * @param {{ hand: string[] }[]} options.players
 * @param {Record<string, { a: number, b: number }>} options.byId
 * @returns {number}
 */
export function calculateRoundPoints({ winnerIndex, players, byId }) {
  let points = 0;
  for (let i = 0; i < players.length; i += 1) {
    if (i === winnerIndex) continue;
    points += handPipTotal(players[i].hand, byId);
  }
  return points;
}
