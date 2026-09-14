/**
 * Find Match client — public match_requests + accept/cancel RPCs.
 * Public LeoPips inserts { ruleset_id, stake_pips } when the hosted column
 * exists. Creator, status, and seats come from the backend.
 * Does not import LeoPips economy or call debit/payout helpers.
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
import { reportSafeEvent } from "../monitoring/client.js";
import {
  httpStatusFromError,
  isImmediateInfrastructureOutage,
  isInfrastructureOutageError,
  NETWORK_REQUEST_TIMEOUT_MS,
  postgrestCodeFromError,
  SERVICE_UNAVAILABLE_CODE,
} from "./serviceHealth.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { noteTerminalMatch } from "./terminalMatchMemory.js";

/** Bound a PostgREST query builder with the shared network timeout, when supported. */
function withNetworkTimeout(query) {
  if (typeof query?.abortSignal === "function" && typeof AbortSignal?.timeout === "function") {
    return query.abortSignal(AbortSignal.timeout(NETWORK_REQUEST_TIMEOUT_MS));
  }
  return query;
}

export const FIND_MATCH_STYLE_IDS = V1_GAME_STYLE_IDS;
export const FIND_MATCH_RULESET_IDS = Object.freeze(["legacy", "haitian", "american"]);

export const MATCH_REQUEST_SELECT_LEGACY =
  "id, creator_id, ruleset_id, status, created_at, expires_at, match_id, acceptor_id, profiles!creator_id ( display_name, avatar_id, country_code )";

export const MATCH_REQUEST_SELECT_INVITE =
  `${MATCH_REQUEST_SELECT_LEGACY}, visibility, invitee_id`;

export const MATCH_REQUEST_SELECT =
  `${MATCH_REQUEST_SELECT_INVITE}, waiting_heartbeat_at`;

export const MATCH_REQUEST_SELECT_STAKE =
  `${MATCH_REQUEST_SELECT}, stake_pips`;

export const FRIEND_MATCH_INVITE_SELECT =
  `${MATCH_REQUEST_SELECT}, invitee:profiles!invitee_id ( display_name, avatar_id, country_code )`;

/** Public LeoPips lobby stakes. Never coerce NULL/invalid to 20. */
export const FIND_MATCH_STAKE_PIPS = Object.freeze([20, 50, 100, 150]);

const FRIEND_MATCH_INVITE_SELECT_NO_HEARTBEAT =
  `${MATCH_REQUEST_SELECT_INVITE}, invitee:profiles!invitee_id ( display_name, avatar_id, country_code )`;

/** Must match SQL interval '5 minutes' in stale occupancy cleanup. */
export const STALE_MATCH_GRACE_MS = 5 * 60 * 1000;
export const MATCH_PRESENCE_HEARTBEAT_MS = 20 * 1000;
/** Public Find Match waiting heartbeat while the creator is on the visible waiting screen. */
export const PUBLIC_REQUEST_HEARTBEAT_MS = 10 * 1000;
/**
 * Maximum age of waiting_heartbeat_at for a public request to stay joinable /
 * accept-ready. Aligned with SQL grace (5 minutes). A short mobile gap must
 * not hide or permanently expire a still-valid waiting request.
 */
export const PUBLIC_REQUEST_HEARTBEAT_TTL_MS = 5 * 60 * 1000;
export {
  JOIN_GRACE_MS,
  ACTIVE_MATCH_STATUSES,
  isGameplayStarted,
  isReservedNotStarted,
  isResumableMatch,
  isTerminalMatch,
  joinDeadlineFromIso,
} from "./joinTimeout.js";

/**
 * Own Find Match request is actionable only when OPEN (unexpired) or ACCEPTED
 * with a still-resumable linked match (ready/playing). Accepted→finished/missing
 * history must not trap Find Match.
 *
 * @param {{ status?: string, matchId?: string|null }|null|undefined} request
 * @param {{ id?: string, status?: string, finishReason?: string|null, finishedAt?: string|null }|null|undefined} linkedMatch
 * @param {number} [now]
 */
export function isLiveOwnMatchmakingRequest(request, linkedMatch, now = Date.now()) {
  if (!request) return false;
  if (request.status === "open") return !isMatchRequestExpired(request, now);
  if (request.status === "accepted") {
    if (!request.matchId) return false;
    if (!linkedMatch?.id) return false;
    return isResumableMatch(linkedMatch);
  }
  return false;
}

