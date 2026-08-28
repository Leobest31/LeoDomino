/**
 * Local account foundation — not a production cloud auth provider.
 * A future adapter (e.g. Supabase/Auth) can replace the store without changing UI.
 */

export const ACCOUNTS_STORAGE_KEY = "leodomino.accounts.v1";
export const SESSION_STORAGE_KEY = "leodomino.session.v1";

export const PASSWORD_MIN_LENGTH = 8;
export const PLAYER_NAME_MIN = 2;
export const PLAYER_NAME_MAX = 40;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = PLAYER_NAME_MAX;

export const PBKDF2_ITERATIONS = 80_000;
export const PBKDF2_HASH = "SHA-256";
export const PBKDF2_SALT_BYTES = 16;
export const PBKDF2_KEY_BITS = 256;

export const AUTH_ERROR = Object.freeze({
  REQUIRED: "required",
  EMAIL: "email",
  USERNAME: "username",
  USERNAME_TAKEN: "usernameTaken",
  DISPLAY_NAME: "displayName",
  EMAIL_TAKEN: "emailTaken",
  PASSWORD_SHORT: "passwordShort",
  PASSWORD_WEAK: "passwordWeak",
  PASSWORD_MISMATCH: "passwordMismatch",
  CREDENTIALS: "credentials",
  COUNTRY: "country",
  GENERIC: "generic",
  CRYPTO: "crypto",
});
