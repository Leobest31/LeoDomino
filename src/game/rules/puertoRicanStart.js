/**
 * Puerto Rican Standard opening / next-round / Trancado starter policies.
 *
 * Round 1: seat holding 6-6 must open.
 * After domino-out: the player who went out opens freely.
 * After blocked win: on winning team, lowest individual remaining pips;
 *   individual-pip tie → lower seat index (NOT Dominican block-causer).
 * After tied block: previous round starter again.
 */

import { chooseDoubleSixStarter } from "./haitianStart.js";
import { tileId } from "../tiles.js";
import { handPipTotal } from "./scoring.js";
import {
  puertoRicanPartnerSeat,
  puertoRicanSeatsOnTeam,
  puertoRicanTeamPipTotal,
} from "./puertoRicanTeams.js";

export const PUERTO_RICAN_OPENING_TILE_ID = tileId(6, 6);

/** Re-export shared 6-6 holder lookup for Round 1. */
export { chooseDoubleSixStarter as choosePuertoRicanRound1Starter };

/**
 * Next starter after a blocked team win (Puerto Rican V1).
 *
 * @param {object} options
 * @param {number} options.winningTeamId
 * @param {{ hand: string[] }[]} options.players
 * @param {Record<string, object>} options.byId
 * @returns {number}
 */
export function choosePuertoRicanBlockedStarter({
  winningTeamId,
  players,
  byId,
}) {
  const seats = puertoRicanSeatsOnTeam(winningTeamId);
  let bestSeat = seats[0];
  let bestPips = Infinity;
  for (const seat of seats) {
    const pips = handPipTotal(players[seat]?.hand ?? [], byId);
    if (pips < bestPips || (pips === bestPips && seat < bestSeat)) {
      bestPips = pips;
      bestSeat = seat;
    }
  }
  return bestSeat;
}

/**
 * Puerto Rican team-block / Trancado outcome (engine policy).
 *
 * @param {object} options
 * @param {object} options.state
 * @param {string} [options.blockedTieBreak]
 * @returns {{ tied: boolean, winnerIndex: number|null, nextStarterIndex: number|null }}
 */
export function resolvePuertoRicanTeamBlockedOutcome({
  state,
  blockedTieBreak,
}) {
  const team0 = puertoRicanTeamPipTotal(0, state.players, state.byId);
  const team1 = puertoRicanTeamPipTotal(1, state.players, state.byId);
  if (team0 === team1) {
    if (blockedTieBreak === "noScore") {
      return {
        tied: true,
        winnerIndex: null,
        nextStarterIndex: state.roundStarterIndex ?? null,
      };
    }
    throw new Error(
      `Unsupported blockedTieBreak for Puerto Rican team pips: ${blockedTieBreak}`
    );
  }
  const winningTeamId = team0 < team1 ? 0 : 1;
  const nextStarterIndex = choosePuertoRicanBlockedStarter({
    winningTeamId,
    players: state.players,
    byId: state.byId,
  });
  return { tied: false, winnerIndex: nextStarterIndex, nextStarterIndex };
}

/**
 * @param {object} options
 * @param {object} options.roundResult
 * @param {number} [options.roundStarterIndex]
 * @returns {number}
 */
export function choosePuertoRicanNextRoundStarter({
  roundResult,
  roundStarterIndex,
}) {
  if (!roundResult) {
    throw new Error("choosePuertoRicanNextRoundStarter: roundResult required");
  }
  if (roundResult.tied || roundResult.winnerIndex == null) {
    const again =
      roundResult.nextStarterIndex ?? roundStarterIndex ?? null;
    if (again == null || again < 0) {
      throw new Error("Tied round requires previous starter as next opener");
    }
    return again;
  }
  if (roundResult.nextStarterIndex != null) {
    return roundResult.nextStarterIndex;
  }
  return roundResult.winnerIndex;
}

/**
 * @param {number} seat
 * @returns {number}
 */
export function puertoRicanPartnerOf(seat) {
  return puertoRicanPartnerSeat(seat);
}
