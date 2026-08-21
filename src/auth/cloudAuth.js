/**
 * Checkpoint 1 — Supabase Auth adapter.
 * Trusted online identity is the Auth user UUID. No client-generated playerId.
 * Profile fields live in user_metadata until Checkpoint 2.
 */
import { getSupabaseClient } from "../online/supabaseClient.js";
import { AUTH_ERROR } from "./constants.js";
import { AuthError } from "./errors.js";
import { normalizeAvatarId } from "./avatars.js";
import { normalizeCountryCode } from "./countries.js";
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

function fail(code, field) {
  throw new AuthError(code, field);
}

function failIf(code, field) {
  if (code) fail(code, field);
}

function mapSupabaseError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  if (
    code.includes("already") ||
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered")
  ) {
    return new AuthError(AUTH_ERROR.EMAIL_TAKEN, "email");
  }
  if (
    code === "invalid_credentials" ||
    message.includes("invalid login") ||
    message.includes("invalid_grant")
  ) {
    return new AuthError(AUTH_ERROR.CREDENTIALS);
  }
  return new AuthError(AUTH_ERROR.GENERIC);
}

export function accountFromUser(user) {
  if (!user?.id) return null;
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const username = normalizeUsername(meta.username || meta.displayName || "");
  return publicAccount({
    playerId: user.id,
    email: normalizeEmail(user.email || ""),
    username,
    displayName: username,
    avatarId: normalizeAvatarId(meta.avatarId),
    countryCode: normalizeCountryCode(meta.countryCode),
    createdAt: user.created_at || new Date().toISOString(),
  });
}

function accountFromSession(session) {
  return accountFromUser(session?.user);
}

function profileMetadata(username, avatarId, countryCode) {
  return {
    username,
    displayName: username,
    avatarId,
    countryCode,
  };
}

/**
 * @param {() => { auth: object }} getClient
 */
export function createCloudAuth(getClient = getSupabaseClient) {
  const client = () => getClient();

  return {
    async getSession() {
      const { data, error } = await client().auth.getSession();
      if (error) throw mapSupabaseError(error);
      return accountFromSession(data?.session);
    },

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

      const { data, error } = await client().auth.signUp({
        email,
        password: input.password,
        options: {
          data: profileMetadata(playerName, avatarId, countryCode),
        },
      });
      if (error) throw mapSupabaseError(error);
      if (!data?.session?.user) {
        fail(AUTH_ERROR.GENERIC);
      }
      return accountFromSession(data.session);
    },

    async login(input) {
      const email = normalizeEmail(input.email);
      failIf(validateEmail(email), "email");
      if (!input.password) fail(AUTH_ERROR.REQUIRED, "password");

      const { data, error } = await client().auth.signInWithPassword({
        email,
        password: input.password,
      });
      if (error) throw mapSupabaseError(error);
      if (!data?.session?.user) fail(AUTH_ERROR.CREDENTIALS);
      return accountFromSession(data.session);
    },

    async updateProfile(input) {
      const current = await this.getSession();
      if (!current) fail(AUTH_ERROR.CREDENTIALS);

      const playerName = normalizeUsername(input.username);
      const avatarId = normalizeAvatarId(input.avatarId);
      const countryCode = normalizeCountryCode(input.countryCode);

      failIf(validateUsername(playerName), "username");
      failIf(validateCountry(countryCode), "country");

      const { data, error } = await client().auth.updateUser({
        data: profileMetadata(playerName, avatarId, countryCode),
      });
      if (error) throw mapSupabaseError(error);
      return accountFromUser(data?.user) || current;
    },

    async logout() {
      const { error } = await client().auth.signOut();
      if (error) throw mapSupabaseError(error);
      return null;
    },

    onAuthStateChange(handler) {
      const { data } = client().auth.onAuthStateChange((_event, session) => {
        handler(accountFromSession(session));
      });
      return () => data?.subscription?.unsubscribe?.();
    },
  };
}

export const cloudAuth = createCloudAuth();
