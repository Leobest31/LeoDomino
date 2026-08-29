/**
 * Admin Dashboard V1 client — staff RPCs only. Never uses a service-role key.
 */
import { STALE_MATCH_GRACE_MS } from "./matchmaking.js";
import { PRESENCE_ONLINE_GRACE_MS } from "./playerPresence.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_SEARCH_MAX = 64;
export const ADMIN_LIVE_POLL_MS = 8000;
export const ADMIN_PRESENCE_POLL_MS = 20000;
export const ADMIN_SPECTATOR_POLL_MS = 1500;

export const ADMIN_LIVE_STATUSES = Object.freeze([
  "waiting",
  "live",
  "disconnected",
  "forfeit",
  "finished",
  "aborted",
]);

export const ADMIN_ERROR = Object.freeze({
  UNAVAILABLE: "unavailable",
  AUTH: "auth",
  FORBIDDEN: "forbidden",
  GENERIC: "generic",
});

export class AdminError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "AdminError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const PRIVATE_FIELD = /email|phone|password|token|metadata|accountage|service.?role|raw_user|jwt/i;

export const ADMIN_USER_FIELDS = Object.freeze([
  "playerId",
  "displayName",
  "username",
  "countryCode",
  "avatarId",
  "createdAt",
  "deletedAt",
  "rp",
  "wins",
  "losses",
  "matchesPlayed",
  "inActiveMatch",
  "matchLastSeenAt",
  "presenceLastSeenAt",
]);

export const ADMIN_ACCOUNT_STATUSES = Object.freeze(["active", "deleted"]);
export const ADMIN_PRESENCE_STATES = Object.freeze(["online", "in_match", "offline"]);

export const ADMIN_LIVE_PLAYER_FIELDS = Object.freeze([
  "playerId",
  "displayName",
  "username",
  "avatarId",
  "rp",
  "lastSeenAt",
  "stale",
]);

export const ADMIN_LIVE_MATCH_FIELDS = Object.freeze([
  "matchId",
  "rulesetId",
  "rated",
  "matchKind",
  "matchStatus",
  "adminStatus",
  "createdAt",
  "playerA",
  "playerB",
  "scoreA",
  "scoreB",
  "round",
  "currentSeat",
  "currentPlayerId",
  "sessionStatus",
  "phase",
  "sessionUpdatedAt",
  "handCountA",
  "handCountB",
  "reserveCount",
  "version",
]);

export const ADMIN_SPECTATOR_STRIP_KEYS = Object.freeze([
  "myHand",
  "my_hand",
  "engine_state",
  "engineState",
  "game_secrets",
  "deal_seed",
  "dealSeed",
  "legalMoves",
  "legal_moves",
  "canPlay",
  "canDraw",
  "canPass",
  "mustPlayTileId",
  "reserve",
  "boneyard",
  "hands",
  "round_result",
  "roundResult",
]);

export const ADMIN_SPECTATOR_FIELDS = Object.freeze([
  ...ADMIN_LIVE_MATCH_FIELDS,
  "finishReason",
  "board",
  "spinner",
  "lastPlayPoints",
  "lastPlayScoreTerminals",
  "matchWinnerSeat",
  "turnDeadlineAt",
  "serverNow",
]);

export const OVERVIEW_CARD_IDS = Object.freeze([
  "totalAccounts",
  "newToday",
  "last7Days",
  "last30Days",
  "activeMatches",
  "activeMatchPlayers",
  "deletedAccounts",
  "globalOnlineUsers",
]);

export const ADMIN_TOP_RP_FIELDS = Object.freeze([
  "playerId",
  "displayName",
  "username",
  "avatarId",
  "rp",
  "wins",
  "losses",
  "matchesPlayed",
  "rank",
  "deletedAt",
]);

