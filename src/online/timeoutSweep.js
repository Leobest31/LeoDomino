/**
 * Internal timeout-sweep auth and candidate shaping.
 * Game rules stay in applyTimeoutResolution / applyTimeoutAndCommit.
 */

export const TIMEOUT_SWEEP_HEADER = "x-timeout-sweep-secret";

export function readSweepSecret(env = {}) {
  const secret = env.TIMEOUT_SWEEP_SECRET ?? env.timeoutSweepSecret;
  return typeof secret === "string" ? secret.trim() : "";
}

export function readPresentedSweepSecret(headers = {}) {
  const auth = headers.authorization ?? headers.Authorization ?? "";
  const bearer = String(auth).replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  const named = headers[TIMEOUT_SWEEP_HEADER] ?? headers["X-Timeout-Sweep-Secret"];
  return typeof named === "string" ? named.trim() : "";
}

export function authorizeTimeoutSweep(headers = {}, env = {}) {
  const expected = readSweepSecret(env);
  if (!expected) {
    return { ok: false, status: 401, code: "SWEEP_UNAUTHORIZED" };
  }
  const presented = readPresentedSweepSecret(headers);
  if (!presented || presented !== expected) {
    return { ok: false, status: 401, code: "SWEEP_UNAUTHORIZED" };
  }
  return { ok: true };
}
