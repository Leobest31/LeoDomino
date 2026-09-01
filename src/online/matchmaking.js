/**
 * Find Match client — public match_requests + accept/cancel RPCs.
 * Inserts only { ruleset_id }. Creator, status, and seats come from the backend.
 */
import {
  V1_GAME_STYLE_IDS,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
} from "../data/gameStyles.js";
import {
  ACTIVE_MATCH_STATUSES,
  isResumableMatch,
  isTerminalMatch,
  joinDeadlineFromIso,
} from "./joinTimeout.js";
import { isMissingActiveMatchRow } from "./matchRecovery.js";
import { isImmediateInfrastructureOutage } from "./serviceHealth.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { noteTerminalMatch } from "./terminalMatchMemory.js";

export const FIND_MATCH_STYLE_IDS = V1_GAME_STYLE_IDS;
export const FIND_MATCH_RULESET_IDS = Object.freeze(["legacy", "haitian", "american"]);

export const MATCH_REQUEST_SELECT_LEGACY =
  "id, creator_id, ruleset_id, status, created_at, expires_at, match_id, acceptor_id, profiles!creator_id ( display_name, avatar_id, country_code )";

export const MATCH_REQUEST_SELECT =
  `${MATCH_REQUEST_SELECT_LEGACY}, visibility, invitee_id`;

export const FRIEND_MATCH_INVITE_SELECT =
  `${MATCH_REQUEST_SELECT}, invitee:profiles!invitee_id ( display_name, avatar_id, country_code )`;

/** Must match SQL interval '5 minutes' in stale occupancy cleanup. */
export const STALE_MATCH_GRACE_MS = 5 * 60 * 1000;
export const MATCH_PRESENCE_HEARTBEAT_MS = 20 * 1000;
export {
  JOIN_GRACE_MS,
  ACTIVE_MATCH_STATUSES,
  isGameplayStarted,
  isReservedNotStarted,
  isResumableMatch,
  joinDeadlineFromIso,
} from "./joinTimeout.js";

function isMissingRpcError(error) {
  if (isImmediateInfrastructureOutage(error)) return false;
  const code = String(error?.code || "");
  const msg = String(error?.message || error?.details || "");
  if (/PGRST002|PGRST003/i.test(`${msg} ${code}`)) return false;
  return /does not exist|42883|PGRST202/i.test(`${msg} ${code}`);
}

