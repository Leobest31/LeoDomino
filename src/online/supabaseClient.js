/**
 * Supabase browser client — public anon/publishable key only.
 * persistSession stays on for Capacitor WebView; no OAuth/deep-link parsing.
 */
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL_ENV = "VITE_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "VITE_SUPABASE_ANON_KEY";

const AUTH_CLIENT_OPTIONS = Object.freeze({
  auth: Object.freeze({
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }),
});

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

function readAuthStorage() {
  try {
    const storage = globalThis.localStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
    ) {
      return storage;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let client = null;

/**
 * Reusable browser client using the public anon/publishable key only.
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
    const storage = readAuthStorage();
    client = createClient(url, anonKey, {
      auth: {
        ...AUTH_CLIENT_OPTIONS.auth,
        ...(storage ? { storage } : {}),
      },
    });
  }
  return client;
}