export const ADMIN_RP_EVENT_FIELDS = Object.freeze([
  "matchId",
  "opponent",
  "result",
  "rpBefore",
  "rpDelta",
  "rpAfter",
  "settledAt",
  "finishedAt",
  "rated",
  "rulesetId",
  "finishReason",
  "matchKind",
]);

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asBool(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function asText(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function throwFromError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  const code = String(error?.code || "");
  if (/authentication required/i.test(msg) || code === "28000") {
    throw new AdminError(ADMIN_ERROR.AUTH, msg, error);
  }
  if (/staff required/i.test(msg) || code === "42501") {
    throw new AdminError(ADMIN_ERROR.FORBIDDEN, msg, error);
  }
  if (/does not exist|42883|PGRST202/i.test(`${msg} ${code}`)) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE, msg, error);
  }
  throw new AdminError(ADMIN_ERROR.GENERIC, msg, error);
}

function pipValue(value) {
  const n = asInt(value);
  if (n == null || n < 0 || n > 6) return null;
  return n;
}

/**
 * Public played-tile shape only. Never reconstructs faces from a bare tile id.
 * @param {unknown} tile
 */
export function sanitizeSpectatorTile(tile) {
  if (!tile || typeof tile !== "object" || Array.isArray(tile)) return null;
  const id = asText(tile.id);
  const left = pipValue(tile.left);
  const right = pipValue(tile.right);
  if (!id || left == null || right == null) return null;
  const orientation = tile.orientation === "vertical" ? "vertical" : "horizontal";
  return {
    id,
    left,
    right,
    orientation,
    destination: asText(tile.destination) || null,
    branch: asText(tile.branch ?? tile.destination) || null,
  };
}

function sanitizeSpectatorBoard(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeSpectatorTile).filter(Boolean);
}

function sanitizeSpectatorSpinner(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: null, north: [], south: [] };
  }
  return {
    id: asText(raw.id),
    north: sanitizeSpectatorBoard(raw.north),
    south: sanitizeSpectatorBoard(raw.south),
  };
}

function sanitizeTerminalIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => asText(id)).filter(Boolean).slice(0, 8);
}

function dropPrivateKeys(row) {
  if (!row || typeof row !== "object") return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (PRIVATE_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * @param {unknown} row
 * @returns {{ isStaff: boolean, role: string | null }}
 */
export function normalizeStaffProbe(row) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const role = asText(data.role);
  const isStaff = data.is_staff === true || data.isStaff === true;
  if (!isStaff) return { isStaff: false, role: null };
  if (role !== "owner" && role !== "admin" && role !== "moderator") {
    return { isStaff: false, role: null };
  }
  return { isStaff: true, role };
}

/**
 * @param {unknown} row
 */
export function normalizeAdminOverview(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  return {
    totalActiveAccounts: asInt(data.total_active_accounts ?? data.totalActiveAccounts),
    totalDeletedAccounts: asInt(data.total_deleted_accounts ?? data.totalDeletedAccounts),
    accountsCreatedToday: asInt(data.accounts_created_today ?? data.accountsCreatedToday),
    accountsCreated7d: asInt(data.accounts_created_7d ?? data.accountsCreated7d),
    accountsCreated30d: asInt(data.accounts_created_30d ?? data.accountsCreated30d),
    activeMatchPlayerCount: asInt(data.active_match_player_count ?? data.activeMatchPlayerCount),
    activeMatchCount: asInt(data.active_match_count ?? data.activeMatchCount),
    globalOnlineUserCount: asInt(data.global_online_user_count ?? data.globalOnlineUserCount),
  };
}

/**
 * @param {unknown} overview
 * @returns {{ id: string, value: number | null, unsupported: boolean }[]}
 */
export function overviewCardsFromPayload(overview) {
  if (!overview) return [];
  const numeric = [
    { id: "totalAccounts", value: overview.totalActiveAccounts },
    { id: "newToday", value: overview.accountsCreatedToday },
    { id: "last7Days", value: overview.accountsCreated7d },
    { id: "last30Days", value: overview.accountsCreated30d },
    { id: "activeMatches", value: overview.activeMatchCount },
    { id: "activeMatchPlayers", value: overview.activeMatchPlayerCount },
    { id: "deletedAccounts", value: overview.totalDeletedAccounts },
  ]
    .filter((card) => card.value != null)
    .map((card) => ({ ...card, unsupported: false }));
  return [
    ...numeric,
    {
      id: "globalOnlineUsers",
      value: overview.globalOnlineUserCount,
      unsupported: overview.globalOnlineUserCount == null,
    },
  ];
}

/**
 * @param {unknown} row
 */
export function normalizeAdminUser(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId ?? data.id);
  if (!playerId) return null;
  const matchesPlayed = asInt(data.matches_played ?? data.matchesPlayed);
  const deletedAt = data.deleted_at ?? data.deletedAt ?? null;
  return {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    countryCode: asText(data.country_code ?? data.countryCode) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
    createdAt: asText(data.created_at ?? data.createdAt),
    deletedAt: deletedAt ? asText(deletedAt) : null,
    rp: asInt(data.rp) ?? 1000,
    wins: asInt(data.wins) ?? 0,
    losses: asInt(data.losses) ?? 0,
    matchesPlayed: matchesPlayed ?? 0,
    inActiveMatch: asBool(data.in_active_match ?? data.inActiveMatch) === true,
    matchLastSeenAt: (() => {
      const seen = data.match_last_seen_at ?? data.matchLastSeenAt ?? null;
      return seen ? asText(seen) : null;
    })(),
    presenceLastSeenAt: (() => {
      const seen = data.presence_last_seen_at ?? data.presenceLastSeenAt ?? null;
      return seen ? asText(seen) : null;
    })(),
  };
}

