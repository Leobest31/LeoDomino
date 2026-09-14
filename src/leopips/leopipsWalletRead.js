/**
 * Read-only LeoPips wallet for the authenticated Home.
 *
 * SELECT via RLS only. Does not call the wallet RPC that can insert
 * the initial grant. Does not debit, credit, or stake.
 */

import { getSupabaseClient, isSupabaseConfigured } from "../online/supabaseClient.js";
import {
  LEOPIPS_WALLET_CHANGED_EVENT,
  notifyLeoPipsWalletChanged,
} from "../online/leopipsWalletEvents.js";

export const LEOPIPS_WALLET_TABLE = "player_leopips_wallets";
export { LEOPIPS_WALLET_CHANGED_EVENT, notifyLeoPipsWalletChanged };

export class LeoPipsWalletError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "LeoPipsWalletError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asBalance(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * @param {{ client?: object }} [options]
 * @returns {Promise<{ status: "ready"|"missing", balance: number|null }>}
 */
export async function readMyLeoPipsWallet({ client } = {}) {
  if (!isSupabaseConfigured() && !client) {
    throw new LeoPipsWalletError("UNAVAILABLE", "LeoPips wallet is unavailable.");
  }

  const db = clientOf(client);
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData?.user?.id) {
    throw new LeoPipsWalletError("AUTH", "Sign in to load LeoPips.", authError);
  }

  const { data, error } = await db
    .from(LEOPIPS_WALLET_TABLE)
    .select("balance")
    .eq("player_id", authData.user.id)
    .maybeSingle();

  if (error) {
    throw new LeoPipsWalletError("READ_FAILED", error.message || "LeoPips wallet read failed.", error);
  }

  if (!data) {
    return { status: "missing", balance: null };
  }

  const balance = asBalance(data.balance);
  if (balance === null) {
    throw new LeoPipsWalletError("INVALID", "LeoPips wallet balance is invalid.");
  }

  return { status: "ready", balance };
}

/**
 * Subscribe to authoritative wallet row updates for the signed-in player.
 * Returns an unsubscribe function. Falls back to no-op when Realtime is unavailable.
 *
 * @param {(result: { status: "ready"|"missing", balance: number|null }) => void} onChange
 * @param {{ client?: object }} [options]
 * @returns {Promise<() => void>}
 */
export async function subscribeMyLeoPipsWallet(onChange, { client } = {}) {
  if (typeof onChange !== "function") return () => {};
  if (!isSupabaseConfigured() && !client) return () => {};

  const db = clientOf(client);
  const { data: authData, error: authError } = await db.auth.getUser();
  const playerId = authData?.user?.id;
  if (authError || !playerId) return () => {};

  if (typeof db.channel !== "function") return () => {};

  const channelName = `leopips-wallet:${playerId}`;
  const channel = db
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: LEOPIPS_WALLET_TABLE,
        filter: `player_id=eq.${playerId}`,
      },
      (payload) => {
        const row = payload?.new ?? payload?.old ?? null;
        const balance = asBalance(row?.balance);
        if (balance == null && !row) return;
        onChange({
          status: balance == null ? "missing" : "ready",
          balance,
        });
        notifyLeoPipsWalletChanged({ source: "realtime", balance });
      }
    );

  if (typeof channel.subscribe === "function") {
    channel.subscribe();
  }

  return () => {
    try {
      if (typeof db.removeChannel === "function") db.removeChannel(channel);
      else if (typeof channel.unsubscribe === "function") channel.unsubscribe();
    } catch {
      /* ignore teardown errors */
    }
  };
}
