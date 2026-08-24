/**
 * Find Match client — public match_requests + accept/cancel RPCs.
 * Inserts only { ruleset_id }. Creator, status, and seats come from the backend.
 */
import {
  V1_GAME_STYLE_IDS,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
} from "../data/gameStyles.js";
import { getSupabaseClient } from "./supabaseClient.js";

export const FIND_MATCH_STYLE_IDS = V1_GAME_STYLE_IDS;
export const FIND_MATCH_RULESET_IDS = Object.freeze(["legacy", "haitian", "american"]);

export const MATCH_REQUEST_SELECT =
  "id, creator_id, ruleset_id, status, created_at, expires_at, match_id, acceptor_id, profiles!creator_id ( display_name, avatar_id, country_code )";

const ALLOWED_RULESETS = new Set(FIND_MATCH_RULESET_IDS);

export class MatchmakingError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message || code);
    this.name = "MatchmakingError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

/**
 * Map UI style id or engine ruleset id → V1 Find Match ruleset.
 * Classic → legacy. Rejects All Fives / Dominican / Puerto Rican.
 * @param {unknown} styleOrRuleset
 * @returns {string|null}
 */
export function toFindMatchRulesetId(styleOrRuleset) {
  if (typeof styleOrRuleset !== "string" || !styleOrRuleset) return null;
  if (ALLOWED_RULESETS.has(styleOrRuleset)) return styleOrRuleset;
  const rulesetId = gameStyleToRulesetId(styleOrRuleset);
  if (ALLOWED_RULESETS.has(rulesetId)) return rulesetId;
  return null;
}

/**
 * @param {unknown} rulesetId
 * @returns {string|null}
 */
export function styleIdFromRulesetId(rulesetId) {
  const style = gameStyleForRulesetId(/** @type {string} */ (rulesetId));
  if (!style) return null;
  return FIND_MATCH_STYLE_IDS.includes(style.id) ? style.id : null;
}

function unwrapProfile(raw) {
  const profile = Array.isArray(raw) ? raw[0] : raw;
  return {
    displayName: typeof profile?.display_name === "string" && profile.display_name
      ? profile.display_name
      : "Player",
    avatarId: typeof profile?.avatar_id === "string" && profile.avatar_id
      ? profile.avatar_id
      : "marcus",
    countryCode: typeof profile?.country_code === "string" ? profile.country_code : "",
  };
}

/**
 * @param {object|null|undefined} row
 */
export function normalizeMatchRequest(row) {
  if (!row) return null;
  const profile = unwrapProfile(row.profiles);
  const rulesetId = row.ruleset_id;
  return {
    id: row.id,
    creatorId: row.creator_id,
    rulesetId,
    styleId: styleIdFromRulesetId(rulesetId),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    matchId: row.match_id ?? null,
    acceptorId: row.acceptor_id ?? null,
    creator: {
      playerId: row.creator_id,
      displayName: profile.displayName,
      avatarId: profile.avatarId,
      countryCode: profile.countryCode,
    },
  };
}

/**
 * @param {{ creatorId?: string, status?: string }|null|undefined} request
 * @param {string} playerId
 */
export function isOwnMatchRequest(request, playerId) {
  return Boolean(request?.creatorId && playerId && request.creatorId === playerId);
}

/**
 * @param {{ creatorId?: string, status?: string }|null|undefined} request
 * @param {string} playerId
 */