/**
 * Account status is the profile tombstone, never occupancy or heartbeat.
 */
export function adminAccountStatus(user) {
  return user?.deletedAt ? "deleted" : "active";
}

export function adminAccountStatusI18nKey(status) {
  return status === "deleted" ? "admin.deleted" : "admin.active";
}

function ageMs(iso, nowMs) {
  const seenMs = Date.parse(iso || "");
  if (!Number.isFinite(seenMs)) return null;
  const age = nowMs - seenMs;
  if (!Number.isFinite(age)) return null;
  return age;
}

function isFreshOccupancy(user, nowMs) {
  if (!user?.inActiveMatch) return false;
  const age = ageMs(user.matchLastSeenAt, nowMs);
  if (age == null) return true;
  if (age < 0 || age > STALE_MATCH_GRACE_MS) return false;
  return true;
}

function isFreshSignedIn(user, nowMs) {
  const age = ageMs(user.presenceLastSeenAt, nowMs);
  if (age == null || age < 0 || age > PRESENCE_ONLINE_GRACE_MS) return false;
  return true;
}

/**
 * Presence:
 * 1. Deleted => Offline
 * 2. Stale/missing signed-in heartbeat => Offline (occupancy is not enough)
 * 3. Fresh heartbeat + fresh occupancy => In Match
 * 4. Fresh heartbeat => Online
 */
export function adminPresenceState(user, nowMs = Date.now()) {
  if (user?.deletedAt) return "offline";
  if (!isFreshSignedIn(user, nowMs)) return "offline";
  if (isFreshOccupancy(user, nowMs)) return "in_match";
  return "online";
}

export function adminPresenceI18nKey(presence) {
  if (presence === "in_match") return "admin.presenceInMatch";
  if (presence === "online") return "admin.presenceOnline";
  return "admin.presenceOffline";
}

/**
 * @param {unknown} row
 */
