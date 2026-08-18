/**
 * All Fives (American) blocked-round settlement.
 *
 * Distinct from live move scoring: this runs only after nobody can play.
 * Winners are every seat at the minimum remaining hand-pip total (ties kept).
 * The loser pool is the remaining pips of strictly higher seats only.
 *
 * Next-round starter is a separate choice among those winners:
 * highest remaining double, else strongest non-double, else a deterministic
 * CCW turn-order walk from the round starter. No randomness.
 */

import { nextPlayerIndex } from "../players.js";
import { ROUND_END_REASON } from "./constants.js";
import { handPipTotal } from "./scoring.js";
import {
  explainAllFivesRoundEnd,
  roundDownToFive,
  roundToNearestFive,
} from "./allFivesScoring.js";

/**
 * Absolute starter fallback: walk American CCW turn order (`nextPlayerIndex`)
 * starting at `roundStarterIndex` if set, otherwise `currentPlayer`, including
 * the origin seat. The first remaining candidate encountered starts.
 * Same saved state always yields the same starter.
 */
export const ALL_FIVES_BLOCKED_STARTER_FALLBACK = "ccwTurnOrderFromRoundStarter";

/**
 * @param {number[]|null|undefined} winnerIndices
 * @param {number|null|undefined} winnerIndex
 * @param {number} playerCount
 * @returns {number[]}
 */
export function normalizeWinnerIndices(
  winnerIndices,
  winnerIndex,
  playerCount
) {
  const count = Math.max(0, Math.floor(Number(playerCount)) || 0);
  if (Array.isArray(winnerIndices) && winnerIndices.length) {
    const unique = [];
    for (const raw of winnerIndices) {
      const index = Math.floor(Number(raw));
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < count &&
        !unique.includes(index)
      ) {
        unique.push(index);
      }
    }
    unique.sort((a, b) => a - b);
    return unique;
  }
  const single = Math.floor(Number(winnerIndex));
  if (Number.isInteger(single) && single >= 0 && single < count) {
    return [single];
  }
  return [];
}

/**
 * Remaining hand pip total per seat: sum of both halves of every tile.
 *
 * @param {{ hand?: string[] }[]} players
 * @param {Record<string, { a?: number, b?: number }>} byId
 * @returns {number[]}
 */
export function allFivesHandPipTotals(players = [], byId = {}) {
  return (players || []).map((player) =>
    handPipTotal(Array.isArray(player?.hand) ? player.hand : [], byId)
  );
}

/**
 * Seats whose remaining hand pips equal the table minimum.
 *
 * @param {number[]} pipTotals
 * @returns {number[]}
 */
export function allFivesBlockedWinnerIndices(pipTotals = []) {
  if (!Array.isArray(pipTotals) || pipTotals.length === 0) return [];
  let min = Infinity;
  for (const total of pipTotals) {
    if (total < min) min = total;
  }
  const winners = [];
  for (let i = 0; i < pipTotals.length; i += 1) {
    if (pipTotals[i] === min) winners.push(i);
  }
  return winners;
}

/**
 * Sum of remaining pips belonging to seats that did not win.
 *
 * @param {number[]} pipTotals
 * @param {number[]} winnerIndices
 * @returns {number}
 */
export function allFivesLoserPool(pipTotals = [], winnerIndices = []) {
  const winners = new Set(winnerIndices);
  let pool = 0;
  for (let i = 0; i < pipTotals.length; i += 1) {
    if (!winners.has(i)) pool += Number(pipTotals[i]) || 0;
  }
  return pool;
}

/**
 * Convert a loser pool into the per-winner All Fives blocked award.
 * One winner: existing nearest-5 increment. Two or more: floor to a 5-point
 * share. All tied (empty pool): 0.
 *
 * @param {number} loserPool
 * @param {number} winnerCount
 * @returns {number}
 */