export function isMatchRequestExpired(request, now = Date.now()) {
  if (!request?.expiresAt) return false;
  const expires = Date.parse(request.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

/**
 * @param {{ creatorId?: string, status?: string, expiresAt?: string }|null|undefined} request
 * @param {string} playerId
 */
export function canAcceptMatchRequest(request, playerId) {
  return (
    request?.status === "open" &&
    Boolean(playerId) &&
    !isOwnMatchRequest(request, playerId) &&
    !isMatchRequestExpired(request)
  );
}

/**
 * @param {object} error
 * @param {string} [fallbackCode]
 */
export function throwFromPostgrest(error, fallbackCode = "RPC") {
  const msg = String(error?.message || error?.details || error?.hint || "");
  if (/cannot accept own/i.test(msg)) {
    throw new MatchmakingError("SELF_ACCEPT", msg, error);
  }
  if (/match request expired/i.test(msg)) {
    throw new MatchmakingError("EXPIRED", msg, error);
  }
  if (/match request is not open|cannot cancel match request/i.test(msg)) {
    throw new MatchmakingError("NOT_OPEN", msg, error);
  }
  if (/match request not found/i.test(msg)) {
    throw new MatchmakingError("NOT_FOUND", msg, error);
  }
  if (/authentication required/i.test(msg)) {
    throw new MatchmakingError("AUTH", msg, error);
  }
  if (/invalid ruleset_id/i.test(msg)) {
    throw new MatchmakingError("INVALID_STYLE", msg, error);
  }
  if (/duplicate key|unique constraint|one_open_per_creator/i.test(msg)) {
    throw new MatchmakingError("ALREADY_OPEN", msg, error);
  }
  throw new MatchmakingError(fallbackCode, msg || "request failed", error);
}

/**
 * Create a public open request. Backend trigger stamps creator_id = auth.uid().
 * @param {string} styleId
 * @param {object} [client]
 */
export async function createMatchRequest(styleId, client) {
  const rulesetId = toFindMatchRulesetId(styleId);
  if (!rulesetId) {
    throw new MatchmakingError("INVALID_STYLE", "invalid Find Match style");
  }
  const { data, error } = await clientOf(client)
    .from("match_requests")
    .insert({ ruleset_id: rulesetId })
    .select(MATCH_REQUEST_SELECT)
    .single();
  if (error) throwFromPostgrest(error, "CREATE_FAILED");
  return normalizeMatchRequest(data);
}

/**
 * @param {object} [client]
 */
export async function listOpenMatchRequests(client) {
  const { data, error } = await clientOf(client)
    .from("match_requests")
    .select(MATCH_REQUEST_SELECT)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  return (data ?? [])
    .map((row) => normalizeMatchRequest(row))
    .filter(Boolean)
    .filter((row) => !isMatchRequestExpired(row));
}

/**
 * Latest open or accepted request created by this player (for waiting / matched).
 * @param {string} playerId
 * @param {object} [client]
 */
export async function getOwnLatestRequest(playerId, client) {
  if (!playerId) return null;
  const { data, error } = await clientOf(client)
    .from("match_requests")
    .select(MATCH_REQUEST_SELECT)
    .eq("creator_id", playerId)
    .in("status", ["open", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  return normalizeMatchRequest(data);
}

/**
 * @param {string} playerId
 * @param {object} [client]
 */
export async function loadFindMatchBoard(playerId, client) {
  const open = await listOpenMatchRequests(client);
  const own = await getOwnLatestRequest(playerId, client);
  if (own?.status === "open" && !open.some((row) => row.id === own.id)) {
    return { open: [own, ...open], own };
  }
  return { open, own };
}

/**
 * @param {string} matchId
 * @param {object} [client]
 */
export async function getMatchWithPlayers(matchId, client) {
  const db = clientOf(client);
  const { data: match, error } = await db
    .from("matches")
    .select("id, request_id, ruleset_id, player_a, player_b, status, created_at")
    .eq("id", matchId)
    .single();
  if (error) throwFromPostgrest(error, "MATCH_FAILED");
  const ids = [match.player_a, match.player_b].filter(Boolean);
  const { data: profiles, error: profileError } = await db
    .from("profiles")
    .select("id, display_name, avatar_id, country_code")
    .in("id", ids);
  if (profileError) throwFromPostgrest(profileError, "MATCH_FAILED");
  const byId = Object.fromEntries((profiles ?? []).map((row) => [row.id, row]));
  const toPlayer = (id, role) => {
    const row = byId[id];
    return {
      playerId: id,
      role,
      displayName: row?.display_name || "Player",
      avatarId: row?.avatar_id || "marcus",
      countryCode: row?.country_code || "",
    };
  };
  return {
    id: match.id,
    requestId: match.request_id,
    rulesetId: match.ruleset_id,
    styleId: styleIdFromRulesetId(match.ruleset_id),
    status: match.status,
    createdAt: match.created_at,
    host: toPlayer(match.player_a, "host"),
    opponent: toPlayer(match.player_b, "opponent"),
  };
}

/**
 * Accept another player's open request. Does not send ruleset_id —
 * the RPC copies the creator's locked style onto the match.
 * @param {string} requestId
 * @param {{ playerId?: string, creatorId?: string }} [options]
 * @param {object} [client]
 */
export async function acceptMatchRequest(requestId, options = {}, client) {
  const { playerId, creatorId } = options;
  if (playerId && creatorId && playerId === creatorId) {
    throw new MatchmakingError("SELF_ACCEPT", "cannot accept own match request");
  }
  const { data, error } = await clientOf(client).rpc("accept_match_request", {
    p_request_id: requestId,
  });
  if (error) throwFromPostgrest(error, "ACCEPT_FAILED");
  const matchId = data;
  try {
    return await getMatchWithPlayers(matchId, client);
  } catch {
    return { id: matchId };
  }
}

/**
 * @param {string} requestId
 * @param {object} [client]
 */
export async function cancelMatchRequest(requestId, client) {
  const { error } = await clientOf(client).rpc("cancel_match_request", {
    p_request_id: requestId,
  });
  if (error) throwFromPostgrest(error, "CANCEL_FAILED");
}

/**
 * Realtime on match_requests only. No Presence. No chat.
 * @param {(payload: object) => void} onEvent
 * @param {object} [client]
 * @returns {() => void}
 */
export function subscribeMatchRequests(onEvent, client) {
  const db = clientOf(client);
  const channel = db.channel("leo-match-requests");
  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "match_requests" },
      (payload) => {
        onEvent?.(payload);
      }
    )
    .subscribe();
  return () => {
    db.removeChannel(channel);
  };
}