async function fetchLinkedMatchBrief(matchId, client) {
  if (!matchId) return null;
  const db = clientOf(client);
  const { data, error } = await db
    .from("matches")
    .select("id, status, finish_reason, finished_at")
    .eq("id", matchId)
    .maybeSingle();
  if (error) {
    if (isMissingActiveMatchRow(error)) return null;
    throwFromPostgrest(error, "MATCH_FAILED");
  }
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    finishReason: data.finish_reason ?? null,
    finishedAt: data.finished_at ?? null,
  };
}

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

function isMissingHeartbeatColumnError(error) {
  const msg = String(error?.message || error?.details || "");
  return /waiting_heartbeat_at/i.test(msg);
}

function isMissingStakeColumnError(error) {
  const msg = String(error?.message || error?.details || "");
  return /stake_pips/i.test(msg);
}

function isUnknownAcceptSignatureError(error) {
  const msg = String(error?.message || error?.details || error?.code || "");
  return /p_ruleset_id|p_stake_pips|PGRST202|could not find the function/i.test(msg);
}

const ALLOWED_RULESETS = new Set(FIND_MATCH_RULESET_IDS);

/**
 * @param {unknown} stake
 * @returns {number|null}
 */
export function toFindMatchStakePips(stake) {
  const n = Number(stake);
  if (!Number.isInteger(n) || !FIND_MATCH_STAKE_PIPS.includes(n)) return null;
  return n;
}

/**
 * @param {unknown} stake
 */
export function isAllowedFindMatchStake(stake) {
  return toFindMatchStakePips(stake) != null;
}