function isMissingInviteColumnError(error) {
  const msg = String(error?.message || error?.details || "");
  return /visibility|invitee_id/i.test(msg);
}

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
  const inviteeProfile = unwrapProfile(row.invitee);
  const visibility = row.visibility === "friend" ? "friend" : "public";
  return {
    id: row.id,
    creatorId: row.creator_id,
    inviteeId: row.invitee_id ?? null,
    visibility,
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
    invitee: row.invitee_id
      ? {
          playerId: row.invitee_id,
          displayName: inviteeProfile.displayName,
          avatarId: inviteeProfile.avatarId,
          countryCode: inviteeProfile.countryCode,
        }
      : null,
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
export function isPublicMatchRequest(request) {
  return request?.visibility !== "friend";
}

/**
 * @param {{ creatorId?: string, status?: string, expiresAt?: string, visibility?: string }|null|undefined} request
 * @param {string} playerId
 */
export function canAcceptMatchRequest(request, playerId) {
  return (
    isPublicMatchRequest(request) &&
    request?.status === "open" &&
    Boolean(playerId) &&
    !isOwnMatchRequest(request, playerId) &&
    !isMatchRequestExpired(request)
  );
}

/**
 * Lobby cards that may still render as Waiting/Open.
 * A request that is no longer open must never stay in this list.
 *
 * @param {Array<{ id?: string, status?: string }|null|undefined>} open
 * @param {{ id?: string, status?: string }|null|undefined} own
 */
export function visibleFindMatchRequests(open, own) {
  return (Array.isArray(open) ? open : []).filter((row) => {
    if (!row || row.status !== "open") return false;
    if (own && row.id === own.id && own.status !== "open") return false;
    return true;
  });
}

/**
 * @param {{ visibility?: string, status?: string, inviteeId?: string, expiresAt?: string }|null|undefined} request
 * @param {string} playerId
 */
export function canAcceptFriendInvite(request, playerId) {
  return (
    request?.visibility === "friend" &&
    request?.status === "open" &&
    Boolean(playerId) &&
    request.inviteeId === playerId &&
    !isMatchRequestExpired(request)
  );
}

/**
 * Informational Home/Find Match count. Does not replace accept_match_request.
 * A request is joinable when the current player could potentially accept it:
 * OPEN, unexpired, not own, and the creator is not already seated.
 *
 * @param {Array<{ creatorId?: string, status?: string, expiresAt?: string }|null|undefined>} requests
 * @param {string} playerId
 * @param {Iterable<string>|Set<string>} [busyCreatorIds]
 */
export function countJoinableOpenRequests(requests, playerId, busyCreatorIds) {
  if (!playerId || !Array.isArray(requests) || requests.length === 0) return 0;
  const busy = busyCreatorIds instanceof Set ? busyCreatorIds : new Set(busyCreatorIds || []);
  let count = 0;
  for (const request of requests) {
    if (!canAcceptMatchRequest(request, playerId)) continue;
    if (request.creatorId && busy.has(request.creatorId)) continue;
    count += 1;
  }
  return count;
}

function availabilityFromCount(count) {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return { count: safe, available: safe > 0 };
}

/**
 * Real joinable OPEN count for the Home indicator.
 * Prefers the occupancy-aware SQL count; falls back to the public OPEN list.
 *
 * @param {string} playerId
 * @param {object} [client]
 */
export async function loadFindMatchAvailability(playerId, client) {
  if (!playerId) return availabilityFromCount(0);
  const db = clientOf(client);
  if (typeof db.rpc === "function") {
    const { data, error } = await db.rpc("count_joinable_open_match_requests");
    if (!error && data != null && data !== "") {
      const count = Number(data);
      if (Number.isFinite(count) && count >= 0) {
        return availabilityFromCount(count);
      }
    }
  }
  const open = await listOpenMatchRequests(db);
  return availabilityFromCount(countJoinableOpenRequests(open, playerId));
}

/**
 * @param {object} error
 * @param {string} [fallbackCode]
 */
export function throwFromPostgrest(error, fallbackCode = "RPC") {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/cannot accept own/i.test(msg)) {
    throw new MatchmakingError("SELF_ACCEPT", msg, error);
  }
  if (/RANKED_PAIR_LIMIT/i.test(msg) || error?.code === "P0004") {
    throw new MatchmakingError("RANKED_PAIR_LIMIT", msg, error);
  }
  if (/PLAYER_BUSY|active_match_players|ACTIVE_MATCH_EXISTS/i.test(msg)) {
    throw new MatchmakingError("PLAYER_BUSY", msg, error);
  }
  if (/REQUEST_ALREADY_ACCEPTED/i.test(msg)) {
    throw new MatchmakingError("REQUEST_ALREADY_ACCEPTED", msg, error);
  }
  if (/REQUEST_UNAVAILABLE/i.test(msg)) {
    throw new MatchmakingError("REQUEST_UNAVAILABLE", msg, error);
  }
  if (/match request expired/i.test(msg)) {
    throw new MatchmakingError("EXPIRED", msg, error);
  }
  if (/match request is not open|cannot cancel match request/i.test(msg)) {
    throw new MatchmakingError("NOT_OPEN", msg, error);
  }
  if (/match request not found|match not found|invitee required/i.test(msg)) {
    throw new MatchmakingError("NOT_FOUND", msg, error);
  }
  if (/not a seated player/i.test(msg)) {
    throw new MatchmakingError("NOT_A_PLAYER", msg, error);
  }
  if (/authentication required/i.test(msg)) {
    throw new MatchmakingError("AUTH", msg, error);
  }
  if (/invalid ruleset_id/i.test(msg)) {
    throw new MatchmakingError("INVALID_STYLE", msg, error);
  }
  if (/cannot invite yourself/i.test(msg)) {
    throw new MatchmakingError("SELF_INVITE", msg, error);
  }
  if (/not friends/i.test(msg)) {
    throw new MatchmakingError("NOT_FRIENDS", msg, error);
  }
  if (/only the invitee may accept|cannot decline invitation/i.test(msg)) {
    throw new MatchmakingError("NOT_INVITEE", msg, error);
  }
  if (/duplicate key|unique constraint|one_open_per_creator|one_open_friend_pair/i.test(msg)) {
    throw new MatchmakingError("ALREADY_OPEN", msg, error);
  }
  throw new MatchmakingError(fallbackCode, msg || "request failed", error);
}

