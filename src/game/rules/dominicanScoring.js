/**
 * Dominican Standard team scoring (pip totals, match to 100).
 *
 * Domino-out: winning player's team scores the opposing team's remaining pips.
 * Blocked: lower team pip total wins; score = difference.
 * Equal team pips: tie — zero points (no fabricated winner).
 * Capicúa: architecture stub only — no bonus.
 */

import { ROUND_END_REASON } from "./constants.js";
import {
  partnerSeat,
  teamIdForSeat,
  teamLeadSeat,
  teamPipTotal,
} from "./dominicanTeams.js";

/** Match target for Dominican Standard. */
export const DOMINICAN_MATCH_TARGET = 100;

/**
 * Capicúa detection stub — always false; no bonus in V1.
 * @returns {boolean}
 */
export function isCapicua() {
  return false;
}

/**
 * @param {object} options
 * @param {number} options.winnerIndex
 * @param {{ hand: string[] }[]} options.players
 * @param {Record<string, object>} options.byId
 * @param {string} [options.reason]
 * @returns {number}
 */
export function calculateDominicanRoundPoints({
  winnerIndex,
  players,
  byId,
  reason,
}) {
  if (winnerIndex == null || winnerIndex < 0) return 0;

  const n = Array.isArray(players) ? players.length : 4;
  const winTeam = teamIdForSeat(winnerIndex, n);
  const loseTeam = winTeam === 0 ? 1 : 0;
  const winPips = teamPipTotal(winTeam, players, byId);
  const losePips = teamPipTotal(loseTeam, players, byId);

  if (reason === ROUND_END_REASON.BLOCKED) {
    return Math.max(0, losePips - winPips);
  }

  // Domino-out (and any non-blocked win): opposing team remaining pips.
  return losePips;
}

/**
 * Mirror team score onto both partner seats after a scoring round.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.points
 * @returns {number[]}
 */
export function applyDominicanAfterRoundScoreUpdate({
  scores,
  winnerIndex,
  points,
}) {
  const next = scores.slice();
  if (winnerIndex == null || winnerIndex < 0 || !Number.isFinite(points)) {
    return next;
  }
  if (scores.length === 2) {
    next[winnerIndex] = (scores[winnerIndex] ?? 0) + points;
    return next;
  }
  const partner = partnerSeat(winnerIndex, scores.length);
  const teamScore = (scores[winnerIndex] ?? 0) + points;
  next[winnerIndex] = teamScore;
  next[partner] = teamScore;
  return next;
}

/**
 * First team to reach target — use mirrored seat scores.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.targetScore
 * @returns {boolean}
 */
export function isDominicanMatchWon({ scores, winnerIndex, targetScore }) {
  if (winnerIndex == null || winnerIndex < 0) return false;
  return (scores[winnerIndex] ?? 0) >= targetScore;
}

/**
 * Clear team winner seat for HUD / career (lower seat on winning team).
 *
 * @param {object} options
 * @param {number} options.winnerIndex
 * @returns {number}
 */
export function resolveDominicanMatchWinner({ winnerIndex, scores }) {
  const n = Array.isArray(scores) ? scores.length : 4;
  return teamLeadSeat(teamIdForSeat(winnerIndex, n), n);
}
