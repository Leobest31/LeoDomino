/**
 * Staff-only per-player match history for Admin Player Details.
 * RPC: admin_list_player_match_history. No RP tables.
 */
import {
  ADMIN_ERROR,
  AdminError,
  adminErrorI18nKey,
} from "./adminDashboard.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const ADMIN_MATCH_HISTORY_PAGE_SIZE = 20;

const PRIVATE_FIELD = /email|phone|password|token|metadata|accountage|service.?role|raw_user|jwt/i;

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

function asBool(value) {
  if (typeof value === "boolean") return value;
  return null;
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

function requireConfigured(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE);
  }
}

async function rpc(name, payload, client) {
  requireConfigured(client);
  const { data, error } = await clientOf(client).rpc(name, payload);
  if (error) throwFromError(error);
  return data && typeof data === "object" ? dropPrivateKeys(data) : {};
}

/**
 * Map ruleset_id to Classic / Haitian / American (passthrough otherwise).
 */
export function adminMatchHistoryStyleLabel(rulesetId, styleLabel) {
  const fromSql = asText(styleLabel);
  if (fromSql === "Classic" || fromSql === "Haitian" || fromSql === "American") {
    return fromSql;
  }
  const id = String(rulesetId || "").toLowerCase();
  if (id === "legacy" || id === "classic") return "Classic";
  if (id === "haitian") return "Haitian";
  if (id === "american") return "American";
  return fromSql || asText(rulesetId) || "—";
}

export function normalizeAdminMatchHistoryOpponent(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const playerId = asText(data.player_id ?? data.playerId);
  if (!playerId) return null;
  return {
    playerId,
    username: asText(data.username) || "",
    displayName: asText(data.display_name ?? data.displayName) || "",
  };
}

export function normalizeAdminMatchHistoryScore(row) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const a = asInt(data.a);
  const b = asInt(data.b);
  const selected = asInt(data.selected);
  const opponent = asInt(data.opponent);
  if (a == null && b == null && selected == null && opponent == null) return null;
  return { a, b, selected, opponent };
}

/**
 * Derive loser from winnerSeat / winnerPlayerId / opponent / selected result.
 * When the selected player lost, pass selectedPlayer to fill username/display.
 */
export function deriveAdminMatchHistoryLoser(item, selectedPlayer = null) {
  if (!item || typeof item !== "object") return null;
  const opponent = item.opponent && typeof item.opponent === "object" ? item.opponent : null;
  const selectedId = asText(selectedPlayer?.playerId);
  const winnerId = asText(item.winnerPlayerId);

  if (item.loserPlayerId || item.loserUsername || item.loserDisplayName) {
    const fromFields = {
      playerId: asText(item.loserPlayerId) || "",
      username: asText(item.loserUsername) || "",
      displayName: asText(item.loserDisplayName) || "",
    };
    if (selectedId && fromFields.playerId === selectedId) {
      return {
        playerId: selectedId,
        username: asText(selectedPlayer?.username) || fromFields.username,
        displayName: asText(selectedPlayer?.displayName) || fromFields.displayName,
      };
    }
    if (fromFields.playerId || fromFields.username || fromFields.displayName) return fromFields;
  }

  if (item.selectedResult === "win" && opponent) {
    return {
      playerId: opponent.playerId || "",
      username: opponent.username || "",
      displayName: opponent.displayName || "",
    };
  }
  if (item.selectedResult === "loss" && selectedId) {
    return {
      playerId: selectedId,
      username: asText(selectedPlayer?.username) || "",
      displayName: asText(selectedPlayer?.displayName) || "",
    };
  }

  if (winnerId && opponent) {
    if (winnerId === opponent.playerId && selectedId) {
      return {
        playerId: selectedId,
        username: asText(selectedPlayer?.username) || "",
        displayName: asText(selectedPlayer?.displayName) || "",
      };
    }
    if (winnerId !== opponent.playerId) {
      return {
        playerId: opponent.playerId || "",
        username: opponent.username || "",
        displayName: opponent.displayName || "",
      };
    }
  }

  const seat = asInt(item.winnerSeat);
  if ((seat === 0 || seat === 1) && opponent && selectedId) {
    if (winnerId === selectedId || (item.selectedResult === "win")) {
      return {
        playerId: opponent.playerId || "",
        username: opponent.username || "",
        displayName: opponent.displayName || "",
      };
    }
    if (winnerId === opponent.playerId || item.selectedResult === "loss") {
      return {
        playerId: selectedId,
        username: asText(selectedPlayer?.username) || "",
        displayName: asText(selectedPlayer?.displayName) || "",
      };
    }
  }

  return null;
}

