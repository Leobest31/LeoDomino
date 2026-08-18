/**
 * Dominican Standard partnerships — physically opposite felt seats.
 *
 * Seat map (see players.js OPPONENT_FELT_POSITION / NEXT_PLAYER_4P):
 *   0 = bottom, 1 = top, 2 = left, 3 = right
 *
 * Opposite pairs (teams):
 *   Team 0: seats 0 ↔ 1 (bottom + top)
 *   Team 1: seats 2 ↔ 3 (left + right)
 *
 * Not 0+2 vs 1+3 — those are adjacent on the felt, not partners.
 */

import { handPipTotal } from "./scoring.js";

/** @type {ReadonlyArray<ReadonlyArray<number>>} */
export const DOMINICAN_TEAM_SEATS = Object.freeze([
  Object.freeze([0, 1]),
  Object.freeze([2, 3]),
]);

/**
 * Partner of a seat on a 4-player Dominican table.
 * @param {number} seat
 * @returns {number}
 */
export function partnerSeat(seat, playerCount = 4) {
  if (Math.floor(Number(playerCount)) === 2) {
    return Math.floor(Number(seat));
  }
  const s = Math.floor(Number(seat));
  if (s === 0) return 1;
  if (s === 1) return 0;
  if (s === 2) return 3;
  if (s === 3) return 2;
  throw new Error(`partnerSeat: invalid Dominican seat ${seat}`);
}

/**
 * Team id for a seat (0 = bottom/top, 1 = left/right).
 * @param {number} seat
 * @returns {0|1}
 */
export function teamIdForSeat(seat, playerCount = 4) {
  const n = Math.floor(Number(playerCount)) || 4;
  const s = Math.floor(Number(seat));
  if (n === 2) {
    if (s === 0) return 0;
    if (s === 1) return 1;
    throw new Error(`teamIdForSeat: invalid 2-player Dominican seat ${seat}`);
  }
  if (s === 0 || s === 1) return 0;
  if (s === 2 || s === 3) return 1;
  throw new Error(`teamIdForSeat: invalid Dominican seat ${seat}`);
}

/**
 * @returns {ReadonlyArray<ReadonlyArray<number>>}
 */
export function getDominicanTeams() {
  return DOMINICAN_TEAM_SEATS;
}

/**
 * @param {0|1|number} teamId
 * @returns {ReadonlyArray<number>}
 */
export function seatsOnTeam(teamId, playerCount = 4) {
  if (Math.floor(Number(playerCount)) === 2) {
    const id = teamId === 0 ? 0 : 1;
    return Object.freeze([id]);
  }
  const team = DOMINICAN_TEAM_SEATS[teamId];
  if (!team) throw new Error(`seatsOnTeam: invalid team ${teamId}`);
  return team;
}

/**
 * Lower seat index on a team (stable team representative).
 * @param {0|1|number} teamId
 * @returns {number}
 */
export function teamLeadSeat(teamId, playerCount = 4) {
  return seatsOnTeam(teamId, playerCount)[0];
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
export function arePartners(a, b) {
  try {
    return partnerSeat(a) === b;
  } catch {
    return false;
  }
}

/**
 * Sum remaining pips for both seats on a team.
 * @param {number} teamId
 * @param {{ hand: string[] }[]} players
 * @param {Record<string, object>} byId
 * @returns {number}
 */
export function teamPipTotal(teamId, players, byId) {
  const n = Array.isArray(players) ? players.length : 4;
  let total = 0;
  for (const seat of seatsOnTeam(teamId, n)) {
    total += handPipTotal(players[seat]?.hand ?? [], byId);
  }
  return total;
}
