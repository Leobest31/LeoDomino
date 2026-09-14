/**
 * Admin → player direct messages. Never uses a service-role key.
 * Separate from friend chat / gameplay / LeoPips.
 */
import { getSupabaseClient } from "./supabaseClient.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";

export const ADMIN_PLAYER_MESSAGE_MAX = 500;

function clientOf(client) {
  return client ?? getSupabaseClient();
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
  if (isInfrastructureOutageError(error) || code === "PGRST003") {
    throw new AdminError(ADMIN_ERROR.BACKEND, msg, error);
  }
  throw new AdminError(ADMIN_ERROR.GENERIC, msg, error);
}

async function rpc(name, payload, client) {
  const db = clientOf(client);
  const { data, error } = await db.rpc(name, payload);
  if (error) throwFromError(error);
  return data;
}

/** Trim whitespace; collapse internal runs of space for validation display. */
export function trimAdminPlayerMessage(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @returns {"" | "EMPTY" | "TOO_LONG"}
 */
export function validateAdminPlayerMessage(value) {
  const body = trimAdminPlayerMessage(value);
  if (!body) return "EMPTY";
  if (body.length > ADMIN_PLAYER_MESSAGE_MAX) return "TOO_LONG";
  return "";
}

export function normalizeAdminPlayerMessage(row) {
  if (!row || typeof row !== "object") return null;
  const id = asText(row.id);
  const targetPlayerId = asText(row.target_player_id ?? row.targetPlayerId);
  const messageText = asText(row.message_text ?? row.messageText);
  if (!id || !targetPlayerId || !messageText) return null;
  const readAt = asText(row.read_at ?? row.readAt);
  return {
    id,
    targetPlayerId,
    createdBy: asText(row.created_by ?? row.createdBy),
    messageText,
    createdAt: asText(row.created_at ?? row.createdAt),
    readAt,
    seen: Boolean(readAt),
  };
}

export async function sendAdminPlayerMessage(playerId, message, client) {
  const id = asText(playerId);
  const body = trimAdminPlayerMessage(message);
  const invalid = validateAdminPlayerMessage(body);
  if (!id) throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  if (invalid === "EMPTY") throw new AdminError(ADMIN_ERROR.GENERIC, "message required");
  if (invalid === "TOO_LONG") throw new AdminError(ADMIN_ERROR.GENERIC, "message too long");
  const data = await rpc(
    "admin_send_player_message",
    { p_player_id: id, p_message: body },
    client
  );
  const row = normalizeAdminPlayerMessage(data);
  if (!row) throw new AdminError(ADMIN_ERROR.GENERIC, "invalid send response");
  return row;
}

export async function fetchAdminPlayerMessages(playerId, limit = 20, client) {
  const id = asText(playerId);
  if (!id) throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  const data = await rpc(
    "admin_list_player_messages",
    {
      p_player_id: id,
      p_limit: Math.min(Math.max(Number(limit) || 20, 1), 50),
    },
    client
  );
  const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return {
    playerId: asText(data?.player_id ?? data?.playerId) || id,
    items: raw.map(normalizeAdminPlayerMessage).filter(Boolean),
  };
}

export async function listMyUnreadAdminMessages(client) {
  const data = await rpc("list_my_unread_admin_messages", {}, client);
  const raw = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return raw.map(normalizeAdminPlayerMessage).filter(Boolean);
}

export async function markMyAdminMessageRead(messageId, client) {
  const id = asText(messageId);
  if (!id) throw new AdminError(ADMIN_ERROR.GENERIC, "message required");
  const data = await rpc("mark_my_admin_message_read", { p_message_id: id }, client);
  return {
    ok: data?.ok === true || data?.ok === "true",
    id: asText(data?.id) || id,
    readAt: asText(data?.read_at ?? data?.readAt),
  };
}

/**
 * Realtime INSERT for the signed-in player's own Admin DMs.
 * RLS still restricts rows; filter is defense-in-depth.
 */
export function subscribeMyAdminPlayerMessages(playerId, onInsert, client) {
  const id = asText(playerId);
  if (!id || typeof onInsert !== "function") return () => {};
  const db = clientOf(client);
  const channel = db.channel(`leo-admin-player-messages:${id}`);
  channel
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "admin_player_messages",
        filter: `target_player_id=eq.${id}`,
      },
      (payload) => {
        const row = normalizeAdminPlayerMessage(payload?.new || payload);
        if (row) onInsert(row);
      }
    )
    .subscribe();
  return () => {
    db.removeChannel(channel);
  };
}

/**
 * Merge durable unread + live inserts without duplicates (by id).
 * Oldest-first queue.
 */
export function mergeAdminMessageQueue(existing, incoming) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const add = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
  for (const row of add) {
    const msg = normalizeAdminPlayerMessage(row) || row;
    if (!msg?.id) continue;
    if (list.some((item) => item.id === msg.id)) continue;
    list.push(msg);
  }
  return list.sort((a, b) => {
    const ta = String(a.createdAt || "");
    const tb = String(b.createdAt || "");
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

/** True when LeoPips victory overlay is mounted (admin modal queues behind it). */
export function isLeoPipsVictoryOverlayOpen(root = typeof document !== "undefined" ? document : null) {
  if (!root || typeof root.querySelector !== "function") return false;
  return Boolean(root.querySelector('[data-leopips-victory]'));
}
