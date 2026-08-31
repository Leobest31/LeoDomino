/**
 * Pre-start join grace — 3 minutes after accept, before both players have
 * joined. Distinct from the 60-second in-match turn timeout.
 *
 * Authoritative expiry lives in SQL (resolve_join_timeout). These helpers
 * classify state and format UX. They must never invent a winner, RP change,
 * or local cancellation.
 */

export const JOIN_GRACE_MS = 3 * 60 * 1000;
export const JOIN_TIMEOUT_REASON = "join_timeout";

export const ACTIVE_MATCH_STATUSES = Object.freeze(["ready", "playing"]);
export const TERMINAL_MATCH_STATUSES = Object.freeze(["finished", "aborted"]);
export const TERMINAL_FINISH_REASONS = Object.freeze([
  "completed",
  "forfeit",
  "aborted",
  "timeout",
  "join_timeout",
]);

function readFinishReason(match) {
  const raw = match?.finishReason ?? match?.finish_reason;
  return typeof raw === "string" && raw ? raw : "";
}

/**
 * Authoritative terminal match. Status finished/aborted is enough.
 * finish_reason / match-over viewer fields also count so a stuck ready/playing
 * row cannot be resumed after forfeit, timeout, or completion.
 *
 * @param {object|null|undefined} match
 */
export function isTerminalMatch(match) {
  if (!match) return false;
  const status = match.status;
  if (TERMINAL_MATCH_STATUSES.includes(status) || status === "match_over") return true;
  if (match.sessionStatus === "match_over") return true;
  if (match.phase === "matchOver") return true;
  const reason = readFinishReason(match);
  return Boolean(reason) && TERMINAL_FINISH_REASONS.includes(reason);
}

/**
 * True only for a reserved/live match the signed-in player may enter again.
 * Terminal matches are never resumable.
 *
 * @param {object|null|undefined} match
 */
export function isResumableMatch(match) {
  if (!match?.id) return false;
  if (isTerminalMatch(match)) return false;
  return ACTIVE_MATCH_STATUSES.includes(match.status);
}

/**
 * @param {string|null|undefined} reservedAtIso accepted_at or match.created_at
 * @returns {string|null}
 */
export function joinDeadlineFromIso(reservedAtIso) {
  const t = Date.parse(reservedAtIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + JOIN_GRACE_MS).toISOString();
}

/**
 * @param {string|null|undefined} deadlineIso
 * @param {number} [now]
 * @returns {number|null} remaining ms; negative if past
 */
export function remainingJoinMs(deadlineIso, now = Date.now()) {
  const t = Date.parse(deadlineIso);
  if (!Number.isFinite(t)) return null;
  return t - now;
}

/**
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function formatJoinCountdown(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const clamped = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Reserved/accepted but not started: occupancy exists and both seats have
 * not yet joined. Without joined_at (pre-migration), "not started" means
 * no game_session row yet.
 *
 * @param {{ status?: string, hasGameSession?: boolean, gameplayStarted?: boolean }} match
 */
export function isReservedNotStarted(match) {
  if (!match) return false;
  if (match.gameplayStarted === true) return false;
  if (match.gameplayStarted === false) return true;
  if (!ACTIVE_MATCH_STATUSES.includes(match.status)) return false;
  return match.hasGameSession !== true;
}

/**
 * Gameplay started: first enter installed game_session AND (after migration)
 * both occupancy.joined_at are set. Pre-migration: game_session exists.
 *
 * @param {{ status?: string, hasGameSession?: boolean, gameplayStarted?: boolean }} match
 */
export function isGameplayStarted(match) {
  if (!match) return false;
  if (match.gameplayStarted === true) return true;
  if (match.gameplayStarted === false) return false;
  return match.hasGameSession === true && match.status === "playing";
}

/**
 * Server-rule classifier. Does not mutate match state.
 *
 * @param {{
 *   now?: number,
 *   deadlineAt?: string|null,
 *   gameplayStarted?: boolean,
 *   matchStatus?: string|null,
 * }} input
 * @returns {"started"|"terminal"|"waiting"|"join_timeout_due"|"unknown"}
 */
export function classifyJoinWait(input = {}) {
  const status = input.matchStatus;
  if (status === "aborted" || status === "finished") return "terminal";
  if (input.gameplayStarted === true) return "started";
  const deadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadline)) return "unknown";
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  if (now >= deadline) return "join_timeout_due";
  return "waiting";
}

/**
 * Idempotent join-timeout resolution. Models the SQL rule for tests.
 * Never awards a winner or RP.
 *
 * @param {{
 *   currentStatus?: string,
 *   finishReason?: string|null,
 *   gameplayStarted?: boolean,
 *   now?: number,
 *   deadlineAt?: string|null,
 * }} input
 */
export function applyJoinTimeoutResolution(input = {}) {
  const status = input.currentStatus;
  if (status === "aborted" || status === "finished") {
    return {
      status,
      finishReason: input.finishReason || (status === "aborted" ? JOIN_TIMEOUT_REASON : input.finishReason),
      changed: false,
      idempotent: true,
      winner: null,
      loser: null,
      rpChange: false,
      ratedWlChange: false,
    };
  }
  if (input.gameplayStarted === true) {
    return {
      status,
      finishReason: input.finishReason ?? null,
      changed: false,
      idempotent: true,
      reason: "started",
      winner: null,
      loser: null,
      rpChange: false,
      ratedWlChange: false,
    };
  }
  const phase = classifyJoinWait(input);
  if (phase !== "join_timeout_due") {
    return {
      status,
      finishReason: input.finishReason ?? null,
      changed: false,
      idempotent: true,
      reason: phase,
      winner: null,
      loser: null,
      rpChange: false,
      ratedWlChange: false,
    };
  }
  return {
    status: "aborted",
    finishReason: JOIN_TIMEOUT_REASON,
    changed: true,
    idempotent: false,
    winner: null,
    loser: null,
    rpChange: false,
    ratedWlChange: false,
  };
}

/**
 * Join vs timeout race: whichever transition commits first on the locked
 * match row wins. The loser is a no-op.
 *
 * @param {"join"|"timeout"} first
 * @param {object} [input]
 */
export function raceJoinAndTimeout(first, input = {}) {
  if (first === "join") {
    const started = applyJoinTimeoutResolution({
      ...input,
      gameplayStarted: true,
      currentStatus: "playing",
    });
    const timeoutAfter = applyJoinTimeoutResolution({
      ...input,
      currentStatus: "playing",
      gameplayStarted: true,
    });
    return { first: "join", started, timeoutAfter, finalStatus: "playing" };
  }
  const timeout = applyJoinTimeoutResolution({
    ...input,
    gameplayStarted: false,
    currentStatus: input.currentStatus || "ready",
  });
  const joinAfter = timeout.changed
    ? { rejected: true, status: timeout.status }
    : { rejected: false, status: input.currentStatus };
  return { first: "timeout", timeout, joinAfter, finalStatus: timeout.status };
}
