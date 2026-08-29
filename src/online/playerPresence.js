/**
 * Authenticated signed-in heartbeat. Writes only auth.uid() via touch_my_presence.
 * Missing RPC is a no-op. Does not list presence. Does not accept a player id.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const PLAYER_PRESENCE_HEARTBEAT_MS = 25 * 1000;
export const PRESENCE_ONLINE_GRACE_MS = 75 * 1000;

export const PRESENCE_ERROR = Object.freeze({
  AUTH: "auth",
  UNAVAILABLE: "unavailable",
  GENERIC: "generic",
});

export class PresenceError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "PresenceError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

/**
 * Heartbeat the signed-in player. Never takes a player id.
 * Missing RPC (pre-migration) returns { ok: false, unavailable: true }.
 */
export async function touchMyPresence(client) {
  if (!client && !isSupabaseConfigured()) {
    return { ok: false, unavailable: true };
  }
  let db;
  try {
    db = clientOf(client);
  } catch {
    return { ok: false, unavailable: true };
  }
  const { data, error } = await db.rpc("touch_my_presence");
  if (error) {
    const msg = String(error?.message || error?.details || error?.code || "");
    const code = String(error?.code || "");
    if (/authentication required/i.test(msg) || code === "28000") {
      throw new PresenceError(PRESENCE_ERROR.AUTH, msg, error);
    }
    if (/does not exist|42883|PGRST202/i.test(`${msg} ${code}`)) {
      return { ok: false, unavailable: true };
    }
    return { ok: false, unavailable: false };
  }
  return data && typeof data === "object" ? { ok: data.ok !== false, lastSeenAt: data.last_seen_at ?? data.lastSeenAt ?? null } : { ok: true };
}
