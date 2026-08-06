/**
 * Tile memory / remaining-set inference for stronger AI levels.
 * Supports 2–4 players: unknown tiles live in the reserve + every other hand.
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
  const playerCount = state.players.length;

  /** @type {number[]} */
  const otherHandSizes = [];
  for (let i = 0; i < playerCount; i += 1) {
    if (i === aiIndex) continue;
    otherHandSizes.push(state.players[i].hand.length);
  }

  // Closest-to-empty opponent — used for dump/block urgency.
  const opponentHandSize = otherHandSizes.length ? Math.min(...otherHandSizes) : 0;

  // Next seat in turn order (wraps); primary probability target.
  const nextIndex = (aiIndex + 1) % Math.max(playerCount, 1);
  const nextOpponentHandSize =
    nextIndex === aiIndex ? 0 : (state.players[nextIndex]?.hand.length ?? 0);

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
    otherHandSizes,
    opponentHandSize,
    nextOpponentHandSize,
    reserveSize,
    playerCount,
  };
}

/**
 * Approximate P(the focused opponent can answer this pip).
 * Defaults to the next seat in turn order (multiplayer-aware).
 * @param {number} pip
 * @param {ReturnType<typeof buildMemory>} memory
 * @param {number} [handSize] - override hand size used for the draw model
 * @returns {number}
 */
export function opponentMatchProbability(pip, memory, handSize) {
  const matchingTiles = memory.matchingTileCounts[pip] ?? 0;
  if (matchingTiles <= 0 || memory.unknownIds.length === 0) return 0;

  const unknown = memory.unknownIds.length;
  const opp =
    handSize != null
      ? handSize
      : (memory.nextOpponentHandSize ?? memory.opponentHandSize ?? 0);
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
