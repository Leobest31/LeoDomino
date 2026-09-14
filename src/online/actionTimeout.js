/**
 * Bounded waits for online-game invoke / forfeit RPC.
 * A hung fetch must not hold gameplay or leave locks forever.
 */

export const ONLINE_ACTION_TIMEOUT_MS = 15000;

export function isActionTimeoutError(error) {
  if (!error) return false;
  if (error.timeout === true) return true;
  const name = String(error.name || error.cause?.name || "");
  return name === "TimeoutError" || name === "AbortError";
}

export function onlineActionBlockReason({ hasMatch = false, busy = false, outage = false } = {}) {
  if (!hasMatch) return "no_match";
  if (outage) return "outage";
  if (busy) return "busy";
  return "";
}

/**
 * Resolves `promise` or rejects with a TimeoutError. Does not abort the
 * underlying fetch (Supabase invoke has no signal here); callers must still
 * clear UI locks in `finally`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} [ms]
 */
export function awaitWithTimeout(promise, ms = ONLINE_ACTION_TIMEOUT_MS) {
  const limit = Math.max(1, Number(ms) || ONLINE_ACTION_TIMEOUT_MS);
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      error.timeout = true;
      reject(error);
    }, limit);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  });
}
