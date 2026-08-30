/**
 * Client-side online service health. Detects Data API / gateway outages
 * without treating gameplay domain errors as infrastructure failure.
 * The server remains the match authority.
 */

export const SERVICE_OUTAGE_HTTP = Object.freeze([502, 503, 504, 525]);
export const SERVICE_OUTAGE_CODE = "PGRST003";
export const SERVICE_UNAVAILABLE_CODE = "SERVICE_UNAVAILABLE";
export const SERVICE_OUTAGE_I18N_KEY = "online.serviceUnavailable";
export const ADMIN_BACKEND_I18N_KEY = "admin.backendUnavailable";

/** One transient network blip does not enter outage. Immediate 5xx / PGRST003 does. */
export const SERVICE_OUTAGE_NETWORK_THRESHOLD = 2;

export const SERVICE_OUTAGE_RETRY_MS = Object.freeze([4000, 8000, 16000, 24000]);

const DOMAIN_CODES = new Set([
  "TIMEOUT_NOT_DUE",
  "STALE_VERSION",
  "WRONG_TURN",
  "PASS_NOT_ALLOWED",
  "DRAW_NOT_ALLOWED",
  "CLIENT_TILE_ID_FORBIDDEN",
  "ILLEGAL_TILE",
  "ILLEGAL_PLACEMENT",
  "ADVANCE_NOT_ALLOWED",
  "NOT_A_PLAYER",
  "MATCH_NOT_ELIGIBLE",
  "MATCH_NOT_FOUND",
  "NO_SESSION",
  "AUTH_REQUIRED",
  "AUTH",
  "FORFEIT_FAILED",
  "ABORT_FAILED",
  "PLAYER_BUSY",
]);

function asText(value) {
  return value == null ? "" : String(value);
}

export function httpStatusFromError(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.cause?.status,
    error?.cause?.statusCode,
    error?.cause?.context?.status,
    error?.context?.status,
    error?.context?.statusCode,
    error?.context?.response?.status,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 100) return n;
  }
  const msg = `${asText(error?.message)} ${asText(error?.cause?.message)} ${asText(error?.code)}`;
  const match = msg.match(/\b(502|503|504|525)\b/);
  return match ? Number(match[1]) : 0;
}

export function postgrestCodeFromError(error) {
  const code = asText(error?.code || error?.cause?.code || error?.context?.code);
  if (code === SERVICE_OUTAGE_CODE) return code;
  const payload = error?.cause?.body || error?.context?.body || error?.message;
  const text = typeof payload === "string" ? payload : asText(payload?.code || payload?.message);
  if (text.includes(SERVICE_OUTAGE_CODE)) return SERVICE_OUTAGE_CODE;
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    const nested = parsed?.code || parsed?.error?.code;
    if (nested === SERVICE_OUTAGE_CODE) return SERVICE_OUTAGE_CODE;
  } catch {
    /* ignore */
  }
  return code;
}

export function isDomainGameplayError(error) {
  const code = asText(error?.code || error?.cause?.code);
  if (DOMAIN_CODES.has(code)) return true;
  const status = httpStatusFromError(error);
  if (status === 409) return true;
  if (status === 401 || status === 403) return true;
  if (code === "42501" || code === "28000") return true;
  return false;
}

export function isImmediateInfrastructureOutage(error) {
  if (!error || isDomainGameplayError(error)) return false;
  const status = httpStatusFromError(error);
  if (SERVICE_OUTAGE_HTTP.includes(status)) return true;
  if (postgrestCodeFromError(error) === SERVICE_OUTAGE_CODE) return true;
  const blob = `${asText(error?.message)} ${asText(error?.cause?.message)} ${asText(error?.details)}`;
  if (/delayed connect error|upstream connect error or disconnect/i.test(blob)) return true;
  return false;
}

export function isNetworkInfrastructureFailure(error) {
  if (!error || isDomainGameplayError(error) || isImmediateInfrastructureOutage(error)) {
    return false;
  }
  const name = asText(error?.name || error?.cause?.name);
  const msg = `${asText(error?.message)} ${asText(error?.cause?.message)}`.toLowerCase();
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (error?.timeout === true || error?.code === "TIMEOUT") return true;
  if (/failed to fetch|networkerror|load failed|aborted|the user aborted|timeout/i.test(msg)) {
    return true;
  }
  return false;
}

export function isInfrastructureOutageError(error) {
  return isImmediateInfrastructureOutage(error) || isNetworkInfrastructureFailure(error);
}

export function emptyServiceHealthState() {
  return {
    outage: false,
    consecutiveNetworkFailures: 0,
    retryAttempt: 0,
    retryNotBefore: 0,
  };
}

export function noteServiceFailure(state, error, nowMs = Date.now()) {
  const current = state && typeof state === "object" ? state : emptyServiceHealthState();
  if (isDomainGameplayError(error)) {
    return { ...current };
  }
  if (isImmediateInfrastructureOutage(error)) {
    return {
      outage: true,
      consecutiveNetworkFailures: 0,
      retryAttempt: current.outage ? current.retryAttempt : 0,
      retryNotBefore: current.outage ? current.retryNotBefore : nowMs + SERVICE_OUTAGE_RETRY_MS[0],
    };
  }
  if (isNetworkInfrastructureFailure(error)) {
    const consecutive = (current.consecutiveNetworkFailures || 0) + 1;
    const enter = consecutive >= SERVICE_OUTAGE_NETWORK_THRESHOLD;
    return {
      outage: enter || current.outage,
      consecutiveNetworkFailures: consecutive,
      retryAttempt: current.outage || enter ? current.retryAttempt : 0,
      retryNotBefore:
        current.outage || enter
          ? current.retryNotBefore || nowMs + SERVICE_OUTAGE_RETRY_MS[0]
          : current.retryNotBefore,
    };
  }
  return { ...current };
}

export function noteServiceSuccess(_state) {
  return emptyServiceHealthState();
}

export function planOutageHealthTick(state, nowMs = Date.now()) {
  if (!state?.outage) return { action: "idle" };
  const retryAt = Number(state.retryNotBefore) || 0;
  if (nowMs < retryAt) return { action: "wait" };
  return { action: "refresh" };
}

export function nextOutageRetryAt(attempt, nowMs = Date.now()) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, SERVICE_OUTAGE_RETRY_MS.length - 1));
  return nowMs + SERVICE_OUTAGE_RETRY_MS[index];
}

export function stampOutageRetry(state, nowMs = Date.now()) {
  const attempt = (Number(state?.retryAttempt) || 0) + 1;
  return {
    ...emptyServiceHealthState(),
    ...state,
    outage: true,
    retryAttempt: attempt,
    retryNotBefore: nextOutageRetryAt(attempt, nowMs),
  };
}

export function shouldSuppressTimeoutResolve(state) {
  return Boolean(state?.outage);
}

export function shouldDisableGameplayActions(state) {
  return Boolean(state?.outage);
}
