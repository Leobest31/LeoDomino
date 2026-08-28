/**
 * Cloud account deletion client.
 * Re-authenticates the signed-in user with their password, then invokes
 * delete-account with that password. Never sends a target user id.
 * Never embeds a service-role key.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";
import { AUTH_ERROR, SESSION_STORAGE_KEY } from "../auth/constants.js";
import { AuthError } from "../auth/errors.js";
import { clearOnlineSession } from "./onlineTable.js";
import { clearMatchSave, resetStats } from "../persistence/index.js";
import { removeStorage } from "../utils/storage.js";
import { HOME_PROFILE_KEY } from "../persistence/homeProfile.js";
import { REFERRAL_NOTICE_STORAGE_KEY, REFERRAL_PENDING_STORAGE_KEY } from "./referrals.js";

export class AccountDeletionError extends AuthError {
  constructor(code, field) {
    super(code, field);
    this.name = "AccountDeletionError";
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function codeFromPayload(payload) {
  const nested = payload?.error?.code || payload?.code || payload?.reason;
  return typeof nested === "string" && nested ? nested : "";
}

async function payloadFromInvokeError(error) {
  const context = error?.context;
  if (!context) return null;
  if (typeof context.json === "function") {
    try {
      const source = typeof context.clone === "function" ? context.clone() : context;
      return await source.json();
    } catch {
      return null;
    }
  }
  if (typeof context === "object") return context;
  return null;
}

async function throwFromInvoke(error, data) {
  const fromContext = await payloadFromInvokeError(error);
  const fromData = codeFromPayload(data);
  const fromError = codeFromPayload(fromContext) || String(error?.code || "");
  const message = String(
    fromContext?.error?.message ||
      data?.error?.message ||
      error?.message ||
      fromData ||
      fromError
  );
  const combined = `${fromData} ${fromError} ${message}`;
  if (/INVALID_PASSWORD/i.test(combined)) {
    throw new AccountDeletionError(AUTH_ERROR.INVALID_PASSWORD, "password");
  }
  if (/AUTH_DELETE_FAILED/i.test(combined)) {
    throw new AccountDeletionError(AUTH_ERROR.DELETE_PENDING);
  }
  if (/SERVER_MISCONFIGURED/i.test(combined)) {
    throw new AccountDeletionError(AUTH_ERROR.DELETE_UNAVAILABLE);
  }
  if (/AUTH_REQUIRED/i.test(combined)) {
    throw new AccountDeletionError(AUTH_ERROR.CREDENTIALS);
  }
  throw new AccountDeletionError(AUTH_ERROR.DELETE_FAILED);
}

async function assertCurrentPassword(db, password) {
  const secret = typeof password === "string" ? password : "";
  if (!secret) {
    throw new AccountDeletionError(AUTH_ERROR.INVALID_PASSWORD, "password");
  }
  const { data: current, error: userError } = await db.auth.getUser();
  const email = current?.user?.email;
  const signedInId = current?.user?.id;
  if (userError || !email || !signedInId) {
    throw new AccountDeletionError(AUTH_ERROR.CREDENTIALS);
  }
  const { data, error } = await db.auth.signInWithPassword({ email, password: secret });
  if (error || data?.user?.id !== signedInId) {
    throw new AccountDeletionError(AUTH_ERROR.INVALID_PASSWORD, "password");
  }
}

/**
 * Device keys that belong to the signed-in account.
 * Locale, audio, and prefs stay.
 */
export function clearAccountLocalData() {
  clearOnlineSession();
  clearMatchSave();
  resetStats();
  removeStorage(HOME_PROFILE_KEY);
  removeStorage(REFERRAL_PENDING_STORAGE_KEY);
  removeStorage(REFERRAL_NOTICE_STORAGE_KEY);
  removeStorage(SESSION_STORAGE_KEY);
}

export async function deleteMyAccount(client, password) {
  if (!client && !isSupabaseConfigured()) {
    throw new AccountDeletionError(AUTH_ERROR.DELETE_UNAVAILABLE);
  }
  const db = clientOf(client);
  await assertCurrentPassword(db, password);
  const { data, error } = await db.functions.invoke("delete-account", {
    body: { password },
  });
  if (error) await throwFromInvoke(error, data);
  if (data?.error) await throwFromInvoke(null, data);
  if (!data?.ok) await throwFromInvoke(null, data || { error: { code: "DELETE_FAILED" } });
  return { ok: true };
}