export function isActiveMatchLockError(error) {
  return (
    error instanceof MatchmakingError &&
    (error.code === "PLAYER_BUSY" || error.code === "ACTIVE_MATCH_EXISTS")
  );
}

/** Stale/busy accept must not enter a table. Refresh the list instead. */
export function isStaleMatchAcceptError(error) {
  return (
    error instanceof MatchmakingError &&
    (error.code === "PLAYER_BUSY" ||
      error.code === "REQUEST_UNAVAILABLE" ||
      error.code === "REQUEST_ALREADY_ACCEPTED" ||
      error.code === "NOT_OPEN" ||
      error.code === "NOT_FOUND" ||
      error.code === "EXPIRED" ||
      error.code === "NOT_FRIENDS" ||
      error.code === "NOT_INVITEE" ||
      error.code === "RANKED_PAIR_LIMIT")
  );
}

export function friendInviteErrorKey(error) {
  switch (error?.code) {
    case "PLAYER_BUSY":
      return "findMatch.alreadyInMatch";
    case "RANKED_PAIR_LIMIT":
      return "findMatch.rankedPairLimit";
    case "NOT_FRIENDS":
      return "friends.notFriendsPlay";
    case "SELF_INVITE":
    case "SELF_ACCEPT":
      return "friends.self";
    case "ALREADY_OPEN":
      return "friends.inviteAlreadyOpen";
    case "INVALID_STYLE":
      return "findMatch.invalidStyle";
    case "NOT_INVITEE":
    case "REQUEST_UNAVAILABLE":
    case "NOT_OPEN":
    case "EXPIRED":
    case "REQUEST_ALREADY_ACCEPTED":
      return "findMatch.playerUnavailable";
    case "AUTH":
      return "findMatch.unavailable";
    default:
      return "friends.inviteError";
  }
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
    .select(MATCH_REQUEST_SELECT_LEGACY)
    .single();
  if (error) throwFromPostgrest(error, "CREATE_FAILED");
  return normalizeMatchRequest(data);
}

/**
 * @param {object} [client]
 */
export async function listOpenMatchRequests(client) {
  const db = clientOf(client);
  const run = (selectCols, publicOnly) => {
    let query = db
      .from("match_requests")
      .select(selectCols)
      .eq("status", "open")
      .gt("expires_at", new Date().toISOString());
    if (publicOnly) query = query.neq("visibility", "friend");
    return query.order("created_at", { ascending: false });
  };
  let { data, error } = await run(MATCH_REQUEST_SELECT, true);
  if (error && isMissingInviteColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_LEGACY, false));
  }
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  return (data ?? [])
    .map((row) => normalizeMatchRequest(row))
    .filter(Boolean)
    .filter((row) => isPublicMatchRequest(row) && !isMatchRequestExpired(row));
}

/**
 * Latest open or accepted request created by this player (for waiting / matched).
 * @param {string} playerId
 * @param {object} [client]
 */
export async function getOwnLatestRequest(playerId, client) {
  if (!playerId) return null;
  const db = clientOf(client);
  const run = (selectCols, publicOnly) => {
    let query = db
      .from("match_requests")
      .select(selectCols)
      .eq("creator_id", playerId)
      .in("status", ["open", "accepted"]);
    if (publicOnly) query = query.neq("visibility", "friend");
    return query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  };
  let { data, error } = await run(MATCH_REQUEST_SELECT, true);
  if (error && isMissingInviteColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_LEGACY, false));
  }
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  const own = normalizeMatchRequest(data);
  if (own?.status === "open" && isMatchRequestExpired(own)) return null;
  return own ?? null;
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
    .select("id, request_id, ruleset_id, player_a, player_b, status, created_at, finish_reason, finished_at")
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
  let sessionStatus = null;
  let phase = null;
  let hasGameSession = false;
  try {
    const { data: session, error: sessionError } = await db
      .from("game_sessions")
      .select("match_id, status, phase")
      .eq("match_id", match.id)
      .maybeSingle();
    if (!sessionError && session?.match_id) {
      hasGameSession = true;
      sessionStatus = session.status ?? null;
      phase = session.phase ?? null;
    }
  } catch {
    /* public session row is optional; lobby recovery still uses matches.status */
  }
  const hydrated = {
    id: match.id,
    requestId: match.request_id,
    rulesetId: match.ruleset_id,
    styleId: styleIdFromRulesetId(match.ruleset_id),
    status: match.status,
    createdAt: match.created_at,
    finishReason: match.finish_reason ?? null,
    finishedAt: match.finished_at ?? null,
    host: toPlayer(match.player_a, "host"),
    opponent: toPlayer(match.player_b, "opponent"),
    hasGameSession,
    sessionStatus,
    phase,
  };
  if (isTerminalMatch(hydrated)) noteTerminalMatch(hydrated.id);
  return hydrated;
}