export function normalizeAdminPlayerMatchHistoryItem(row, selectedPlayerId = null) {
  if (!row || typeof row !== "object") return null;
  const data = dropPrivateKeys(row);
  const matchId = asText(data.match_id ?? data.matchId);
  if (!matchId) return null;
  const resultRaw = asText(data.selected_result ?? data.selectedResult);
  const selectedResult =
    resultRaw === "win" || resultRaw === "loss" ? resultRaw : "unknown";
  const finishRaw = asText(data.finish_reason ?? data.finishReason);
  const finishReason =
    finishRaw === "completed" ||
    finishRaw === "timeout" ||
    finishRaw === "forfeit" ||
    finishRaw === "aborted" ||
    finishRaw === "other"
      ? finishRaw
      : finishRaw || null;
  const rulesetId = asText(data.ruleset_id ?? data.rulesetId) || "";
  const opponent = normalizeAdminMatchHistoryOpponent(data.opponent);
  const winnerSeat = asInt(data.winner_seat ?? data.winnerSeat);
  const winnerPlayerId = asText(data.winner_player_id ?? data.winnerPlayerId);
  const winnerUsername = asText(data.winner_username ?? data.winnerUsername);
  const selectedId = asText(selectedPlayerId);

  let loserPlayerId = asText(data.loser_player_id ?? data.loserPlayerId);
  let loserUsername = asText(data.loser_username ?? data.loserUsername);
  let loserDisplayName = asText(data.loser_display_name ?? data.loserDisplayName);

  if (!loserPlayerId && !loserUsername) {
    if (selectedResult === "win" && opponent) {
      loserPlayerId = opponent.playerId || null;
      loserUsername = opponent.username || null;
      loserDisplayName = opponent.displayName || null;
    } else if (selectedResult === "loss" && selectedId) {
      loserPlayerId = selectedId;
    } else if (winnerPlayerId && opponent) {
      if (winnerPlayerId === opponent.playerId && selectedId) {
        loserPlayerId = selectedId;
      } else if (winnerPlayerId !== opponent.playerId) {
        loserPlayerId = opponent.playerId || null;
        loserUsername = opponent.username || null;
        loserDisplayName = opponent.displayName || null;
      }
    }
  }

  return {
    matchId,
    opponent,
    rulesetId,
    styleLabel: adminMatchHistoryStyleLabel(rulesetId, data.style_label ?? data.styleLabel),
    matchKind: asText(data.match_kind ?? data.matchKind) || "",
    rated: asBool(data.rated),
    stakePips: asInt(data.stake_pips ?? data.stakePips),
    selectedResult,
    winnerSeat,
    winnerPlayerId,
    winnerUsername,
    loserPlayerId,
    loserUsername,
    loserDisplayName,
    finalScore: normalizeAdminMatchHistoryScore(data.final_score ?? data.finalScore),
    finishReason,
    createdAt: asText(data.created_at ?? data.createdAt),
    finishedAt: asText(data.finished_at ?? data.finishedAt),
    durationSeconds: asInt(data.duration_seconds ?? data.durationSeconds),
    status: asText(data.status) || "",
  };
}

export function normalizeAdminPlayerMatchHistory(row, selectedPlayerId = null) {
  const data = row && typeof row === "object" ? dropPrivateKeys(row) : {};
  const raw = Array.isArray(data.matches) ? data.matches : [];
  const limit = asInt(data.limit) ?? ADMIN_MATCH_HISTORY_PAGE_SIZE;
  const offset = asInt(data.offset) ?? 0;
  const total = asInt(data.total) ?? 0;
  const selectedId = asText(selectedPlayerId);
  return {
    matches: raw
      .map((item) => normalizeAdminPlayerMatchHistoryItem(item, selectedId))
      .filter(Boolean),
    total,
    limit,
    offset,
  };
}

export async function fetchAdminPlayerMatchHistory(playerId, query = {}, client) {
  const id = asText(playerId);
  if (!id) {
    throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  }
  const limit = Math.min(Math.max(asInt(query.limit) ?? ADMIN_MATCH_HISTORY_PAGE_SIZE, 1), 50);
  const offset = Math.max(asInt(query.offset) ?? 0, 0);
  return normalizeAdminPlayerMatchHistory(
    await rpc(
      "admin_list_player_match_history",
      {
        p_player_id: id,
        p_limit: limit,
        p_offset: offset,
      },
      client
    ),
    id
  );
}

export { adminErrorI18nKey };
