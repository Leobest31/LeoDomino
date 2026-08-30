/**
 * Online timeout freeze-safety. The server remains the authority for winners.
 * This module only decides when the client may resolve, retry, or reconcile.
 */

import { isMatchOverView } from "./onlineTable.js";
import { isTurnDeadlineExpired } from "./turnTimeout.js";

export const TIMEOUT_RESOLVE_RETRY_MS = [750, 1500, 3000, 5000];

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

export function planTimeoutTick(view, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const monoMs = options.monoMs;
  if (options.serviceOutage) return { action: "idle" };
  if (!view || options.inFlight) return { action: "idle" };
  if (isMatchOverView(view) || view.phase !== "playing") return { action: "idle" };
  if (!isTurnDeadlineExpired(view, nowMs, monoMs)) return { action: "idle" };
  const retryAt = Number(options.retryNotBefore);
  if (Number.isFinite(retryAt) && nowMs < retryAt) return { action: "wait" };
  return { action: "resolve" };
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