function isClientLike(value) {
  return Boolean(value && (typeof value.from === "function" || typeof value.rpc === "function"));
}

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
  const stakePips = toFindMatchStakePips(row.stake_pips ?? row.stakePips);
  return {
    id: row.id,
    creatorId: row.creator_id,
    inviteeId: row.invitee_id ?? null,
    visibility,
    rulesetId,
    styleId: styleIdFromRulesetId(rulesetId),
    stakePips,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    matchId: row.match_id ?? null,
    acceptorId: row.acceptor_id ?? null,
    waitingHeartbeatAt: row.waiting_heartbeat_at ?? null,
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
 * Public Find Match creator is accept-ready only while the waiting heartbeat
 * is within PUBLIC_REQUEST_HEARTBEAT_TTL_MS. Friend invites ignore this clock.
 *
 * @param {{ visibility?: string, waitingHeartbeatAt?: string|null }|null|undefined} request
 * @param {number} [now]
 */
export function isPublicRequestCreatorFresh(request, now = Date.now()) {
  if (!isPublicMatchRequest(request)) return true;
  const raw = request?.waitingHeartbeatAt ?? request?.waiting_heartbeat_at;
  const heartbeatMs = Date.parse(String(raw ?? ""));
  if (!Number.isFinite(heartbeatMs)) return false;
  return now - heartbeatMs <= PUBLIC_REQUEST_HEARTBEAT_TTL_MS;
}

/**
 * @param {{ creatorId?: string, status?: string, expiresAt?: string, visibility?: string }|null|undefined} request
 * @param {string} playerId
 * @param {number} [now]
 */
export function canAcceptMatchRequest(request, playerId, now = Date.now()) {
  return (
    isPublicMatchRequest(request) &&
    request?.status === "open" &&
    Boolean(playerId) &&
    !isOwnMatchRequest(request, playerId) &&
    !isMatchRequestExpired(request, now) &&
    isPublicRequestCreatorFresh(request, now)
  );
}

/**
 * Lobby cards that may still render as Waiting/Open.
 * A request that is no longer open must never stay in this list.
 * Stale public creators are hidden from other players; the owner still sees
 * their own waiting row so they can cancel it.
 *
 * @param {Array<{ id?: string, status?: string }|null|undefined>} open
 * @param {{ id?: string, status?: string }|null|undefined} own
 * @param {number} [now]
 */
export function visibleFindMatchRequests(open, own, now = Date.now()) {
  return (Array.isArray(open) ? open : []).filter((row) => {
    if (!row || row.status !== "open") return false;
    if (own && row.id === own.id && own.status !== "open") return false;
    if (own && row.id === own.id) return true;
    if (isPublicMatchRequest(row) && !isPublicRequestCreatorFresh(row, now)) return false;
    return true;
  });
}

/**
 * Exact LeoPips lobby. NULL stake never matches 20/50/100/150.
 * @param {{ rulesetId?: string, stakePips?: number|null }|null|undefined} request
 * @param {unknown} styleOrRuleset
 * @param {unknown} stake
 */
export function requestMatchesFindMatchLobby(request, styleOrRuleset, stake) {
  const rulesetId = toFindMatchRulesetId(styleOrRuleset);
  const stakePips = toFindMatchStakePips(stake);
  if (!request || !rulesetId || stakePips == null) return false;
  if (!isPublicMatchRequest(request)) return false;
  if (toFindMatchStakePips(request.stakePips) == null) return false;
  return request.rulesetId === rulesetId && request.stakePips === stakePips;
}

/**
 * Exact public LeoPips lobby cards. Own / friend / NULL-stake rows never
 * bypass the style+stake filter.
 */
export function visibleFindMatchLobbyRequests(open, own, styleOrRuleset, stake, now = Date.now()) {
  return visibleFindMatchRequests(open, own, now).filter((row) =>
    requestMatchesFindMatchLobby(row, styleOrRuleset, stake)
  );
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
  if (/CREATOR_UNAVAILABLE/i.test(msg) || error?.code === "P0005") {
    throw new MatchmakingError("CREATOR_UNAVAILABLE", msg, error);
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
  if (/ACCOUNT_DELETED/i.test(msg)) {
    throw new MatchmakingError("ACCOUNT_DELETED", msg, error);
  }
  if (/invalid ruleset_id/i.test(msg)) {
    throw new MatchmakingError("INVALID_STYLE", msg, error);
  }
  if (/invalid stake_pips/i.test(msg)) {
    throw new MatchmakingError("INVALID_STAKE", msg, error);
  }
  if (/LOBBY_MISMATCH/i.test(msg) || /LOBBY_REQUIRED/i.test(msg) || error?.code === "P0006") {
    throw new MatchmakingError("LOBBY_MISMATCH", msg, error);
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
  // Infrastructure/network-class failures (dropped connection, aborted or
  // timed-out request, PGRST002/PGRST003, 502/503/504-style gateway errors)
  // must never collapse into the generic fallback below — same classifier
  // already used by every admin reader in this directory (adminDashboard.js,
  // adminLeopipsGift.js, adminLeopipsReads.js, adminPlayerMessages.js,
  // adminPlayerRankings.js, adminV1.js, matchRecovery.js).
  if (isInfrastructureOutageError(error) || error?.code === "PGRST003") {
    throw new MatchmakingError(SERVICE_UNAVAILABLE_CODE, msg || "service unavailable", error);
  }
  // Every specific domain/infrastructure classification above has already
  // thrown and returned. Reaching here means a genuinely unclassified
  // backend error — the fallback codes (CREATE_FAILED/ACCEPT_FAILED/
  // CANCEL_FAILED/"RPC") are all listed as EXPECTED in monitoring so they
  // never spam Sentry as crashes, but that previously meant an unexpected
  // error landing here left zero trace anywhere. Safe fields only — no raw
  // message, no tokens, no hand/secret data.
  reportSafeEvent("matchmaking_unclassified_error", {
    fallbackCode,
    postgrestCode: postgrestCodeFromError(error) || null,
    httpStatus: httpStatusFromError(error) || null,
    errorCode: typeof error?.code === "string" ? error.code : null,
  });
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
      error.code === "RANKED_PAIR_LIMIT" ||
      error.code === "CREATOR_UNAVAILABLE" ||
      error.code === "LOBBY_MISMATCH")
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
    case "CREATOR_UNAVAILABLE":
      return "findMatch.playerUnavailable";
    case "AUTH":
      return "findMatch.unavailable";
    default:
      return "friends.inviteError";
  }
}

/**
 * Atomic public LeoPips Find Match: accept oldest joinable peer in the exact
 * style+stake lobby, else reuse/create own OPEN. Server-authoritative when
 * `join_or_create_public_match_request` is hosted.
 *
 * @param {unknown} styleId
 * @param {unknown} stake
 * @param {object} [client]
 * @returns {Promise<{ outcome: 'created'|'accepted'|'already_open', request: object|null, match: object|null }>}
 */
export async function joinOrCreatePublicMatchRequest(styleId, stake, client) {
  const rulesetId = toFindMatchRulesetId(styleId);
  const stakePips = toFindMatchStakePips(stake);
  if (!rulesetId) {
    throw new MatchmakingError("INVALID_STYLE", "invalid Find Match style");
  }
  if (stakePips == null) {
    throw new MatchmakingError("INVALID_STAKE", "invalid Find Match stake");
  }
  const db = clientOf(client);
  if (typeof db.rpc !== "function") {
    throw new MatchmakingError("JOIN_OR_CREATE_UNAVAILABLE", "join_or_create unavailable");
  }
  const { data, error } = await withNetworkTimeout(
    db.rpc("join_or_create_public_match_request", {
      p_ruleset_id: rulesetId,
      p_stake_pips: stakePips,
    })
  );
  if (error) {
    if (isMissingRpcError(error)) {
      throw new MatchmakingError("JOIN_OR_CREATE_UNAVAILABLE", "join_or_create unavailable");
    }
    throwFromPostgrest(error, "CREATE_FAILED");
  }
  const payload = data && typeof data === "object" ? data : {};
  const outcome =
    payload.outcome === "accepted" ||
    payload.outcome === "already_open" ||
    payload.outcome === "created"
      ? payload.outcome
      : "created";
  const requestId = payload.request_id ?? payload.requestId ?? null;
  const matchId = payload.match_id ?? payload.matchId ?? null;
  let request = null;
  if (requestId) {
    const run = (cols) =>
      withNetworkTimeout(db.from("match_requests").select(cols).eq("id", requestId).maybeSingle());
    let { data: row, error: rowError } = await run(MATCH_REQUEST_SELECT_STAKE);
    if (rowError && isMissingStakeColumnError(rowError)) {
      ({ data: row, error: rowError } = await run(MATCH_REQUEST_SELECT));
    }
    if (rowError) throwFromPostgrest(rowError, "CREATE_FAILED");
    request = normalizeMatchRequest(row);
  }
  let match = null;
  if (outcome === "accepted" && matchId) {
    try {
      match = await getMatchWithPlayers(matchId, client);
    } catch {
      match = { id: matchId };
    }
  }
  return { outcome, request, match };
}

/**
 * Create a public open request. Backend trigger stamps creator_id = auth.uid().
 * Public staked Find Match MUST use `join_or_create_public_match_request` and
 * never silently falls back to blind INSERT (that recreates dual-OPEN races).
 * Unstaked / NULL-stake inserts keep the legacy table path.
 * @param {string} styleId
 * @param {unknown} [stakeOrClient]
 * @param {object} [client]
 */
export async function createMatchRequest(styleId, stakeOrClient, client) {
  const rulesetId = toFindMatchRulesetId(styleId);
  if (!rulesetId) {
    throw new MatchmakingError("INVALID_STYLE", "invalid Find Match style");
  }
  const stakeGiven = !isClientLike(stakeOrClient) && stakeOrClient != null && stakeOrClient !== "";
  const stakePips = stakeGiven ? toFindMatchStakePips(stakeOrClient) : null;
  if (stakeGiven && stakePips == null) {
    throw new MatchmakingError("INVALID_STAKE", "invalid Find Match stake");
  }
  const db = clientOf(isClientLike(stakeOrClient) ? stakeOrClient : client);

  // Public LeoPips stake path: atomic join-or-create only. Fail closed.
  if (stakePips != null) {
    const joined = await joinOrCreatePublicMatchRequest(styleId, stakePips, db);
    if (joined.request) {
      return joined.match
        ? {
            ...joined.request,
            matchId: joined.match.id ?? joined.request.matchId,
            _joinOutcome: joined.outcome,
            _match: joined.match,
          }
        : { ...joined.request, _joinOutcome: joined.outcome };
    }
    throw new MatchmakingError("CREATE_FAILED", "join_or_create returned no request");
  }

  const row = { ruleset_id: rulesetId };
  let { data, error } = await withNetworkTimeout(
    db.from("match_requests").insert(row).select(MATCH_REQUEST_SELECT_LEGACY).single()
  );
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
  let { data, error } = await run(MATCH_REQUEST_SELECT_STAKE, true);
  if (error && isMissingStakeColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT, true));
  }
  if (error && isMissingHeartbeatColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_INVITE, true));
  }
  if (error && isMissingInviteColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_LEGACY, false));
  }
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  return (data ?? [])
    .map((row) => normalizeMatchRequest(row))
    .filter(Boolean)
    .filter(
      (row) =>
        isPublicMatchRequest(row) &&
        !isMatchRequestExpired(row) &&
        isPublicRequestCreatorFresh(row)
    );
}