export function normalizeAdminUserList(row) {
  if (!row || typeof row !== "object") return { users: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 };
  const data = dropPrivateKeys(row);
  const rawUsers = Array.isArray(data.users) ? data.users : [];
  const users = rawUsers.map(normalizeAdminUser).filter(Boolean);
  return {
    users,
    total: asInt(data.total) ?? users.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function sanitizeAdminSearch(raw) {
  return String(raw ?? "").trim().slice(0, ADMIN_SEARCH_MAX);
}

export function buildAdminUserListPayload({ search = "", limit = ADMIN_PAGE_SIZE, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || ADMIN_PAGE_SIZE, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    p_search: sanitizeAdminSearch(search) || null,
    p_limit: safeLimit,
    p_offset: safeOffset,
  };
}

export async function probeAmIStaff(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const { data, error } = await clientOf(client).rpc("am_i_staff");
  if (error) throwFromError(error);
  return normalizeStaffProbe(data);
}

export async function fetchAdminOverview(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const { data, error } = await clientOf(client).rpc("admin_get_overview");
  if (error) throwFromError(error);
  const overview = normalizeAdminOverview(data);
  if (!overview) throw new AdminError(ADMIN_ERROR.GENERIC);
  return overview;
}

export async function fetchAdminUsers(query = {}, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const payload = buildAdminUserListPayload(query);
  const { data, error } = await clientOf(client).rpc("admin_list_users", payload);
  if (error) throwFromError(error);
  return normalizeAdminUserList(data);
}

function asAdminStatus(value) {
  const status = asText(value);
  if (!status) return "waiting";
  if (ADMIN_LIVE_STATUSES.includes(status)) return status;
  return "waiting";
}

/**
 * @param {unknown} row
 */
export function normalizeAdminLivePlayer(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  return {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
    rp: asInt(data.rp) ?? 1000,
    lastSeenAt: asText(data.last_seen_at ?? data.lastSeenAt),
    stale: asBool(data.stale) === true,
  };
}

/**
 * @param {unknown} row
 */
export function normalizeAdminLiveMatch(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const matchId = asText(data.match_id ?? data.matchId);
  if (!matchId) return null;
  const playerA = normalizeAdminLivePlayer(data.player_a ?? data.playerA);
  const playerB = normalizeAdminLivePlayer(data.player_b ?? data.playerB);
  if (!playerA || !playerB) return null;
  return {
    matchId,
    rulesetId: asText(data.ruleset_id ?? data.rulesetId) || "",
    rated: asBool(data.rated) === true,
    matchKind: asText(data.match_kind ?? data.matchKind) || "public",
    matchStatus: asText(data.match_status ?? data.matchStatus) || "",
    adminStatus: asAdminStatus(data.admin_status ?? data.adminStatus),
    createdAt: asText(data.created_at ?? data.createdAt),
    playerA,
    playerB,
    scoreA: asInt(data.score_a ?? data.scoreA),
    scoreB: asInt(data.score_b ?? data.scoreB),
    round: asInt(data.round),
    currentSeat: asInt(data.current_seat ?? data.currentSeat),
    currentPlayerId: asText(data.current_player_id ?? data.currentPlayerId),
    sessionStatus: asText(data.session_status ?? data.sessionStatus),
    phase: asText(data.phase),
    sessionUpdatedAt: asText(data.session_updated_at ?? data.sessionUpdatedAt),
    handCountA: asInt(data.hand_count_a ?? data.handCountA),
    handCountB: asInt(data.hand_count_b ?? data.handCountB),
    reserveCount: asInt(data.reserve_count ?? data.reserveCount),
    version: asInt(data.version),
  };
}

/**
 * @param {unknown} row
 */
export function normalizeAdminLiveMatchList(row) {
  if (!row || typeof row !== "object") {
    return { matches: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 };
  }
  const data = dropPrivateKeys(row);
  const raw = Array.isArray(data.matches) ? data.matches : [];
  const matches = raw.map(normalizeAdminLiveMatch).filter(Boolean);
  return {
    matches,
    total: asInt(data.total) ?? matches.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export function buildAdminLiveMatchListPayload({ limit = ADMIN_PAGE_SIZE, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || ADMIN_PAGE_SIZE, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    p_limit: safeLimit,
    p_offset: safeOffset,
  };
}

export function liveMatchStatusKey(status) {
  switch (status) {
    case "live":
      return "admin.statusLive";
    case "disconnected":
      return "admin.statusDisconnected";
    case "forfeit":
      return "admin.statusForfeit";
    case "finished":
      return "admin.statusFinished";
    case "aborted":
      return "admin.statusAborted";
    default:
      return "admin.statusWaiting";
  }
}

export async function fetchAdminLiveMatches(query = {}, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const payload = buildAdminLiveMatchListPayload(query);
  const { data, error } = await clientOf(client).rpc("admin_list_live_matches", payload);
  if (error) throwFromError(error);
  return normalizeAdminLiveMatchList(data);
}

export function isAdminSpectatorEnded(status) {
  return status === "finished" || status === "forfeit" || status === "aborted";
}

export function shouldApplySpectatorSnapshot(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  if (prev.version !== next.version) return true;
  if (prev.adminStatus !== next.adminStatus) return true;
  if (prev.sessionUpdatedAt !== next.sessionUpdatedAt) return true;
  if (prev.matchStatus !== next.matchStatus) return true;
  if (prev.turnDeadlineAt !== next.turnDeadlineAt) return true;
  return false;
}

function hasForbiddenSpectatorKey(row) {
  if (!row || typeof row !== "object") return false;
  return ADMIN_SPECTATOR_STRIP_KEYS.some((key) => Object.prototype.hasOwnProperty.call(row, key));
}

/**
 * Staff-only spectator snapshot. Board/spinner are public played tiles.
 * Hand and boneyard identities are never copied even if a payload leaks them.
 * @param {unknown} row
 */
export function normalizeAdminSpectatorView(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  for (const key of ADMIN_SPECTATOR_STRIP_KEYS) {
    if (key in data) delete data[key];
  }
  const live = normalizeAdminLiveMatch(data);
  if (!live) return null;
  const winner = asInt(data.match_winner_seat ?? data.matchWinnerSeat);
  const view = {
    ...live,
    finishReason: asText(data.finish_reason ?? data.finishReason),
    board: sanitizeSpectatorBoard(data.board),
    spinner: sanitizeSpectatorSpinner(data.spinner),
    lastPlayPoints: asInt(data.last_play_points ?? data.lastPlayPoints),
    lastPlayScoreTerminals: sanitizeTerminalIds(
      data.last_play_score_terminals ?? data.lastPlayScoreTerminals
    ),
    matchWinnerSeat: winner === 0 || winner === 1 ? winner : null,
    turnDeadlineAt: asText(data.turn_deadline_at ?? data.turnDeadlineAt) || null,
    serverNow: asText(data.server_now ?? data.serverNow) || null,
  };
  if (hasForbiddenSpectatorKey(view)) return null;
  if ("myHand" in view || "engine_state" in view || "game_secrets" in view) return null;
  for (const key of Object.keys(view)) {
    if (!ADMIN_SPECTATOR_FIELDS.includes(key)) delete view[key];
  }
  return view;
}

export async function fetchAdminLiveMatchView(matchId, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const id = asText(matchId);
  if (!id) throw new AdminError(ADMIN_ERROR.GENERIC, "match required");
  const { data, error } = await clientOf(client).rpc("admin_get_live_match_view", {
    p_match_id: id,
  });
  if (error) throwFromError(error);
  const view = normalizeAdminSpectatorView(data);
  if (!view) throw new AdminError(ADMIN_ERROR.GENERIC);
  return view;
}

export function buildAdminTopRpPayload({ limit = ADMIN_PAGE_SIZE, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || ADMIN_PAGE_SIZE, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    p_limit: safeLimit,
    p_offset: safeOffset,
  };
}

export function buildAdminRpHistoryPayload(playerId, { limit = ADMIN_PAGE_SIZE, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || ADMIN_PAGE_SIZE, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    p_player_id: asText(playerId),
    p_limit: safeLimit,
    p_offset: safeOffset,
  };
}

/**
 * @param {unknown} row
 */
export function normalizeAdminTopRpPlayer(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  const rank = asInt(data.rank);
  const deletedAt = data.deleted_at ?? data.deletedAt ?? null;
  return {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
    rp: asInt(data.rp) ?? 1000,
    wins: asInt(data.wins) ?? 0,
    losses: asInt(data.losses) ?? 0,
    matchesPlayed: asInt(data.matches_played ?? data.matchesPlayed) ?? 0,
    rank: rank != null && rank > 0 ? rank : null,
    deletedAt: deletedAt ? asText(deletedAt) : null,
  };
}

/**
 * @param {unknown} row
 */
export function normalizeAdminTopRpList(row) {
  if (!row || typeof row !== "object") {
    return { players: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 };
  }
  const data = dropPrivateKeys(row);
  const raw = Array.isArray(data.players) ? data.players : [];
  const players = raw.map(normalizeAdminTopRpPlayer).filter(Boolean);
  return {
    players,
    total: asInt(data.total) ?? players.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

function normalizeAdminRpOpponent(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  return {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
  };
}

/**
 * Rated RP ledger event only. Unrated/friend rows and secret keys are dropped.
 * @param {unknown} row
 */
export function normalizeAdminRpEvent(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  if (asBool(data.rated) !== true) return null;
  const matchId = asText(data.match_id ?? data.matchId);
  const settledAt = asText(data.settled_at ?? data.settledAt);
  const result = asText(data.result);
  if (!matchId || !settledAt) return null;
  if (result !== "win" && result !== "loss") return null;
  const opponent = normalizeAdminRpOpponent(data.opponent);
  if (!opponent) return null;
  const rpBefore = asInt(data.rp_before ?? data.rpBefore);
  const rpDelta = asInt(data.rp_delta ?? data.rpDelta);
  const rpAfter = asInt(data.rp_after ?? data.rpAfter);
  if (rpBefore == null || rpDelta == null || rpAfter == null) return null;
  const finishedAt = data.finished_at ?? data.finishedAt ?? null;
  const event = {
    matchId,
    opponent,
    result,
    rpBefore,
    rpDelta,
    rpAfter,
    settledAt,
    finishedAt: finishedAt ? asText(finishedAt) : null,
    rated: true,
    rulesetId: asText(data.ruleset_id ?? data.rulesetId) || "",
    finishReason: asText(data.finish_reason ?? data.finishReason) || "",
    matchKind: asText(data.match_kind ?? data.matchKind) || "public",
  };
  for (const key of Object.keys(event)) {
    if (!ADMIN_RP_EVENT_FIELDS.includes(key)) delete event[key];
  }
  return event;
}

/**
 * @param {unknown} row
 */
export function normalizeAdminRpHistory(row) {
  if (!row || typeof row !== "object") {
    return { player: null, events: [], total: 0, limit: ADMIN_PAGE_SIZE, offset: 0 };
  }
  const data = dropPrivateKeys(row);
  const player = normalizeAdminTopRpPlayer(data.player);
  const raw = Array.isArray(data.events) ? data.events : [];
  const events = raw.map(normalizeAdminRpEvent).filter(Boolean);
  return {
    player,
    events,
    total: asInt(data.total) ?? events.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
  };
}

export async function fetchAdminTopRp(query = {}, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const payload = buildAdminTopRpPayload(query);
  const { data, error } = await clientOf(client).rpc("admin_list_top_rp", payload);
  if (error) throwFromError(error);
  return normalizeAdminTopRpList(data);
}

export async function fetchAdminPlayerRpHistory(playerId, query = {}, client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const payload = buildAdminRpHistoryPayload(playerId, query);
  if (!payload.p_player_id) throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  const { data, error } = await clientOf(client).rpc("admin_list_player_rp_history", payload);
  if (error) throwFromError(error);
  return normalizeAdminRpHistory(data);
}
