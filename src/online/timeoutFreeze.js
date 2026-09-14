/**
 * Online timeout freeze-safety. The server remains the authority for winners.
 * This module only decides when the client may resolve, retry, or reconcile.
 */

import { isMatchOverView } from "./onlineTable.js";
import { isTurnDeadlineExpired } from "./turnTimeout.js";

export const TIMEOUT_RESOLVE_RETRY_MS = [750, 1500, 3000, 5000, 8000, 12000];
/**
 * After the local deadline is overdue this long, the client MUST fetch
 * authoritative state (getGameView). Does not invent moves or a second timer.
 *
 * Chosen as a middle ground, not arbitrary: the server-side sweep
 * (online-timeout-sweep) runs on a ~10s cron cadence, and a normal
 * resolve+Realtime round trip settles in well under a second — so 10s
 * gives the sweep/Realtime one full cycle to land the authoritative
 * outcome before the client forces its own refetch. Slow enough that a
 * healthy client isn't hitting the network every few seconds while merely
 * waiting out the sweep's own cadence; fast enough that a missed Realtime
 * event or lost ACK is still caught well within one turn's worth of time
 * (turn timer is 30s). During a *confirmed* outage this value is no longer
 * the gate — see the `serviceOutage` branch in planTimeoutTick, which
 * piggybacks on the outage system's own backoff clock instead so a stuck
 * "Waiting for timeout…" cannot itself become a source of hammering.
 */
export const TIMEOUT_PENDING_RECONCILE_MS = 10_000;

export function gameplayCodeFromInvoke(error, data) {
  const payload = readInvokeErrorPayload(error, data);
  const message = String(
    payload?.message || error?.message || error?.context?.message || ""
  );
  const code = payload?.code;
  if (code === "TIMEOUT_NOT_DUE" || /timeout not due/i.test(message)) {
    return { code: "TIMEOUT_NOT_DUE", message: message || "timeout not due", payload };
  }
  if (code === "STALE_VERSION" || /stale expected_version/i.test(message)) {
    return { code: "STALE_VERSION", message: message || "expected_version does not match", payload };
  }
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]+$/.test(code) && code !== "P0001") {
    return { code, message: message || code, payload };
  }
  return { code: code || null, message, payload };
}

export function readInvokeErrorPayload(error, data) {
  if (data?.error && typeof data.error === "object") return data.error;
  const ctx = error?.context;
  if (ctx?.error && typeof ctx.error === "object") return ctx.error;
  const body = ctx?.body;
  if (typeof body === "string" && body) {
    try {
      const parsed = JSON.parse(body);
      return parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed;
    } catch {
      /* ignore malformed function bodies */
    }
  }
  if (body && typeof body === "object") {
    return body.error && typeof body.error === "object" ? body.error : body;
  }
  return null;
}

export function isRetryableTimeoutError(error) {
  const code = error?.code;
  const message = String(error?.message || "");
  if (
    code === "STALE_VERSION" ||
    code === "TIMEOUT_NOT_DUE" ||
    code === "MATCH_NOT_ELIGIBLE" ||
    code === "ROUND_NOT_ACTIVE"
  ) {
    return true;
  }
  if (code === "P0001" || code === "GAMEPLAY_FAILED") {
    return /timeout not due|stale expected_version/i.test(message);
  }
  return /timeout not due|stale expected_version/i.test(message);
}

export function isFatalTimeoutError(error) {
  const code = error?.code;
  return code === "AUTH_REQUIRED" || code === "AUTH" || code === "NOT_A_PLAYER";
}

export function nextTimeoutRetryAt(attempt, nowMs = Date.now()) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, TIMEOUT_RESOLVE_RETRY_MS.length - 1));
  return nowMs + TIMEOUT_RESOLVE_RETRY_MS[index];
}

/** Logical timeout identity: same match + version + deadline cannot be hammered. */
export function timeoutResolveKey(view) {
  const matchId = view?.matchId != null ? String(view.matchId) : "";
  const version = Number.isInteger(Number(view?.version)) ? String(Number(view.version)) : "";
  const deadline = view?.turnDeadlineAt != null ? String(view.turnDeadlineAt) : "";
  if (!matchId || version === "") return "";
  return `${matchId}|${version}|${deadline}`;
}

/**
 * True when the client should drop timeout-pending soft-lock state after a
 * refresh/resolve. Authority advanced, terminal, or deadline no longer due.
 */
export function shouldClearTimeoutPending(previous, next, nowMs = Date.now(), monoMs) {
  if (!previous) return true;
  if (!next) return false;
  if (isMatchOverView(next) || next.phase !== "playing") return true;
  const prevV = Number(previous.version);
  const nextV = Number(next.version);
  if (Number.isInteger(prevV) && Number.isInteger(nextV) && nextV > prevV) return true;
  if (String(next.turnDeadlineAt ?? "") !== String(previous.turnDeadlineAt ?? "")) return true;
  if (!isTurnDeadlineExpired(next, nowMs, monoMs)) return true;
  return false;
}

