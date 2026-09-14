/**
 * Deadline lifecycle invariants for online play.
 * Server/DB time is authoritative; clients never invent deadlines.
 */

import { PHASE } from "./gameAuthority.js";
import { parseTimestampMs } from "./turnTimeout.js";

/**
 * Active playing session must have a non-null future (or just-set) deadline.
 * "Future" is relative to serverNow when provided; otherwise presence of a
 * parseable deadline is required after a non-terminal transition.
 */
export function assertActivePlayingDeadline(session, options = {}) {
  const phase = session?.phase ?? null;
  const status = session?.status ?? null;
  if (status === "match_over" || phase === PHASE.MATCH_OVER || phase === "matchOver") {
    return { ok: true, terminal: true };
  }
  if (status !== "playing" || (phase !== PHASE.PLAYING && phase !== "playing")) {
    return { ok: true, activePlaying: false };
  }
  const deadline = session?.turnDeadlineAt ?? session?.turn_deadline_at ?? null;
  if (deadline == null || deadline === "") {
    return { ok: false, reason: "missing_deadline" };
  }
  const deadlineMs = parseTimestampMs(deadline);
  if (deadlineMs == null) {
    return { ok: false, reason: "unparseable_deadline" };
  }
  const nowMs = parseTimestampMs(options.serverNow) ?? options.nowMs ?? null;
  if (nowMs != null && options.requireFuture === true && deadlineMs <= nowMs) {
    return { ok: false, reason: "deadline_not_future", deadlineMs, nowMs };
  }
  const seat = session?.currentSeat ?? session?.current_seat;
  if (seat !== 0 && seat !== 1) {
    return { ok: false, reason: "invalid_seat" };
  }
  const version = session?.version;
  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, reason: "invalid_version" };
  }
  return { ok: true, activePlaying: true, deadline, seat, version };
}

export function isTerminalForTimeoutSweep(match, session) {
  if (!match || match.status === "finished" || match.status === "aborted") return true;
  const phase = session?.phase;
  const status = session?.status;
  return (
    status === "match_over" ||
    phase === PHASE.MATCH_OVER ||
    phase === "matchOver" ||
    phase === "roundOver" ||
    status === "round_over"
  );
}
