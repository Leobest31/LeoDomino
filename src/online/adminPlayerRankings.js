/**
 * Admin player rankings. Client boards: LeoPips balance, Level, XP.
 * Hosted admin_list_player_rankings pages/orders using only authoritative
 * non-Global-RP sources (player_leopips_wallets, player_progression); the
 * dashboard strips the server rank and re-orders per the selected board.
 * Level/XP come from authoritative player_progression (never LeoPips).
 */
import {
  ADMIN_ERROR,
  ADMIN_PAGE_SIZE,
  AdminError,
} from "./adminDashboard.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

const PRIVATE_FIELD = /email|phone|password|token|metadata|accountage|service.?role|raw_user|jwt/i;

export const ADMIN_RANKING_MODES = Object.freeze(["leopips", "level", "xp"]);

export const ADMIN_RANKING_FETCH_LIMIT = 50;

export const ADMIN_RANKING_MAX_PLAYERS = 2000;

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asText(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function dropPrivateKeys(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (PRIVATE_FIELD.test(key)) continue;
    out[key] = value;
  }
  return out;
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
  if (isInfrastructureOutageError(error) || code === "PGRST003") {
    throw new AdminError(ADMIN_ERROR.BACKEND, msg, error);
  }
  throw new AdminError(ADMIN_ERROR.GENERIC, msg, error);
}

async function rpc(name, args, client) {
  const db = clientOf(client);
  if (!db && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
  const { data, error } = await db.rpc(name, args);
  if (error) throwFromError(error);
  return data;
}

function nameKey(player) {
  const username = String(player?.username || "").trim().toLowerCase();
  const display = String(player?.displayName || "").trim().toLowerCase();
  const id = String(player?.playerId || "");
  return `${username}\u0000${display}\u0000${id}`;
}

function metricValue(player, mode) {
  if (mode === "level") return asInt(player?.level);
  if (mode === "xp") return asInt(player?.xp);
  return asInt(player?.leopipsBalance);
}

function compareNullableDesc(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left !== right) return right - left;
  return 0;
}

/**
 * Independent boards. Global RP never ranks — Global RP has been removed.
 * Primary metric is the selected board (LeoPips balance / level / XP); ties
 * fall through the same authoritative cascade regardless of board:
 * LeoPips balance DESC, level DESC, lifetime XP DESC,
 * qualifying_public_completed_wins DESC, then name/id ASC.
 * NULL primary metrics sort after real values (unranked).
 */
export function comparePlayerRankings(left, right, mode = "leopips") {
  const wanted = ADMIN_RANKING_MODES.includes(mode) ? mode : "leopips";
  const primary = compareNullableDesc(metricValue(left, wanted), metricValue(right, wanted));
  if (primary !== 0) return primary;
  if (wanted !== "leopips") {
    const leopipsTie = compareNullableDesc(metricValue(left, "leopips"), metricValue(right, "leopips"));
    if (leopipsTie !== 0) return leopipsTie;
  }
  if (wanted !== "level") {
    const levelTie = compareNullableDesc(asInt(left?.level), asInt(right?.level));
    if (levelTie !== 0) return levelTie;
  }
  if (wanted !== "xp") {
    const xpTie = compareNullableDesc(metricValue(left, "xp"), metricValue(right, "xp"));
    if (xpTie !== 0) return xpTie;
  }
  const qualifyingTie = compareNullableDesc(
    asInt(left?.qualifyingWins) ?? 0,
    asInt(right?.qualifyingWins) ?? 0
  );
  if (qualifyingTie !== 0) return qualifyingTie;
  return nameKey(left).localeCompare(nameKey(right));
}

export function sortPlayerRankings(players, mode = "leopips") {
  return (Array.isArray(players) ? players.slice() : []).sort((left, right) =>
    comparePlayerRankings(left, right, mode)
  );
}

export function assignRankingRanks(players, mode = "leopips") {
  let next = 0;
  return sortPlayerRankings(players, mode).map((player) => {
    if (metricValue(player, mode) == null) return { ...player, rank: null };
    next += 1;
    return { ...player, rank: next };
  });
}

