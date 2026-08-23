import { PHASE } from "./rules/constants.js";

/**
 * True when leaving the table would forfeit a real in-progress match.
 * MATCH_OVER is already resolved. An unplayed opening (empty board, round 1,
 * 0–0) is not yet forfeitable.
 *
 * @param {object | null | undefined} state
 * @returns {boolean}
 */
export function isMatchForfeitable(state) {
  if (!state || typeof state !== "object") return false;
  if (state.phase === PHASE.MATCH_OVER) return false;
  if (state.phase !== PHASE.PLAYING && state.phase !== PHASE.ROUND_OVER) {
    return false;
  }
  const boardLen = Array.isArray(state.board) ? state.board.length : 0;
  const round = Number(state.round) || 1;
  const scores = Array.isArray(state.scores) ? state.scores : [];
  const hasScore = scores.some((value) => Number(value) > 0);
  return boardLen > 0 || round > 1 || hasScore;
}

/**
 * Stable fingerprint so a second forfeit on the same match cannot record twice.
 * @param {object | null | undefined} state
 * @returns {string}
 */
export function forfeitFingerprint(state) {
  return `${state?.seed ?? "match"}:forfeit`;
}
