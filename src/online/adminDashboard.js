/**
 * Admin Dashboard V1 client — staff RPCs only. Never uses a service-role key.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_SEARCH_MAX = 64;

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
  };
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
