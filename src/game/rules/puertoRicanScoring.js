/**
 * Puerto Rican Standard team scoring (pip totals, match to 200).
 *
 * Domino-out: winning team scores opposing team remaining pips.
 * Trancado: lower team pips wins; score = opposing team remaining pips
 *   (NOT pip-difference).
 * Equal team pips: tie — zero points.
 * Capicúa / Chuchazo: registered stubs — no award in V1.
 */

import {
  puertoRicanPartnerSeat,
  puertoRicanTeamIdForSeat,
  puertoRicanTeamLeadSeat,
  puertoRicanTeamPipTotal,
} from "./puertoRicanTeams.js";

/** Match target for Puerto Rican Standard V1. */
export const PUERTO_RICAN_MATCH_TARGET = 200;

/**
 * Capicúa detection stub — always false; no bonus in V1.
 * @returns {boolean}
 */
export function isPuertoRicanCapicua() {
  return false;
}

/**
 * Chuchazo detection stub — always false; never awarded in V1.
 * @returns {boolean}
 */
export function isChuchazo() {
  return false;
}

/**
 * Domino-out and Trancado both award opposing team remaining pips.
 * Capicúa / Chuchazo bonuses are not added in V1.
 * (`reason` kept for ruleset policy signature parity.)
 *
 * @param {object} options
 * @param {number} options.winnerIndex
 * @param {{ hand: string[] }[]} options.players
 * @param {Record<string, object>} options.byId
 * @param {string} [options.reason]
 * @returns {number}
 */
export function calculatePuertoRicanRoundPoints({
  winnerIndex,
  players,
  byId,
}) {
  if (winnerIndex == null || winnerIndex < 0) return 0;

  const winTeam = puertoRicanTeamIdForSeat(winnerIndex);
  const loseTeam = winTeam === 0 ? 1 : 0;
  return puertoRicanTeamPipTotal(loseTeam, players, byId);
}

/**
 * Mirror team score onto both partner seats.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.points
 * @returns {number[]}
 */
export function applyPuertoRicanAfterRoundScoreUpdate({
  scores,
  winnerIndex,
  points,
}) {
  const next = scores.slice();
  if (winnerIndex == null || winnerIndex < 0 || !Number.isFinite(points)) {
    return next;
  }
  const partner = puertoRicanPartnerSeat(winnerIndex);
  const teamScore = (scores[winnerIndex] ?? 0) + points;
  next[winnerIndex] = teamScore;
  next[partner] = teamScore;
  return next;
}

/**
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} options.winnerIndex
 * @param {number} options.targetScore
 * @returns {boolean}
 */
export function isPuertoRicanMatchWon({ scores, winnerIndex, targetScore }) {
  if (winnerIndex == null || winnerIndex < 0) return false;
  return (scores[winnerIndex] ?? 0) >= targetScore;
}

/**
 * @param {object} options
 * @param {number} options.winnerIndex
 * @returns {number}
 */
export function resolvePuertoRicanMatchWinner({ winnerIndex }) {
  return puertoRicanTeamLeadSeat(puertoRicanTeamIdForSeat(winnerIndex));
}
