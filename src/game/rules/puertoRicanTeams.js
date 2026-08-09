/**
 * Puerto Rican Standard partnerships — physically opposite felt seats.
 *
 * Same LeoDomino geometry as Dominican Standard (independent module):
 *   Team 0: seats 0 ↔ 1 (bottom + top)
 *   Team 1: seats 2 ↔ 3 (left + right)
 */

import { handPipTotal } from "./scoring.js";

/** @type {ReadonlyArray<ReadonlyArray<number>>} */
export const PUERTO_RICAN_TEAM_SEATS = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([2, 3]),
]);

/**
 * @param {number} seat
 * @returns {number}
 */
export function puertoRicanPartnerSeat(seat) {
  const s = Math.floor(Number(seat));
  if (s === 0) return 1;
  if (s === 1) return 0;
  if (s === 2) return 3;
  if (s === 3) return 2;
  throw new Error(`puertoRicanPartnerSeat: invalid seat ${seat}`);
}

/**
 * @param {number} seat
 * @returns {0|1}
 */
export function puertoRicanTeamIdForSeat(seat) {
  const s = Math.floor(Number(seat));
  if (s === 0 || s === 1) return 0;
  if (s === 2 || s === 3) return 1;
  throw new Error(`puertoRicanTeamIdForSeat: invalid seat ${seat}`);
}

/**
 * @returns {ReadonlyArray<ReadonlyArray<number>>}
 */
export function getPuertoRicanTeams() {
  return PUERTO_RICAN_TEAM_SEATS;
}

/**
 * @param {0|1|number} teamId
 * @returns {ReadonlyArray<number>}
 */
export function puertoRicanSeatsOnTeam(teamId) {
  const team = PUERTO_RICAN_TEAM_SEATS[teamId];
  if (!team) throw new Error(`puertoRicanSeatsOnTeam: invalid team ${teamId}`);
  return team;
}

/**
 * @param {0|1|number} teamId
 * @returns {number}
 */
export function puertoRicanTeamLeadSeat(teamId) {
  return puertoRicanSeatsOnTeam(teamId)[0];
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function puertoRicanArePartners(a, b) {
  try {
    return puertoRicanPartnerSeat(a) === b;
  } catch {
    return false;
  }
}

/**
 * @param {number} teamId
 * @param {{ hand: string[] }[]} players
 * @param {Record<string, object>} byId
 * @returns {number}
 */
export function puertoRicanTeamPipTotal(teamId, players, byId) {
  let total = 0;
  for (const seat of puertoRicanSeatsOnTeam(teamId)) {
    total += handPipTotal(players[seat]?.hand ?? [], byId);
  }
  return total;
}
