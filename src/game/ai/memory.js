/**
 * Tile memory / remaining-set inference for stronger AI levels.
 */

import { PIP_MAX } from "../constants.js";
import { generateSet } from "../tiles.js";

/**
 * @param {object} state
 * @param {number} aiIndex
 */
export function buildMemory(state, aiIndex) {
  const playedIds = new Set(state.board.map((tile) => tile.id));
  const aiHandIds = new Set(state.players[aiIndex].hand);
  const opponentIndex = aiIndex === 0 ? 1 : 0;
  const opponentHandSize = state.players[opponentIndex]?.hand.length ?? 0;
  const reserveSize = state.reserve.length;

  /** @type {string[]} */
  const unknownIds = [];
  for (const tile of generateSet()) {
    if (playedIds.has(tile.id) || aiHandIds.has(tile.id)) continue;
    unknownIds.push(tile.id);
  }

  /** How many unknown tiles contain each pip. */
  const matchingTileCounts = Array.from({ length: PIP_MAX + 1 }, () => 0);
  /** How many unknown half-faces show each pip. */
  const pipRemaining = Array.from({ length: PIP_MAX + 1 }, () => 0);

  for (const id of unknownIds) {
    const tile = state.byId[id];
    if (!tile) continue;
    pipRemaining[tile.a] += 1;
    pipRemaining[tile.b] += 1;
    matchingTileCounts[tile.a] += 1;
    if (tile.b !== tile.a) matchingTileCounts[tile.b] += 1;
  }

  return {
    playedIds,
    aiHandIds,
    unknownIds,
    pipRemaining,
    matchingTileCounts,
    opponentHandSize,
    reserveSize,
  };
}

/**
 * Approximate P(opponent can answer this pip).
 * @param {number} pip
 * @param {ReturnType<typeof buildMemory>} memory
 * @returns {number}
 */
export function opponentMatchProbability(pip, memory) {
  const matchingTiles = memory.matchingTileCounts[pip] ?? 0;
  if (matchingTiles <= 0 || memory.unknownIds.length === 0) return 0;

  const unknown = memory.unknownIds.length;
  const opp = memory.opponentHandSize;
  if (opp <= 0) return 0;
  if (opp >= unknown) return 1;

  const pNone = hypergeometricNone(unknown, matchingTiles, opp);
  return 1 - pNone;
}

/**
 * P(draws contain zero successes) in a hypergeometric draw.
 */
function hypergeometricNone(population, successStates, draws) {
  if (draws <= 0 || successStates <= 0) return 1;
  if (draws > population - successStates) return 0;

  let p = 1;
  for (let i = 0; i < draws; i += 1) {
    p *= (population - successStates - i) / (population - i);
  }
  return Math.max(0, Math.min(1, p));
}

/**
 * @param {object} state
 * @returns {string}
 */
export function boardFingerprint(state) {
  const chain = state.board.map((t) => `${t.id}:${t.left}${t.right}`).join(",");
  return `${state.round}|${state.currentPlayer}|${state.reserve.length}|${chain}`;
}
