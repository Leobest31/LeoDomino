/**
 * Global RP client — read-only RPCs. Never computes or writes ratings.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export class GlobalRpError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "GlobalRpError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export const MATCH_RP_RETRY_DELAYS_MS = Object.freeze([0, 300, 700, 1400]);

const ratingListeners = new Set();

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function throwFromError(error, fallbackCode = "GENERIC") {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/authentication required/i.test(msg) || error?.code === "28000") {
    throw new GlobalRpError("AUTH", msg, error);
  }
  if (/not a seated player/i.test(msg) || error?.code === "42501") {
    throw new GlobalRpError("FORBIDDEN", msg, error);
  }
  if (/match (id required|not found)/i.test(msg) || error?.code === "P0002") {
    throw new GlobalRpError("NOT_FOUND", msg, error);
  }
  throw new GlobalRpError(fallbackCode, msg, error);
}

export function normalizeGlobalRating(row) {
  if (!row || typeof row !== "object") return null;
  const rp = asInt(row.rp);
  const matchesPlayed = asInt(row.matches_played ?? row.matchesPlayed);
  const wins = asInt(row.wins);
  const losses = asInt(row.losses);
  const globalRank = asInt(row.global_rank ?? row.globalRank);
  const winRate = asNumber(row.win_rate ?? row.winRate);
  if (
    rp == null ||
    matchesPlayed == null ||
    wins == null ||
    losses == null ||
    globalRank == null ||
    winRate == null
  ) {
    return null;
  }
  return { rp, matchesPlayed, wins, losses, winRate, globalRank };
}

export function normalizeMatchRpResult(row) {
  if (!row || typeof row !== "object") return null;
  if (row.settled === false) {
    return {
      settled: false,
      rated: typeof row.rated === "boolean" ? row.rated : null,
    };
  }
  const oldRp = asInt(row.old_rp ?? row.oldRp);
  const newRp = asInt(row.new_rp ?? row.newRp);
  const delta = asInt(row.delta);
  if (oldRp == null || newRp == null || delta == null || typeof row.rated !== "boolean") {
    return null;
  }
  return {
    settled: true,
    rated: row.rated,
    oldRp,
    newRp,
    delta,
    finishReason: typeof row.finish_reason === "string"
      ? row.finish_reason
      : typeof row.finishReason === "string"
        ? row.finishReason
        : "",
  };
}

export function signedDeltaLabel(delta, format = String) {
  const n = Number(delta);
  if (!Number.isFinite(n)) return "";
  if (n > 0) return `+${format(n)}`;
  return format(n);
}

export function matchRpDisplayFromResult(result) {
  if (!result?.settled) return { kind: "none" };
  if (result.rated) {
    return {
      kind: "rated",
      oldRp: result.oldRp,
      newRp: result.newRp,
      delta: result.delta,
      finishReason: result.finishReason,
    };
  }
  return { kind: "unrated", finishReason: result.finishReason };
}

export function isOnlineMatchAborted(view) {
  return view?.roundResult?.reason === "abandoned";
}

export function subscribeGlobalRatingRefresh(listener) {
  if (typeof listener !== "function") return () => {};
  ratingListeners.add(listener);
  return () => {
    ratingListeners.delete(listener);
  };
}

export function notifyGlobalRatingRefresh() {
  for (const listener of ratingListeners) {
    try {
      listener();
    } catch {
      /* ignore listener failures */
    }
  }
}

export async function getMyGlobalRating(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new GlobalRpError("UNAVAILABLE");
  }
  const { data, error } = await clientOf(client).rpc("get_my_global_rating");
  if (error) throwFromError(error);
  const rating = normalizeGlobalRating(data);
  if (!rating) throw new GlobalRpError("GENERIC");
  return rating;
}

export async function getMatchRpResult(matchId, client) {
  if (!matchId) throw new GlobalRpError("NOT_FOUND");
  if (!client && !isSupabaseConfigured()) {
    throw new GlobalRpError("UNAVAILABLE");
  }
  const { data, error } = await clientOf(client).rpc("get_match_rp_result", {
    p_match_id: matchId,
  });
  if (error) throwFromError(error);
  const result = normalizeMatchRpResult(data);
  if (!result) throw new GlobalRpError("GENERIC");
  return result;
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry briefly if the ledger row is not visible yet. Does not block forever.
 */
export async function fetchSettledMatchRpResult(matchId, options = {}) {
  const delays = options.delays ?? MATCH_RP_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let last = null;
  for (let i = 0; i < delays.length; i += 1) {
    if (options.signal?.aborted) return last;
    if (delays[i] > 0) await sleep(delays[i]);
    if (options.signal?.aborted) return last;
    try {
      last = await getMatchRpResult(matchId, options.client);
      if (last?.settled) return last;
    } catch (error) {
      if (i === delays.length - 1) throw error;
    }
  }
  return last;
}