function rpcActiveMatchId(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row.match_id || row.id || null;
}

/**
 * Discover this signed-in player's reserved/active match.
 * RLS on matches (player_a/player_b = auth.uid()) is the authority.
 * Prefers get_my_active_match RPC when hosted; falls back to SELECT.
 * @param {object} [client]
 */
export async function getMyActiveMatch(client) {
  const db = clientOf(client);
  const discovered = await discoverMyActiveMatch(db);
  if (!discovered?.id) return null;
  let match;
  try {
    match = await getMatchWithPlayers(discovered.id, db);
  } catch (error) {
    if (isMissingActiveMatchRow(error)) return null;
    throw error;
  }
  if (!match?.id) return null;
  if (!isResumableMatch(match)) {
    if (isTerminalMatch(match)) noteTerminalMatch(match.id);
    return null;
  }
  return attachActiveMatchMeta(match, discovered, db);
}

async function discoverMyActiveMatch(db) {
  if (typeof db.rpc === "function") {
    const { data, error } = await db.rpc("get_my_active_match");
    if (!error) {
      const id = rpcActiveMatchId(data);
      if (!id) return null;
      return { id, meta: Array.isArray(data) ? data[0] : data, source: "rpc" };
    }
    if (!isMissingRpcError(error)) throwFromPostgrest(error, "MATCH_FAILED");
  }
  const { data, error } = await db
    .from("matches")
    .select("id, request_id, status, created_at, rated")
    .in("status", [...ACTIVE_MATCH_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwFromPostgrest(error, "MATCH_FAILED");
  if (!data?.id) return null;
  return { id: data.id, meta: data, source: "select" };
}

async function attachActiveMatchMeta(match, discovered, db) {
  const meta = discovered.meta && typeof discovered.meta === "object" ? discovered.meta : {};
  let hasGameSession = meta.has_game_session;
  if (hasGameSession == null) hasGameSession = match.hasGameSession;
  if (hasGameSession == null && typeof db.from === "function") {
    try {
      const { data, error } = await db
        .from("game_sessions")
        .select("match_id")
        .eq("match_id", match.id)
        .maybeSingle();
      if (!error) hasGameSession = Boolean(data?.match_id);
    } catch {
      hasGameSession = undefined;
    }
  }
  if (hasGameSession == null) {
    hasGameSession = match.status === "playing";
  }
  let acceptedAt = meta.accepted_at ?? null;
  if (!acceptedAt && match.requestId && typeof db.from === "function") {
    try {
      const { data } = await db
        .from("match_requests")
        .select("accepted_at")
        .eq("id", match.requestId)
        .maybeSingle();
      acceptedAt = data?.accepted_at ?? null;
    } catch {
      acceptedAt = null;
    }
  }
  const reservedAt = acceptedAt || match.createdAt;
  const joinDeadlineAt = meta.join_deadline_at || joinDeadlineFromIso(reservedAt);
  const gameplayStarted =
    meta.gameplay_started != null ? Boolean(meta.gameplay_started) : Boolean(hasGameSession);
  return {
    ...match,
    rated: meta.rated ?? null,
    acceptedAt,
    hasGameSession: Boolean(hasGameSession),
    gameplayStarted,
    reservedNotStarted: !gameplayStarted,
    joinDeadlineAt,
    selfJoined: meta.self_joined ?? null,
    opponentJoined: meta.opponent_joined ?? null,
    waitingToJoin: meta.waiting_to_join ?? !gameplayStarted,
    source: discovered.source,
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
 * Send a private friend-match invitation. Not listed on public Find Match.
 * @param {string} inviteeId
 * @param {string} styleId
 * @param {object} [client]
 */
export async function sendFriendMatchInvite(inviteeId, styleId, client) {
  const rulesetId = toFindMatchRulesetId(styleId);
  if (!rulesetId) {
    throw new MatchmakingError("INVALID_STYLE", "invalid Find Match style");
  }
  if (!inviteeId) {
    throw new MatchmakingError("NOT_FOUND", "invitee required");
  }
  const db = clientOf(client);
  const { data, error } = await db.rpc("send_friend_match_invite", {
    p_invitee_id: inviteeId,
    p_ruleset_id: rulesetId,
  });
  if (error) throwFromPostgrest(error, "INVITE_FAILED");
  const requestId = typeof data === "string" ? data : data?.id;
  if (!requestId) {
    return {
      id: null,
      creatorId: null,
      inviteeId,
      visibility: "friend",
      status: "open",
    };
  }
  const { data: row, error: rowError } = await db
    .from("match_requests")
    .select(FRIEND_MATCH_INVITE_SELECT)
    .eq("id", requestId)
    .maybeSingle();
  if (rowError && !isMissingInviteColumnError(rowError)) {
    throwFromPostgrest(rowError, "INVITE_FAILED");
  }
  return (
    normalizeMatchRequest(row) || {
      id: requestId,
      inviteeId,
      visibility: "friend",
      status: "open",
    }
  );
}

/**
 * Incoming open friend invites for the authenticated player.
 * @param {string} playerId
 * @param {object} [client]
 */
export async function listIncomingFriendInvites(playerId, client) {
  if (!playerId) return [];
  const { data, error } = await clientOf(client)
    .from("match_requests")
    .select(FRIEND_MATCH_INVITE_SELECT)
    .eq("visibility", "friend")
    .eq("status", "open")
    .eq("invitee_id", playerId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingInviteColumnError(error)) return [];
    throwFromPostgrest(error, "LIST_FAILED");
  }
  return (data ?? [])
    .map((row) => normalizeMatchRequest(row))
    .filter((row) => canAcceptFriendInvite(row, playerId));
}

/**
 * Outgoing open friend invites created by this player.
 * @param {string} playerId
 * @param {object} [client]
 */
export async function listOutgoingFriendInvites(playerId, client) {
  if (!playerId) return [];
  const { data, error } = await clientOf(client)
    .from("match_requests")
    .select(FRIEND_MATCH_INVITE_SELECT)
    .eq("visibility", "friend")
    .eq("status", "open")
    .eq("creator_id", playerId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingInviteColumnError(error)) return [];
    throwFromPostgrest(error, "LIST_FAILED");
  }
  return (data ?? []).map((row) => normalizeMatchRequest(row)).filter(Boolean);
}

/**
 * Invitee declines a pending friend invitation. No match is created.
 * @param {string} requestId
 * @param {object} [client]
 */
export async function declineFriendMatchInvite(requestId, client) {
  const { error } = await clientOf(client).rpc("decline_friend_match_invite", {
    p_request_id: requestId,
  });
  if (error) throwFromPostgrest(error, "DECLINE_FAILED");
}

/**
 * Intentional abandon of an active online match. Backend derives the winner
 * as the opponent of auth.uid(). Idempotent if the match is already finished.
 * @param {string} matchId
 * @param {object} [client]
 */
export async function forfeitOnlineMatch(matchId, client) {
  if (!matchId) return { ok: false };
  const { data, error } = await clientOf(client).rpc("forfeit_online_match", {
    p_match_id: matchId,
  });
  if (error) throwFromPostgrest(error, "FORFEIT_FAILED");
  return data ?? { ok: true };
}

/**
 * Seated player leaves a live table. Delegates to forfeit_online_match.
 * @param {string} matchId
 * @param {object} [client]
 */
export async function abortOnlineMatch(matchId, client) {
  return forfeitOnlineMatch(matchId, client);
}

/**
 * Seated-player heartbeat. Missing RPC (pre-migration) is a no-op.
 * @param {string} matchId
 * @param {object} [client]
 */
export async function touchMyMatchPresence(matchId, client) {
  if (!matchId) return { ok: false, touched: false };
  const { data, error } = await clientOf(client).rpc("touch_my_match_presence", {
    p_match_id: matchId,
  });
  if (error) return { ok: false, touched: false };
  return data ?? { ok: true };
}

/**
 * Backend-authoritative stale occupancy sweep. Idempotent. Missing RPC is a no-op.
 * @param {object} [client]
 */
export async function cleanupStaleOccupiedMatches(client) {
  const { data, error } = await clientOf(client).rpc("cleanup_stale_occupied_matches");
  if (error) return 0;
  const cleaned = Number(data);
  return Number.isFinite(cleaned) && cleaned > 0 ? Math.floor(cleaned) : 0;
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