export function allFivesBlockedAwardPerWinner(loserPool, winnerCount) {
  const n = Math.floor(Number(winnerCount)) || 0;
  const pool = Number(loserPool) || 0;
  if (n <= 0 || pool <= 0) return 0;
  if (n === 1) return roundToNearestFive(pool);
  return roundDownToFive(pool / n);
}

function tileSides(tile) {
  const a = Number(tile?.a) || 0;
  const b = Number(tile?.b) || 0;
  return { a, b, high: Math.max(a, b), low: Math.min(a, b) };
}

function isDoubleTile(tile) {
  if (!tile) return false;
  if (tile.isDouble === true) return true;
  return Number(tile.a) === Number(tile.b);
}

function highestDoublePip(hand, byId) {
  let best = -1;
  for (const id of hand || []) {
    const tile = byId[id];
    if (!isDoubleTile(tile)) continue;
    const pip = Number(tile.a) || 0;
    if (pip > best) best = pip;
  }
  return best;
}

/**
 * Non-double ranking key: (a+b, high, low), higher is stronger.
 *
 * @param {{ a?: number, b?: number }|null} tile
 * @returns {[number, number, number]|null}
 */
export function allFivesTileRankKey(tile) {
  if (!tile) return null;
  const { a, b, high, low } = tileSides(tile);
  return [a + b, high, low];
}

