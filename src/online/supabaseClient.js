/**
 * Checkpoint 0 — Supabase client foundation only.
 * Does not implement auth, matchmaking, presence, or match sync.
 * The live app must not import this until a later online checkpoint.
 */
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL_ENV = "VITE_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "VITE_SUPABASE_ANON_KEY";

function readViteEnv(name) {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function missingConfigMessage() {
  return `Supabase is not configured. Set ${SUPABASE_URL_ENV} and ${SUPABASE_ANON_KEY_ENV}.`;
}

export function getSupabaseConfig() {
  return {
    url: readViteEnv(SUPABASE_URL_ENV),
    anonKey: readViteEnv(SUPABASE_ANON_KEY_ENV),
  };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

let client = null;

/**
 * Reusable browser client using the public anon key only.
 * Throws if URL or anon key are missing.
 */
export function getSupabaseClient() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    const error = new Error(missingConfigMessage());
    if (import.meta.env?.DEV) {
      console.error(error.message);
    }
    throw error;
  }
  if (!client) {
    client = createClient(url, anonKey);
  }
  return client;
}
