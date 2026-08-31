/**
 * Coalesced REST refresh: one in-flight bundle, hidden skip, outage backoff.
 * Does not change gameplay outage handling in useOnlineMatch.
 */
import {
  emptyServiceHealthState,
  httpStatusFromError,
  noteServiceFailure,
  noteServiceSuccess,
  planOutageHealthTick,
  stampOutageRetry,
} from "./serviceHealth.js";

/** Visible-only safety net. Never faster than 60s; 120s is the Phase 1 default. */
export const FRIENDS_FALLBACK_REFRESH_MS = 120000;
export const REST_EVENT_COALESCE_MS = 300;

export function documentIsHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Friends/matchmaking only — do not widen gameplay SERVICE_OUTAGE_HTTP. */
function classifyFriendsOutage(error) {
  if (httpStatusFromError(error) === 500) {
    return { status: 503, message: error?.message || "HTTP 500", cause: error };
  }
  return error;
}

export function stableIdKey(ids) {
  return [...new Set((ids || []).filter(Boolean))].sort().join(",");
}

export function friendRequestConcernsPlayer(payload, playerId) {
  if (!playerId) return false;
  const rows = [payload?.new, payload?.old];
  return rows.some((row) => {
    if (!row) return false;
    const sender = row.sender_id || row.senderId;
    const receiver = row.receiver_id || row.receiverId;
    return sender === playerId || receiver === playerId;
  });
}

export function friendshipConcernsPlayer(payload, playerId) {
  if (!playerId) return false;
  const rows = [payload?.new, payload?.old];
  return rows.some((row) => {
    if (!row) return false;
    const a = row.user_a || row.userA;
    const b = row.user_b || row.userB;
    return a === playerId || b === playerId;
  });
}

/**
 * @param {{
 *   load: () => Promise<unknown>,
 *   isReady?: () => boolean,
 *   isHidden?: () => boolean,
 *   now?: () => number,
 *   coalesceMs?: number,
 *   onSuccess?: (result: unknown) => void,
 *   onFailure?: (error: unknown) => void,
 * }} options
 */
export function createGuardedRefresh(options) {
  const coalesceMs = Number(options.coalesceMs);
  const waitMs = Number.isFinite(coalesceMs) && coalesceMs >= 0 ? coalesceMs : REST_EVENT_COALESCE_MS;
  const isReady = () => (options.isReady ? options.isReady() !== false : true);
  const isHidden = () => (options.isHidden ? options.isHidden() : documentIsHidden());
  const now = () => (options.now ? options.now() : Date.now());

  let inFlight = null;
  let queued = false;
  let coalesceTimer = 0;
  let health = emptyServiceHealthState();
  let disposed = false;

  function outageBlocks(force) {
    if (force || !health.outage) return false;
    return planOutageHealthTick(health, now()).action !== "refresh";
  }

  async function run(opts = {}) {
    if (disposed) return undefined;
    const force = Boolean(opts.force);
    if (!isReady()) return undefined;
    if (!force && isHidden()) return undefined;
    if (outageBlocks(force)) return undefined;
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    if (health.outage && !force) {
      health = stampOutageRetry(health, now());
    }
    const work = (async () => {
      try {
        const result = await options.load();
        health = noteServiceSuccess(health);
        options.onSuccess?.(result);
        return result;
      } catch (error) {
        health = noteServiceFailure(health, classifyFriendsOutage(error), now());
        options.onFailure?.(error);
        throw error;
      } finally {
        inFlight = null;
        if (queued) {
          queued = false;
          if (!disposed && !isHidden() && !outageBlocks(false)) {
            void run({ force: false }).catch(() => {});
          }
        }
      }
    })();
    inFlight = work;
    return work.catch(() => undefined);
  }

  function schedule(opts = {}) {
    if (disposed) return undefined;
    if (opts.force) {
      if (coalesceTimer && typeof clearTimeout === "function") {
        clearTimeout(coalesceTimer);
      }
      coalesceTimer = 0;
      return run({ force: true });
    }
    if (coalesceTimer) return undefined;
    const start = () => {
      coalesceTimer = 0;
      void run({ force: false }).catch(() => {});
    };
    if (waitMs <= 0) {
      start();
      return undefined;
    }
    coalesceTimer = setTimeout(start, waitMs);
    return undefined;
  }

  function dispose() {
    disposed = true;
    queued = false;
    if (coalesceTimer && typeof clearTimeout === "function") {
      clearTimeout(coalesceTimer);
    }
    coalesceTimer = 0;
  }

  return {
    run,
    schedule,
    dispose,
    isInFlight: () => Boolean(inFlight),
    isOutage: () => Boolean(health.outage),
    health: () => health,
  };
}