function compareRankKey(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function bestNonDoubleTile(hand, byId) {
  let best = null;
  let bestKey = null;
  for (const id of hand || []) {
    const tile = byId[id];
    if (!tile || isDoubleTile(tile)) continue;
    const key = allFivesTileRankKey(tile);
    if (compareRankKey(key, bestKey) > 0) {
      best = tile;
      bestKey = key;
    }
  }
  return best;
}

/**
 * First candidate in American CCW turn order, origin seat included.
 *
 * @param {number[]} candidates
 * @param {number} originIndex
 * @param {number} playerCount
 * @returns {number}
 */
export function firstWinnerInCcwTurnOrder(
  candidates,
  originIndex,
  playerCount
) {
  const set = new Set(candidates);
  const count = Math.max(1, Math.floor(Number(playerCount)) || 1);
  let seat = Math.floor(Number(originIndex));
  if (!Number.isInteger(seat) || seat < 0 || seat >= count) {
    seat = candidates[0] ?? 0;
  }
  for (let n = 0; n < count; n += 1) {
    if (set.has(seat)) return seat;
    seat = nextPlayerIndex(seat, count);
  }
  return candidates[0] ?? 0;
}

/**
 * Next-round starter among blocked-round winners. Scoring winners and the
 * starter are different: every tied winner still receives the share.
 *
 * Priority A: highest remaining double (6-6 … 0-0). A double beats any
 * non-double. If several winners hold that same highest double, fall through
 * to the CCW walk among those holders.
 * Priority B: if nobody holds a double, strongest remaining non-double by
 * (total, high side, low side) descending. Equal best-tile rank → CCW walk.
 * Fallback: {@link ALL_FIVES_BLOCKED_STARTER_FALLBACK}.
 *
 * @param {object} options
 * @param {number[]} options.winnerIndices
 * @param {{ hand?: string[] }[]} options.players
 * @param {Record<string, object>} options.byId
 * @param {number|null} [options.roundStarterIndex]
 * @param {number|null} [options.currentPlayer]
 * @returns {number}
 */
export function chooseAllFivesBlockedNextStarter({
  winnerIndices = [],
  players = [],
  byId = {},
  roundStarterIndex = null,
  currentPlayer = null,
} = {}) {
  const winners = normalizeWinnerIndices(
    winnerIndices,
    null,
    players.length
  );
  if (winners.length === 1) return winners[0];
  if (winners.length === 0) {
    return roundStarterIndex ?? currentPlayer ?? 0;
  }

  const origin =
    roundStarterIndex != null ? roundStarterIndex : currentPlayer ?? winners[0];

  let bestDouble = -1;
  /** @type {number[]} */
  const doubleHolders = [];
  for (const seat of winners) {
    const pip = highestDoublePip(players[seat]?.hand, byId);
    if (pip < 0) continue;
    if (pip > bestDouble) {
      bestDouble = pip;
      doubleHolders.length = 0;
      doubleHolders.push(seat);
    } else if (pip === bestDouble) {
      doubleHolders.push(seat);
    }
  }
  if (bestDouble >= 0) {
    if (doubleHolders.length === 1) return doubleHolders[0];
    return firstWinnerInCcwTurnOrder(doubleHolders, origin, players.length);
  }

  let bestKey = null;
  /** @type {number[]} */
  const tileHolders = [];
  for (const seat of winners) {
    const tile = bestNonDoubleTile(players[seat]?.hand, byId);
    const key = allFivesTileRankKey(tile);
    if (!key) continue;
    const cmp = compareRankKey(key, bestKey);
    if (bestKey == null || cmp > 0) {
      bestKey = key;
      tileHolders.length = 0;
      tileHolders.push(seat);
    } else if (cmp === 0) {
      tileHolders.push(seat);
    }
  }
  if (tileHolders.length === 1) return tileHolders[0];
  if (tileHolders.length > 1) {
    return firstWinnerInCcwTurnOrder(tileHolders, origin, players.length);
  }
  return firstWinnerInCcwTurnOrder(winners, origin, players.length);
}

/**
 * Full blocked-round settlement for All Fives.
 *
 * @param {object} options
 * @param {{ id?: string, hand: string[] }[]} options.players
 * @param {Record<string, object>} options.byId
 * @param {number|null} [options.roundStarterIndex]
 * @param {number|null} [options.currentPlayer]
 * @returns {{
 *   pipTotals: number[],
 *   minHandPips: number,
 *   winnerIndices: number[],
 *   loserPool: number,
 *   awardPerWinner: number,
 *   nextStarterIndex: number,
 *   tied: boolean,
 *   winnerIndex: number|null
 * }}
 */
export function settleAllFivesBlocked({
  players = [],
  byId = {},
  roundStarterIndex = null,
  currentPlayer = null,
} = {}) {
  const pipTotals = allFivesHandPipTotals(players, byId);
  const winnerIndices = allFivesBlockedWinnerIndices(pipTotals);
  const explanation = explainAllFivesRoundEnd({
    winnerIndex: winnerIndices.length === 1 ? winnerIndices[0] : null,
    winnerIndices,
    players,
    byId,
    reason: ROUND_END_REASON.BLOCKED,
  });
  const nextStarterIndex = chooseAllFivesBlockedNextStarter({
    winnerIndices,
    players,
    byId,
    roundStarterIndex,
    currentPlayer,
  });
  return {
    pipTotals,
    minHandPips: winnerIndices.length ? pipTotals[winnerIndices[0]] : 0,
    winnerIndices,
    loserPool: explanation.rawTotal,
    awardPerWinner: explanation.awarded,
    nextStarterIndex,
    tied: winnerIndices.length !== 1,
    winnerIndex: winnerIndices.length === 1 ? winnerIndices[0] : null,
  };
}

/**
 * Ruleset policy adapter for a blocked All Fives table.
 *
 * @param {object} options
 * @param {object} options.state
 * @returns {{
 *   tied: boolean,
 *   winnerIndex: number|null,
 *   winnerIndices: number[],
 *   nextStarterIndex: number,
 *   awardPerWinner: number,
 *   loserPool: number
 * }}
 */
export function resolveAllFivesBlockedOutcome({ state } = {}) {
  const settlement = settleAllFivesBlocked({
    players: state?.players,
    byId: state?.byId,
    roundStarterIndex: state?.roundStarterIndex,
    currentPlayer: state?.currentPlayer,
  });
  return {
    tied: settlement.tied,
    winnerIndex: settlement.winnerIndex,
    winnerIndices: settlement.winnerIndices,
    nextStarterIndex: settlement.nextStarterIndex,
    awardPerWinner: settlement.awardPerWinner,
    loserPool: settlement.loserPool,
  };
}
