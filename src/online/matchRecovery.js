/**
 * Online match recovery decisions.
 *
 * Occupancy / getMyActiveMatch is the live authority for "am I in a match?"
 * Positive terminal evidence (status, finish_reason, session match_over,
 * noted forfeit/completion) wins over stale client snapshots.
 *
 * Service unavailable is NOT terminal: keep last known resumable recovery.
 */

import { isResumableMatch, isTerminalMatch } from "./joinTimeout.js";
import { isNotedTerminalMatch, noteTerminalMatch } from "./terminalMatchMemory.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";

/**
 * True when a match object (or a previously noted id) must not be resumed.
 * Observing a terminal payload records that id so a later outage cannot
 * resurrect a playing snapshot of the same match.
 *
 * @param {object|null|undefined} match
 * @param {Storage} [storage]
 */
export function canRecoverMatch(match, storage = globalThis.sessionStorage) {
  if (!match?.id) return false;
  if (isNotedTerminalMatch(match.id, storage)) return false;
  if (isTerminalMatch(match)) {
    noteTerminalMatch(match.id, storage);
    return false;
  }
  return isResumableMatch(match);
}

/**
 * Creator whose request is already accepted must leave Waiting and enter
 * Match Ready when occupancy has a resumable match. Occupancy-none and
 * terminal matches must not take this path.
 *
 * @param {object|null|undefined} own
 * @param {object|null|undefined} occupancyMatch
 */
export function shouldPromoteAcceptedToMatchReady(own, occupancyMatch) {
  return own?.status === "accepted" && canRecoverMatch(occupancyMatch);
}

/**
 * Hydrate/get-row failures that mean "this match is gone", not "service down".
 * Outage / unknown must not take this path.
 *
 * @param {unknown} error
 */
export function isMissingActiveMatchRow(error) {
  if (!error || isInfrastructureOutageError(error)) return false;
  const code = String(error.code || error.cause?.code || "");
  if (code === "PGRST116" || code === "NOT_FOUND") return true;
  const msg = `${error.message || ""} ${error.cause?.message || ""} ${error.details || ""}`;
  return /JSON object requested|contains 0 rows|0 rows|match not found/i.test(msg);
}

/**
 * Find Match / Home occupancy reconciliation.
 *
 * occupancyUnknown: getMyActiveMatch threw (outage / unknown).
 * occupancyMatch: getMyActiveMatch result when the call succeeded (null = none).
 * lastKnown: in-page Match Ready snapshot.
 * hydratedAcceptedMatch: own accepted request hydrate — ONLY consulted when
 * occupancy is unknown. Authoritative occupancy-none must not reopen a match
 * from a leftover accepted match_request row.
 *
 * @param {{
 *   occupancyUnknown?: boolean,
 *   occupancyMatch?: object|null,
 *   lastKnown?: object|null,
 *   acceptedMatchId?: string|null,
 *   hydratedAcceptedMatch?: object|null,
 * }} input
 * @returns {{ kind: "resume"|"keep"|"clear", match: object|null, source: string }}
 */
export function decideMatchRecovery(input = {}) {
  const occupancyUnknown = Boolean(input.occupancyUnknown);
  const occupancyMatch = input.occupancyMatch ?? null;
  const lastKnown = input.lastKnown ?? null;
  const acceptedMatchId =
    typeof input.acceptedMatchId === "string" && input.acceptedMatchId
      ? input.acceptedMatchId
      : null;
  const hydratedAcceptedMatch = input.hydratedAcceptedMatch;

  if (!occupancyUnknown) {
    if (canRecoverMatch(occupancyMatch)) {
      return { kind: "resume", match: occupancyMatch, source: "occupancy" };
    }
    return { kind: "clear", match: null, source: "occupancy_none" };
  }

  if (canRecoverMatch(lastKnown)) {
    return { kind: "keep", match: lastKnown, source: "outage_last_known" };
  }

  if (acceptedMatchId && isNotedTerminalMatch(acceptedMatchId)) {
    return { kind: "clear", match: null, source: "accepted_noted_terminal" };
  }

  if (hydratedAcceptedMatch !== undefined) {
    if (canRecoverMatch(hydratedAcceptedMatch)) {
      return { kind: "resume", match: hydratedAcceptedMatch, source: "accepted_unknown" };
    }
    if (hydratedAcceptedMatch?.id && isTerminalMatch(hydratedAcceptedMatch)) {
      noteTerminalMatch(hydratedAcceptedMatch.id);
      return { kind: "clear", match: null, source: "accepted_terminal" };
    }
  }

  if (lastKnown?.id && !canRecoverMatch(lastKnown)) {
    return { kind: "clear", match: null, source: "outage_last_known_terminal" };
  }

  return { kind: "keep", match: null, source: "outage_unknown" };
}

/**
 * App startup sessionStorage restore.
 * Successful occupancy-none / mismatch / noted terminal → clear stored id.
 * Outage → keep stored id (do not auto-enter, do not destroy recovery).
 *
 * @param {{
 *   savedMatchId?: string|null,
 *   occupancyUnknown?: boolean,
 *   occupancyMatch?: object|null,
 * }} input
 */
export function decideHomeSessionRecovery(input = {}) {
  const savedMatchId =
    typeof input.savedMatchId === "string" && input.savedMatchId ? input.savedMatchId : null;
  if (!savedMatchId) {
    return { enter: false, clearSession: false, match: null, source: "no_saved" };
  }
  if (isNotedTerminalMatch(savedMatchId)) {
    return { enter: false, clearSession: true, match: null, source: "noted_terminal" };
  }
  if (input.occupancyUnknown) {
    return { enter: false, clearSession: false, match: null, source: "outage" };
  }
  const occupancyMatch = input.occupancyMatch ?? null;
  if (canRecoverMatch(occupancyMatch) && occupancyMatch.id === savedMatchId) {
    return { enter: true, clearSession: false, match: occupancyMatch, source: "occupancy" };
  }
  return { enter: false, clearSession: true, match: null, source: "not_resumable" };
}

/**
 * Home occupancy poll failure: drop last known only when it is terminal/noted.
 * Otherwise keep it (outage fail-safe).
 *
 * @param {object|null|undefined} lastKnown
 */
export function shouldDropLastKnownOnOccupancyFailure(lastKnown) {
  if (!lastKnown?.id) return false;
  return !canRecoverMatch(lastKnown);
}