export function paginateRankings(players, { limit = ADMIN_PAGE_SIZE, offset = 0, mode = "leopips" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || ADMIN_PAGE_SIZE, 1), 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const ranked = assignRankingRanks(players, mode);
  return {
    players: ranked.slice(safeOffset, safeOffset + safeLimit),
    total: ranked.length,
    limit: safeLimit,
    offset: safeOffset,
    mode: ADMIN_RANKING_MODES.includes(mode) ? mode : "leopips",
  };
}

export function searchPlayerRankings(players, query) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return Array.isArray(players) ? players.slice() : [];
  return (Array.isArray(players) ? players : []).filter((player) => {
    const username = String(player?.username || "").toLowerCase();
    const display = String(player?.displayName || "").toLowerCase();
    return username.includes(wanted) || display.includes(wanted);
  });
}

export function normalizeAdminRankingPlayer(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  return {
    playerId,
    displayName: asText(data.display_name ?? data.displayName) || "",
    username: asText(data.username) || "",
    avatarId: asText(data.avatar_id ?? data.avatarId) || "",
    // Hosted RPC rank is a raw pagination order — never keep it for the UI.
    rank: null,
    level: asInt(data.level),
    xp: asInt(data.xp),
    qualifyingWins: asInt(
      data.qualifying_public_completed_wins ?? data.qualifyingWins
    ),
    progressionRank: asText(data.progression_rank ?? data.progressionRank) || null,
    leopipsBalance: asInt(data.leopips_balance ?? data.leopipsBalance),
  };
}

export function normalizeAdminRankingPage(row) {
  if (!row || typeof row !== "object") {
    return {
      players: [],
      total: 0,
      limit: ADMIN_PAGE_SIZE,
      offset: 0,
      levelXpAvailable: false,
    };
  }
  const data = dropPrivateKeys(row);
  const players = (Array.isArray(data.players) ? data.players : [])
    .map((item) => normalizeAdminRankingPlayer(item))
    .filter(Boolean);
  return {
    players,
    total: asInt(data.total) ?? players.length,
    limit: asInt(data.limit) ?? ADMIN_PAGE_SIZE,
    offset: asInt(data.offset) ?? 0,
    levelXpAvailable: data.level_xp_available === true || data.levelXpAvailable === true,
  };
}

export function rankingPlayerAsUser(player) {
  if (!player) return null;
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    username: player.username,
    avatarId: player.avatarId,
    countryCode: "",
    createdAt: null,
    deletedAt: null,
    inActiveMatch: false,
    rank: player.rank,
    level: player.level,
    xp: player.xp,
    qualifyingWins: player.qualifyingWins,
    progressionRank: player.progressionRank,
    leopipsBalance: player.leopipsBalance,
  };
}

export async function fetchAdminPlayerRankings(query = {}, client) {
  const data = await rpc(
    "admin_list_player_rankings",
    {
      p_search: query.search || null,
      p_limit: query.limit ?? ADMIN_PAGE_SIZE,
      p_offset: query.offset ?? 0,
    },
    client
  );
  return normalizeAdminRankingPage(data);
}

/**
 * Load every ranking page then let the dashboard rank on the client.
 * Server rank is a raw pagination order and is stripped in normalize.
 */
export async function fetchAdminPlayerRankingUniverse(query = {}, client) {
  const search = query.search || null;
  const players = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let levelXpAvailable = false;
  while (offset < total && players.length < ADMIN_RANKING_MAX_PLAYERS) {
    const page = await fetchAdminPlayerRankings(
      {
        search,
        limit: ADMIN_RANKING_FETCH_LIMIT,
        offset,
      },
      client
    );
    total = Number.isFinite(page.total) ? page.total : 0;
    if (page.levelXpAvailable === true) levelXpAvailable = true;
    const batch = Array.isArray(page.players) ? page.players : [];
    players.push(...batch);
    if (!batch.length) break;
    offset += ADMIN_RANKING_FETCH_LIMIT;
  }
  return { players, levelXpAvailable };
}
