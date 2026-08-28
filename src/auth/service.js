import { AUTH_ERROR } from "./constants.js";
import { AuthError } from "./errors.js";
import { createPlayerId, hashPassword, randomToken, verifyPassword } from "./crypto.js";
import { normalizeAvatarId } from "./avatars.js";
import { normalizeCountryCode } from "./countries.js";
import { isSupabaseConfigured } from "../online/supabaseClient.js";
import { cloudAuth } from "./cloudAuth.js";
import {
  clearSession,
  findAccount,
  loadAccounts,
  loadSession,
  saveAccounts,
  saveSession,
} from "./localStore.js";
import {
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
  publicAccount,
  validateCountry,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
  validateUsername,
  validateAccountAge,
} from "./validation.js";

export { AuthError };

function fail(code, field) {
  throw new AuthError(code, field);
}

function failIf(code, field) {
  if (code) fail(code, field);
}

function restoreSession() {
  const session = loadSession();
  if (!session) return null;
  const account = findAccount(loadAccounts(), { playerId: session.playerId });
  if (!account) {
    clearSession();
    return null;
  }
  return {
    ...publicAccount(account),
    issuedAt: session.issuedAt,
  };
}

/**
 * Device-local accounts (PBKDF2). Kept for unit tests and offline-only fallback
 * when Vite Supabase env vars are not configured. Not trusted as cloud identity.
 */
export const localAuth = {
  getSession: restoreSession,

  async createAccount(input) {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    const displayName = normalizeDisplayName(input.displayName, username);
    const avatarId = normalizeAvatarId(input.avatarId);
    const countryCode = normalizeCountryCode(input.countryCode);

    failIf(validateEmail(email), "email");
    failIf(validateUsername(username), "username");
    failIf(validateDisplayName(input.displayName), "displayName");
    failIf(validatePassword(input.password), "password");
    failIf(validatePasswordConfirm(input.password, input.confirmPassword), "confirmPassword");
    failIf(validateCountry(countryCode), "country");
    failIf(validateAccountAge(input.age), "age");

    const accounts = loadAccounts();
    if (findAccount(accounts, { email })) fail(AUTH_ERROR.EMAIL_TAKEN, "email");
    if (findAccount(accounts, { username })) fail(AUTH_ERROR.USERNAME_TAKEN, "username");

    let passwordRecord;
    try {
      passwordRecord = await hashPassword(input.password);
    } catch {
      fail(AUTH_ERROR.CRYPTO);
    }

    const record = {
      playerId: createPlayerId(),
      email,
      username,
      displayName,
      avatarId,
      countryCode,
      createdAt: new Date().toISOString(),
      password: passwordRecord,
    };
    saveAccounts([...accounts, record]);
    const issuedAt = new Date().toISOString();
    saveSession({ playerId: record.playerId, token: randomToken(), issuedAt });
    return publicAccount(record);
  },

  async login(input) {
    const email = normalizeEmail(input.email);
    failIf(validateEmail(email), "email");
    if (!input.password) fail(AUTH_ERROR.REQUIRED, "password");

    const account = findAccount(loadAccounts(), { email });
    let ok = false;
    try {
      ok = account ? await verifyPassword(input.password, account.password) : false;
    } catch {
      fail(AUTH_ERROR.CRYPTO);
    }
    if (!ok) fail(AUTH_ERROR.CREDENTIALS);

    const issuedAt = new Date().toISOString();
    saveSession({ playerId: account.playerId, token: randomToken(), issuedAt });
    return publicAccount(account);
  },

  async updateProfile(input) {
    const session = loadSession();
    if (!session?.playerId) fail(AUTH_ERROR.CREDENTIALS);

    const username = normalizeUsername(input.username);
    const displayName = normalizeDisplayName(input.displayName, username);
    const avatarId = normalizeAvatarId(input.avatarId);
    const countryCode = normalizeCountryCode(input.countryCode);

    failIf(validateUsername(username), "username");
    failIf(validateDisplayName(input.displayName), "displayName");
    failIf(validateCountry(countryCode), "country");

    const accounts = loadAccounts();
    const index = accounts.findIndex((row) => row.playerId === session.playerId);
    if (index < 0) fail(AUTH_ERROR.CREDENTIALS);
    const taken = findAccount(accounts, { username });
    if (taken && taken.playerId !== session.playerId) fail(AUTH_ERROR.USERNAME_TAKEN, "username");

    const next = {
      ...accounts[index],
      username,
      displayName,
      avatarId,
      countryCode,
    };
    const copy = accounts.slice();
    copy[index] = next;
    saveAccounts(copy);
    return publicAccount(next);
  },

  async logout() {
    clearSession();
    return null;
  },

  onAuthStateChange() {
    return () => {};
  },
};

function adapter() {
  return isSupabaseConfigured() ? cloudAuth : localAuth;
}

export function isCloudAuth() {
  return isSupabaseConfigured();
}

/**
 * Production uses Supabase when VITE_SUPABASE_* are set.
 * Node unit tests without Vite env keep the local adapter.
 */
export const authService = {
  async getSession() {
    return adapter().getSession();
  },
  async createAccount(input) {
    return adapter().createAccount(input);
  },
  async login(input) {
    return adapter().login(input);
  },
  async updateProfile(input) {
    return adapter().updateProfile(input);
  },
  async logout() {
    return adapter().logout();
  },
  async deleteAccount(password) {
    const current = adapter();
    if (typeof current.deleteAccount !== "function") {
      throw new AuthError(AUTH_ERROR.DELETE_UNAVAILABLE);
    }
    return current.deleteAccount(password);
  },
  onAuthStateChange(handler) {
    return adapter().onAuthStateChange(handler);
  },
};