export function planTimeoutTick(view, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const monoMs = options.monoMs;
  if (!view || options.inFlight) return { action: "idle" };
  if (isMatchOverView(view) || view.phase !== "playing") return { action: "idle", clearPending: true };
  if (!isTurnDeadlineExpired(view, nowMs, monoMs)) return { action: "idle", clearPending: true };

  const deadlineMs = Date.parse(String(view.turnDeadlineAt ?? ""));
  const overdueMs = Number.isFinite(deadlineMs) ? Math.max(0, nowMs - deadlineMs) : 0;
  const key = timeoutResolveKey(view);
  const alreadyAttempted = Boolean(key && options.attemptedKey === key);
  const retryAt = Number(options.retryNotBefore);
  const retryReady = Number.isFinite(retryAt) && nowMs >= retryAt;
  const lastReconcileAt = Number(options.lastReconcileAt);
  const reconcileDue =
    overdueMs >= TIMEOUT_PENDING_RECONCILE_MS &&
    (!Number.isFinite(lastReconcileAt) || nowMs - lastReconcileAt >= TIMEOUT_PENDING_RECONCILE_MS);

  // Outage: never client-resolve timeouts (server/sweep remains authority),
  // but still pull authoritative state so “Waiting for timeout…” cannot stick.
  // Gate on the SAME backoff clock the rest of the outage-retry system
  // already uses (serviceHealth's SERVICE_OUTAGE_RETRY_MS schedule, passed
  // in as outageRetryNotBefore) rather than the tighter normal-path
  // TIMEOUT_PENDING_RECONCILE_MS cadence — a confirmed outage must not
  // create a second, independent timer hammering Edge/DB on its own
  // schedule. Falls back to the normal cadence only when no outage clock
  // was supplied (e.g. older/test callers), so this stays backward safe.
  if (options.serviceOutage) {
    if (options.allowReconcile === false) return { action: "wait", overdueMs };
    const outageRetryAt = Number(options.outageRetryNotBefore);
    const outageGateReady = Number.isFinite(outageRetryAt) ? nowMs >= outageRetryAt : reconcileDue;
    const notTooSoon =
      !Number.isFinite(lastReconcileAt) || nowMs - lastReconcileAt >= TIMEOUT_PENDING_RECONCILE_MS;
    if (outageGateReady && notTooSoon) {
      return { action: "reconcile", overdueMs };
    }
    return { action: "wait", overdueMs };
  }

  // An active, already-due resolve retry takes priority over a passive
  // reconcile — resolveTurnTimeout is itself server-authoritative (CAS +
  // TIMEOUT_NOT_DUE-gated), so retrying it is not the client inventing an
  // outcome, just prompting the server sooner.
  if (alreadyAttempted && retryReady) {
    return { action: "resolve", overdueMs };
  }

  // Guaranteed authoritative refetch after grace — fires even without a
  // prior resolve attempt (missed Realtime/lost ACK can mean the client
  // never got a chance to attempt anything yet) and even if a resolve
  // retry isn't due yet. Server remains the clock; a soft-lock this stale
  // must not keep guessing via resolve when a refetch settles it directly.
  if (reconcileDue && options.allowReconcile !== false) {
    return { action: "reconcile", overdueMs };
  }

  if (alreadyAttempted) {
    return { action: "wait", overdueMs };
  }

  return { action: "resolve", overdueMs };
}

export function authoritativeMatchResult(view) {
  if (!view) return null;
  return {
    matchId: view.matchId ?? null,
    version: Number.isInteger(Number(view.version)) ? Number(view.version) : -1,
    phase: view.phase ?? null,
    status: view.status ?? null,
    matchWinnerSeat: view.matchWinnerSeat ?? null,
    finishReason: view.finishReason ?? view.roundResult?.reason ?? null,
    timeoutStrikes: Array.isArray(view.timeoutStrikes) ? view.timeoutStrikes.slice() : [0, 0],
  };
}

export function sameAuthoritativeMatchResult(left, right) {
  const a = authoritativeMatchResult(left);
  const b = authoritativeMatchResult(right);
  if (!a || !b) return false;
  return (
    a.matchId === b.matchId &&
    a.version === b.version &&
    a.phase === b.phase &&
    a.status === b.status &&
    a.matchWinnerSeat === b.matchWinnerSeat &&
    a.finishReason === b.finishReason &&
    a.timeoutStrikes[0] === b.timeoutStrikes[0] &&
    a.timeoutStrikes[1] === b.timeoutStrikes[1]
  );
}
