/**
 * Checkpoint 1 — Supabase Auth adapter.
 * Trusted online identity is the Auth user UUID. No client-generated playerId.
 * Unique username and display_name live on public.profiles once the username
 * migration is applied. user_metadata stays a fallback until then.
 */
import { getSupabaseClient } from "../online/supabaseClient.js";
import { AUTH_ERROR } from "./constants.js";
import { AuthError } from "./errors.js";
import { clearAccountLocalData, deleteMyAccount } from "../online/accountDeletion.js";
import { normalizeAvatarId } from "./avatars.js";
import { normalizeCountryCode } from "./countries.js";
import {
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
  parseAccountAge,
  publicAccount,
  validateCountry,
  validateDisplayName,
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

function errorText(error) {
  return String(error?.message || error?.details || error?.hint || error?.code || "").toLowerCase();
}

export function isMissingSchemaError(error) {
  const code = String(error?.code || "");
  const message = errorText(error);
  return (
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "42703" ||
    code === "42883" ||
    message.includes("schema cache") ||
    message.includes("could not find the function") ||
    message.includes("does not exist")
  );
}

export function isUsernameTakenError(error) {
  const message = errorText(error);
  return (
    message.includes("username is already taken") ||
    message.includes("profiles_username_unique") ||
    (message.includes("duplicate key") && message.includes("username")) ||
    (message.includes("unique constraint") && message.includes("username"))
  );
}

export function isUsernameInvalidError(error) {
  const message = errorText(error);
  return (
    message.includes("username is required") ||
    message.includes("invalid username") ||
    message.includes("username cannot be cleared")
  );
}

function mapSupabaseError(error) {
  const message = errorText(error);
  const code = String(error?.code || "").toLowerCase();
  if (isUsernameTakenError(error)) {
    return new AuthError(AUTH_ERROR.USERNAME_TAKEN, "username");
  }
  if (isUsernameInvalidError(error)) {
    return new AuthError(AUTH_ERROR.USERNAME, "username");
  }
  if (message.includes("account_age_under")) {
    return new AuthError(AUTH_ERROR.AGE_UNDER, "age");
  }
  if (message.includes("account_age")) {
    return new AuthError(AUTH_ERROR.AGE, "age");
  }
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

export function accountFromUser(user, profileRow) {
  if (!user?.id) return null;
  const deletionPending = Boolean(profileRow?.deleted_at);
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const username = deletionPending
    ? ""
    : normalizeUsername(profileRow?.username || meta.username || "");
  const displayName = deletionPending
    ? profileRow?.display_name || "Deleted player"
    : normalizeDisplayName(
        profileRow?.display_name || meta.displayName || meta.display_name,
        username
      );
  return publicAccount({
    playerId: user.id,
    email: normalizeEmail(user.email || ""),
    username,
    displayName,
    avatarId: deletionPending
      ? normalizeAvatarId(profileRow?.avatar_id)
      : normalizeAvatarId(profileRow?.avatar_id || meta.avatarId),
    countryCode: deletionPending ? "" : normalizeCountryCode(profileRow?.country_code || meta.countryCode),
    createdAt: user.created_at || new Date().toISOString(),
    deletionPending,
  });
}

function profileMetadata(username, displayName, avatarId, countryCode) {
  return {
    username,
    displayName,
    avatarId,
    countryCode,
  };
}

function signupMetadata(username, displayName, avatarId, countryCode, accountAge) {
  return {
    ...profileMetadata(username, displayName, avatarId, countryCode),
    accountAge: String(accountAge),
  };
}

async function readPublicProfile(client, playerId) {
  const full = await client
    .from("profiles")
    .select("username, display_name, avatar_id, country_code, deleted_at")
    .eq("id", playerId)
    .maybeSingle();
  if (!full.error) return full.data || null;
  if (isMissingSchemaError(full.error)) {
    const fallback = await client
      .from("profiles")
      .select("username, display_name, avatar_id, country_code")
      .eq("id", playerId)
      .maybeSingle();
    if (fallback.error) return null;
    return fallback.data || null;
  }
  return null;
}

async function writePublicProfile(client, playerId, { username, displayName, avatarId, countryCode }) {
  const payload = {
    display_name: displayName,
    avatar_id: avatarId,
    country_code: countryCode,
  };
  if (username) payload.username = username;
  const { error } = await client.from("profiles").update(payload).eq("id", playerId);
  if (!error) return;
  if (username) {
    const withoutUsername = {
      display_name: displayName,
      avatar_id: avatarId,
      country_code: countryCode,
    };
    const fallback = await client.from("profiles").update(withoutUsername).eq("id", playerId);
    if (fallback?.error && !isMissingSchemaError(fallback.error)) {
      throw mapSupabaseError(fallback.error);
    }
    throw mapSupabaseError(error);
  }
  if (isMissingSchemaError(error)) return;
  throw mapSupabaseError(error);
}

async function claimUsernameFromMetadata(client, user, profileRow) {
  if (profileRow?.deleted_at) return profileRow;
  if (profileRow?.username) return profileRow;
  const meta = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const username = normalizeUsername(meta.username || "");
  if (!user?.id || validateUsername(username)) return profileRow;
  const available = await usernameIsAvailable(client, username);
  if (!available) return profileRow;
  try {
    await writePublicProfile(client, user.id, {
      username,
      displayName: normalizeDisplayName(profileRow?.display_name || meta.displayName || meta.display_name, username),
      avatarId: normalizeAvatarId(profileRow?.avatar_id || meta.avatarId),
      countryCode: normalizeCountryCode(profileRow?.country_code || meta.countryCode),
    });
    return (await readPublicProfile(client, user.id)) || { ...profileRow, username };
  } catch {
    return profileRow;
  }
}

async function usernameIsAvailable(client, username) {
  const { data, error } = await client.rpc("is_username_available", { p_username: username });
  if (error) {
    if (isMissingSchemaError(error)) return true;
    if (isUsernameTakenError(error)) return false;
    throw mapSupabaseError(error);
  }
  return data !== false;
}

function resolvedNames(input) {
  const username = normalizeUsername(input.username);
  const displayName = normalizeDisplayName(input.displayName, username);
  failIf(validateUsername(username), "username");
  failIf(validateDisplayName(input.displayName), "displayName");
  return { username, displayName };
}

/**
 * @param {() => { auth: object, from?: Function, rpc?: Function }} getClient
 */
export function createCloudAuth(getClient = getSupabaseClient) {
  const client = () => getClient();

  async function accountFromCloudUser(user) {
    if (!user?.id) return null;
    const row = await claimUsernameFromMetadata(client(), user, await readPublicProfile(client(), user.id));
    return accountFromUser(user, row);
  }

  async function accountFromSession(session) {
    return accountFromCloudUser(session?.user);
  }

  return {
    async getSession() {
      const { data, error } = await client().auth.getSession();
      if (error) throw mapSupabaseError(error);
      return accountFromSession(data?.session);
    },

    async createAccount(input) {
      const email = normalizeEmail(input.email);
      const { username, displayName } = resolvedNames(input);
      const avatarId = normalizeAvatarId(input.avatarId);
      const countryCode = normalizeCountryCode(input.countryCode);

      failIf(validateEmail(email), "email");
      failIf(validatePassword(input.password), "password");
      failIf(validatePasswordConfirm(input.password, input.confirmPassword), "confirmPassword");
      failIf(validateCountry(countryCode), "country");
      const ageParsed = parseAccountAge(input.age);
      failIf(ageParsed.error, "age");

      const available = await usernameIsAvailable(client(), username);
      if (!available) fail(AUTH_ERROR.USERNAME_TAKEN, "username");

      const { data, error } = await client().auth.signUp({
        email,
        password: input.password,
        options: {
          data: signupMetadata(username, displayName, avatarId, countryCode, ageParsed.age),
        },
      });
      if (error) throw mapSupabaseError(error);
      if (!data?.session?.user) {
        fail(AUTH_ERROR.GENERIC);
      }
      try {
        await writePublicProfile(client(), data.session.user.id, {
          username,
          displayName,
          avatarId,
          countryCode,
        });
      } catch (writeError) {
        if (writeError instanceof AuthError) throw writeError;
      }
      return accountFromCloudUser(data.session.user);
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
      return accountFromCloudUser(data.session.user);
    },

    async updateProfile(input) {
      const current = await this.getSession();
      if (!current) fail(AUTH_ERROR.CREDENTIALS);
      if (current.deletionPending) fail(AUTH_ERROR.ACCOUNT_DELETED);

      const { username, displayName } = resolvedNames({
        username: input.username ?? current.username,
        displayName: input.displayName ?? current.displayName,
      });
      const avatarId = normalizeAvatarId(input.avatarId);
      const countryCode = normalizeCountryCode(input.countryCode);
      failIf(validateCountry(countryCode), "country");

      if (username !== current.username) {
        const available = await usernameIsAvailable(client(), username);
        if (!available) fail(AUTH_ERROR.USERNAME_TAKEN, "username");
      }

      await writePublicProfile(client(), current.playerId, {
        username,
        displayName,
        avatarId,
        countryCode,
      });

      const { data, error } = await client().auth.updateUser({
        data: profileMetadata(username, displayName, avatarId, countryCode),
      });
      if (error) throw mapSupabaseError(error);
      return (await accountFromCloudUser(data?.user)) || current;
    },

    async logout() {
      const { error } = await client().auth.signOut();
      if (error) throw mapSupabaseError(error);
      return null;
    },

    async deleteAccount(password) {
      await deleteMyAccount(client(), password);
      try {
        await client().auth.signOut();
      } catch {
        /* session may already be invalid after Auth delete */
      }
      clearAccountLocalData();
      return null;
    },

    onAuthStateChange(handler) {
      let generation = 0;
      const { data } = client().auth.onAuthStateChange((_event, session) => {
        const myGeneration = ++generation;
        handler(accountFromUser(session?.user));
        if (!session?.user) return;
        void accountFromCloudUser(session.user).then((full) => {
          if (myGeneration === generation && full) handler(full);
        });
      });
      return () => data?.subscription?.unsubscribe?.();
    },
  };
}

export const cloudAuth = createCloudAuth();