function normalizeLobbyListRow(row) {
  if (!row) return null;
  return normalizeMatchRequest({
    ...row,
    profiles: row.profiles ?? {
      display_name: row.display_name,
      avatar_id: row.avatar_id,
      country_code: row.country_code,
    },
  });
}

/**
 * Server-authoritative exact-bucket list. Missing RPC returns [] for a
 * staked lobby so Classic 20 cannot match Classic 50 through a fallback.
 * Invalid / NULL stake returns [] and is never coerced to 20.
 *
 * @param {unknown} styleOrRuleset
 * @param {unknown} stake
 * @param {object} [client]
 */
export async function listJoinableOpenMatchRequests(styleOrRuleset, stake, client) {
  const rulesetId = toFindMatchRulesetId(styleOrRuleset);
  const stakePips = toFindMatchStakePips(stake);
  if (!rulesetId || stakePips == null) return [];
  const db = clientOf(client);
  if (typeof db.rpc === "function") {
    const { data, error } = await db.rpc("list_joinable_open_match_requests", {
      p_ruleset_id: rulesetId,
      p_stake_pips: stakePips,
    });
    if (!error) {
      return (data ?? [])
        .map((row) => normalizeLobbyListRow(row))
        .filter(Boolean)
        .filter((row) => requestMatchesFindMatchLobby(row, rulesetId, stakePips))
        .filter((row) => !isMatchRequestExpired(row) && isPublicRequestCreatorFresh(row));
    }
    if (!isMissingRpcError(error)) throwFromPostgrest(error, "LIST_FAILED");
  }
  return [];
}

