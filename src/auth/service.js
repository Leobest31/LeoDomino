import { AUTH_ERROR } from "./constants.js";
import { createPlayerId, hashPassword, randomToken, verifyPassword } from "./crypto.js";
import { normalizeAvatarId } from "./avatars.js";
import { normalizeCountryCode } from "./countries.js";
import {
  clearSession,
  findAccount,
  loadAccounts,
  loadSession,
  saveAccounts,
  saveSession,
} from "./localStore.js";
import {
  normalizeEmail,
  normalizeUsername,
  publicAccount,
  validateCountry,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
  validateUsername,
} from "./validation.js";

export class AuthError extends Error {
  /**
   * @param {string} code
   * @param {string} [field]
   */
  constructor(code, field) {
    super(code);
    this.name = "AuthError";
    this.code = code;
    this.field = field || null;
  }
}

function fail(code, field) {
  throw new AuthError(code, field);
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
 * Local account foundation (hashed passwords, persisted session).
 * Not a cloud identity provider. Swap localStore later for online auth.
 */
export const authService = {
  getSession: restoreSession,

  /**
   * @param {{ email: string, username: string, password: string, confirmPassword: string }} input
   */
  async createAccount(input) {
    const email = normalizeEmail(input.email);
    const playerName = normalizeUsername(input.username);
    const avatarId = normalizeAvatarId(input.avatarId);
    const countryCode = normalizeCountryCode(input.countryCode);

    failIf(validateEmail(email), "email");
    failIf(validateUsername(playerName), "username");
    failIf(validatePassword(input.password), "password");
    failIf(validatePasswordConfirm(input.password, input.confirmPassword), "confirmPassword");
    failIf(validateCountry(countryCode), "country");

    const accounts = loadAccounts();
    if (findAccount(accounts, { email })) fail(AUTH_ERROR.EMAIL_TAKEN, "email");

    let passwordRecord;
    try {
      passwordRecord = await hashPassword(input.password);
    } catch {
      fail(AUTH_ERROR.CRYPTO);
    }

    const record = {
      playerId: createPlayerId(),
      email,
      username: playerName,
      displayName: playerName,
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

  /**
   * @param {{ email: string, password: string }} input
   */
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

  /**
   * Update the visible profile fields for the signed-in playerId.
   * Does not change email, password, or playerId.
   */
  async updateProfile(input) {
    const session = loadSession();
    if (!session?.playerId) fail(AUTH_ERROR.CREDENTIALS);

    const playerName = normalizeUsername(input.username);
    const avatarId = normalizeAvatarId(input.avatarId);
    const countryCode = normalizeCountryCode(input.countryCode);

    failIf(validateUsername(playerName), "username");
    failIf(validateCountry(countryCode), "country");

    const accounts = loadAccounts();
    const index = accounts.findIndex((row) => row.playerId === session.playerId);
    if (index < 0) fail(AUTH_ERROR.CREDENTIALS);

    const next = {
      ...accounts[index],
      username: playerName,
      displayName: playerName,
      avatarId,
      countryCode,
    };
    const copy = accounts.slice();
    copy[index] = next;
    saveAccounts(copy);
    return publicAccount(next);
  },

  logout() {
    clearSession();
    return null;
  },
};

function failIf(code, field) {
  if (code) fail(code, field);
}
