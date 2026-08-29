/**
 * Online turn-timeout helpers. Authority is the server deadline, not local clocks.
 * Display remaining time is derived from turnDeadlineAt + serverNow, then
 * counted down with a monotonic clock so device time changes cannot extend it.
 */

export const TURN_TIMEOUT_MS = 60 * 1000;
export const TIMEOUT_WARNING_MS = 15 * 1000;
export const TIMEOUT_STRIKE_LIMIT = 3;

function monotonicNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function normalizeTimeoutStrikes(value) {
  const raw = Array.isArray(value) ? value : [];
  const a = Number(raw[0]);
  const b = Number(raw[1]);
  return [
    Number.isFinite(a) && a > 0 ? Math.floor(a) : 0,
    Number.isFinite(b) && b > 0 ? Math.floor(b) : 0,
  ];
}

export function parseTimestampMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function stampDeadlineReceipt(view, extras = {}) {
  if (!view || typeof view !== "object") return view;
  const serverNow = extras.serverNow ?? view.serverNow ?? new Date().toISOString();
  return {
    ...view,
    serverNow,
    deadlineReceivedAt: extras.deadlineReceivedAt ?? view.deadlineReceivedAt ?? serverNow,
    deadlineReceivedMono: extras.deadlineReceivedMono ?? view.deadlineReceivedMono ?? monotonicNow(),
  };
}

/**
 * Remaining ms from authoritative deadline.
 * Uses serverNow at snapshot time plus monotonic elapsed so a client clock
 * change cannot extend the displayed (or resolved) window beyond the server deadline.
 */
export function remainingTurnMs(view, nowMs = Date.now(), monotonicMs = monotonicNow()) {
  const deadlineMs = parseTimestampMs(view?.turnDeadlineAt);
  if (deadlineMs == null) return null;
  const serverNowMs = parseTimestampMs(view?.serverNow);
  const receivedAtMs = parseTimestampMs(view?.deadlineReceivedAt) ?? serverNowMs;
  const originMs = serverNowMs ?? receivedAtMs;
  if (originMs == null) {
    const remaining = Math.min(TURN_TIMEOUT_MS, deadlineMs - nowMs);
    return remaining > 0 ? remaining : 0;
  }
  const receivedMono = Number(view?.deadlineReceivedMono);
  const elapsed = Number.isFinite(receivedMono)
    ? Math.max(0, monotonicMs - receivedMono)
    : Math.max(0, nowMs - (receivedAtMs ?? originMs));
  const remaining = Math.min(TURN_TIMEOUT_MS, deadlineMs - originMs - elapsed);
  return remaining > 0 ? remaining : 0;
}

export function formatTurnSeconds(remainingMs) {
  if (remainingMs == null) return null;
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export function turnTimerTone(remainingMs) {
  if (remainingMs == null) return "normal";
  if (remainingMs <= 0) return "pending";
  if (remainingMs <= TIMEOUT_WARNING_MS) return "warning";
  return "normal";
}

export function isTurnDeadlineExpired(view, nowMs = Date.now(), monotonicMs = monotonicNow()) {
  if (view?.phase && view.phase !== "playing") return false;
  const remaining = remainingTurnMs(view, nowMs, monotonicMs);
  return remaining === 0;
}

export function isTimeoutMatchOver(view) {
  return view?.roundResult?.reason === "timeout" || view?.finishReason === "timeout";
}

export function timeoutStrikeFromView(view) {
  const strike = Number(view?.roundResult?.strike ?? view?.roundResult?.timeoutStrike);
  return Number.isFinite(strike) ? strike : null;
}