/**
 * Latest open or live-accepted request created by this player (for waiting / matched).
 * Accepted rows whose linked match is finished/terminal/missing are ignored so
 * historical accepted→finished cannot trap Find Match.
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
  let { data, error } = await run(MATCH_REQUEST_SELECT_STAKE, true);
  if (error && isMissingStakeColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT, true));
  }
  if (error && isMissingHeartbeatColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_INVITE, true));
  }
  if (error && isMissingInviteColumnError(error)) {
    ({ data, error } = await run(MATCH_REQUEST_SELECT_LEGACY, false));
  }
  if (error) throwFromPostgrest(error, "LIST_FAILED");
  const own = normalizeMatchRequest(data);
  if (!own) return null;
  if (own.status === "open") {
    return isMatchRequestExpired(own) ? null : own;
  }
  if (own.status === "accepted") {
    let linked = null;
    try {
      linked = await fetchLinkedMatchBrief(own.matchId, db);
    } catch {
      return null;
    }
    return isLiveOwnMatchmakingRequest(own, linked) ? own : null;
  }
  return null;
}

/**
 * @param {string} playerId
 * @param {object|{ rulesetId?: string, styleId?: string, stake?: unknown, stakePips?: unknown }} [lobbyOrClient]
 * @param {object} [client]
 */
