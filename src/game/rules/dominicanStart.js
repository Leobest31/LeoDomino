/**
 * Dominican Standard opening / next-round starter policies.
 *
 * Round 1: seat holding 6-6 must open (reuse double-six starter).
 * Later rounds after a win: previous round winner opens freely.
 * After blocked team win: prefer block causer if on winning team; else
 * lowest seat index on the winning team.
 * After blocked equal-pip tie: previous round starter again (no score).
 */

import { chooseDoubleSixStarter } from "./haitianStart.js";
import { tileId } from "../tiles.js";
import {
  partnerSeat,
  seatsOnTeam,
  teamIdForSeat,
  teamPipTotal,
} from "./dominicanTeams.js";

export const DOMINICAN_OPENING_TILE_ID = tileId(6, 6);

/** Re-export shared 6-6 holder lookup for Round 1. */
export { chooseDoubleSixStarter as chooseDominicanRound1Starter };

/**
 * Deterministic next starter after a blocked team win.
 *
 * @param {object} options
 * @param {number} options.winningTeamId
 * @param {number|null|undefined} options.blockCauserIndex - seat that passed into the block
 * @returns {number} seat index on the winning team
 */
export function chooseDominicanBlockedStarter({
  winningTeamId,
  blockCauserIndex,
}) {
  const seats = seatsOnTeam(winningTeamId);
  if (
    blockCauserIndex != null &&
    Number.isInteger(blockCauserIndex) &&
    teamIdForSeat(blockCauserIndex) === winningTeamId
  ) {
    return blockCauserIndex;
  }
  // Explicit fallback: smallest seat index on the winning team.
  return Math.min(...seats);
}

/**
 * Dominican team-block outcome (engine policy).
 * Lower team pips win; equal pips → noScore tie when configured.
 * Starter: block causer if on winning team, else lowest seat on that team.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {number|null|undefined} options.blockCauserIndex
 * @param {string} [options.blockedTieBreak]
 * @returns {{ tied: boolean, winnerIndex: number|null, nextStarterIndex: number|null }}
 */
export function resolveDominicanTeamBlockedOutcome({
  state,
  blockCauserIndex = null,
  blockedTieBreak,
}) {
  const team0 = teamPipTotal(0, state.players, state.byId);
  const team1 = teamPipTotal(1, state.players, state.byId);
  if (team0 === team1) {
    if (blockedTieBreak === "noScore") {
      return {
        tied: true,
        winnerIndex: null,
        nextStarterIndex: state.roundStarterIndex ?? null,
      };
    }
    throw new Error(
      `Unsupported blockedTieBreak for Dominican team pips: ${blockedTieBreak}`
    );
  }
  const winningTeamId = team0 < team1 ? 0 : 1;
  const nextStarterIndex = chooseDominicanBlockedStarter({
    winningTeamId,
    blockCauserIndex,
  });
  return { tied: false, winnerIndex: nextStarterIndex, nextStarterIndex };
}

/**
 * Resolve who opens the next round from a finished round result.
 *
 * @param {object} options
 * @param {object} options.roundResult
 * @param {number} [options.roundStarterIndex] - who opened the round that just ended
 * @returns {number}
 */
export function chooseDominicanNextRoundStarter({
  roundResult,
  roundStarterIndex,
}) {
  if (!roundResult) {
    throw new Error("chooseDominicanNextRoundStarter: roundResult required");
  }
  if (roundResult.tied || roundResult.winnerIndex == null) {
    const again =
      roundResult.nextStarterIndex ??
      roundStarterIndex ??
      null;
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
export function dominicanPartnerOf(seat) {
  return partnerSeat(seat);
}