export async function loadFindMatchBoard(playerId, lobbyOrClient, client) {
  const lobby = isClientLike(lobbyOrClient) || lobbyOrClient == null ? null : lobbyOrClient;
  const db = clientOf(isClientLike(lobbyOrClient) ? lobbyOrClient : client);
  const styleOrRuleset = lobby?.rulesetId ?? lobby?.styleId;
  const stake = lobby?.stakePips ?? lobby?.stake;
  const rulesetId = toFindMatchRulesetId(styleOrRuleset);
  const stakePips = toFindMatchStakePips(stake);
  let source = "legacy-list";
  let open;
  if (rulesetId && stakePips != null) {
    if (typeof db.rpc !== "function") {
      source = "lobby-rpc-missing";
      open = [];
    } else {
      const { data, error } = await db.rpc("list_joinable_open_match_requests", {
        p_ruleset_id: rulesetId,
        p_stake_pips: stakePips,
      });
      if (!error) {
        source = "lobby-rpc";
        open = (data ?? [])
          .map((row) => normalizeLobbyListRow(row))
          .filter(Boolean)
          .filter((row) => requestMatchesFindMatchLobby(row, rulesetId, stakePips))
          .filter((row) => !isMatchRequestExpired(row) && isPublicRequestCreatorFresh(row));
      } else if (isMissingRpcError(error)) {
        source = "lobby-rpc-missing";
        open = [];
      } else {
        throwFromPostgrest(error, "LIST_FAILED");
      }
    }
  } else {
    open = await listOpenMatchRequests(db);
  }
  const own = await getOwnLatestRequest(playerId, db);
  const canShowOwn =
    own?.status === "open" &&
    isPublicMatchRequest(own) &&
    (stakePips == null
      ? source !== "lobby-rpc-missing"
      : source === "lobby-rpc" && requestMatchesFindMatchLobby(own, rulesetId, stakePips));
  if (canShowOwn && !open.some((row) => row.id === own.id)) {
    return { open: [own, ...open], own, source };
  }
  return { open, own, source };
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
 * Accept another player's open request. Expected style + stake are sent for
 * server validation; the RPC still copies the creator's locked values.
 * @param {string} requestId
 * @param {{ playerId?: string, creatorId?: string, rulesetId?: string, styleId?: string, stakePips?: unknown, stake?: unknown }} [options]
 * @param {object} [client]
 */
export async function acceptMatchRequest(requestId, options = {}, client) {
  const { playerId, creatorId } = options;
  if (playerId && creatorId && playerId === creatorId) {
    throw new MatchmakingError("SELF_ACCEPT", "cannot accept own match request");
  }
  const expectedRuleset = toFindMatchRulesetId(options.rulesetId ?? options.styleId);
  const expectedStake = toFindMatchStakePips(options.stakePips ?? options.stake);
  const args = { p_request_id: requestId };
  if (expectedRuleset && expectedStake != null) {
    args.p_ruleset_id = expectedRuleset;
    args.p_stake_pips = expectedStake;
  }
  const db = clientOf(client);
  let { data, error } = await db.rpc("accept_match_request", args);
  if (
    error &&
    args.p_ruleset_id &&
    (isUnknownAcceptSignatureError(error) || isMissingRpcError(error))
  ) {
    ({ data, error } = await db.rpc("accept_match_request", { p_request_id: requestId }));
  }
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
  let { data: row, error: rowError } = await db
    .from("match_requests")
    .select(FRIEND_MATCH_INVITE_SELECT)
    .eq("id", requestId)
    .maybeSingle();
  if (rowError && isMissingHeartbeatColumnError(rowError)) {
    ({ data: row, error: rowError } = await db
      .from("match_requests")
      .select(FRIEND_MATCH_INVITE_SELECT_NO_HEARTBEAT)
      .eq("id", requestId)
      .maybeSingle());
  }
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
  const db = clientOf(client);
  const run = (selectCols) =>
    db
      .from("match_requests")
      .select(selectCols)
      .eq("visibility", "friend")
      .eq("status", "open")
      .eq("invitee_id", playerId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
  let { data, error } = await run(FRIEND_MATCH_INVITE_SELECT);
  if (error && isMissingHeartbeatColumnError(error)) {
    ({ data, error } = await run(FRIEND_MATCH_INVITE_SELECT_NO_HEARTBEAT));
  }
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
  const db = clientOf(client);
  const run = (selectCols) =>
    db
      .from("match_requests")
      .select(selectCols)
      .eq("visibility", "friend")
      .eq("status", "open")
      .eq("creator_id", playerId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
  let { data, error } = await run(FRIEND_MATCH_INVITE_SELECT);
  if (error && isMissingHeartbeatColumnError(error)) {
    ({ data, error } = await run(FRIEND_MATCH_INVITE_SELECT_NO_HEARTBEAT));
  }
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
 * Public Find Match waiting heartbeat. Identity is auth.uid() on the server.
 * Missing RPC (pre-migration) is a no-op.
 * @param {object} [client]
 */
export async function touchMyOpenPublicRequest(client) {
  const { data, error } = await clientOf(client).rpc("touch_my_open_public_request");
  if (error) {
    if (isMissingRpcError(error)) return false;
    throwFromPostgrest(error, "HEARTBEAT_FAILED");
  }
  return Boolean(data);
}

/**
 * Seated-player heartbeat. Missing RPC (pre-migration) is a no-op.
 * @param {string} matchId
 * @param {object} [client]
 */
export async function touchMyMatchPresence(matchId, client) {
  if (!matchId) return { ok: false, touched: false };
  let query = clientOf(client).rpc("touch_my_match_presence", {
    p_match_id: matchId,
  });
  // Bound the request so a stalled connection settles as a catchable error
  // instead of leaving this heartbeat pending forever (mirrors the same
  // fix applied to the Edge Function invoke in gameplay.js).
  if (typeof query?.abortSignal === "function" && typeof AbortSignal?.timeout === "function") {
    query = query.abortSignal(AbortSignal.timeout(NETWORK_REQUEST_TIMEOUT_MS));
  }
  const { data, error } = await query;
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
