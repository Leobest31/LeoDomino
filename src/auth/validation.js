import { AUTH_ERROR, PASSWORD_MIN_LENGTH, PLAYER_NAME_MAX, PLAYER_NAME_MIN, USERNAME_MAX, USERNAME_MIN } from "./constants.js";
import { normalizeAvatarId } from "./avatars.js";
import { normalizeCountryCode } from "./countries.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Visible display name: letters, spaces, and common name marks. Not the unique id. */
const PLAYER_NAME_RE = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'-]*[\p{L}\p{M}])?$/u;
/** Unique handle: lowercase letter, then letters/digits/underscore. */
const UNIQUE_USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const UNSAFE_NAME_MARKS = "<>{}[]\\/";

function hasUnsafeNameChars(name) {
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code <= 0x1f || code === 0x7f || UNSAFE_NAME_MARKS.includes(ch)) {
      return true;
    }
  }
  return false;
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePlayerName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeUsername(value) {
  let handle = String(value ?? "").trim().toLowerCase();
  if (handle.startsWith("@")) handle = handle.slice(1).trim();
  return handle;
}

export function normalizeDisplayName(value, username) {
  const next = normalizePlayerName(value);
  return next || normalizePlayerName(username);
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return AUTH_ERROR.REQUIRED;
  if (!EMAIL_RE.test(email) || email.length > 120) return AUTH_ERROR.EMAIL;
  return null;
}

export function validateUsername(value) {
  const handle = normalizeUsername(value);
  if (!handle) return AUTH_ERROR.REQUIRED;
  if (handle.length < USERNAME_MIN || handle.length > USERNAME_MAX) {
    return AUTH_ERROR.USERNAME;
  }
  if (!UNIQUE_USERNAME_RE.test(handle)) {
    return AUTH_ERROR.USERNAME;
  }
  return null;
}

export function validateCountry(value) {
  const code = normalizeCountryCode(value);
  if (!code) return AUTH_ERROR.COUNTRY;
  return null;
}

export function validateDisplayName(value) {
  const name = normalizePlayerName(value);
  if (!name) return null;
  if (name.length < PLAYER_NAME_MIN || name.length > PLAYER_NAME_MAX) {
    return AUTH_ERROR.DISPLAY_NAME;
  }
  if (hasUnsafeNameChars(name) || !PLAYER_NAME_RE.test(name)) {
    return AUTH_ERROR.DISPLAY_NAME;
  }
  return null;
}

export function validatePassword(value) {
  const password = String(value ?? "");
  if (!password) return AUTH_ERROR.REQUIRED;
  if (password.length < PASSWORD_MIN_LENGTH) return AUTH_ERROR.PASSWORD_SHORT;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return AUTH_ERROR.PASSWORD_WEAK;
  return null;
}

export function validatePasswordConfirm(password, confirm) {
  if (String(confirm ?? "") !== String(password ?? "")) return AUTH_ERROR.PASSWORD_MISMATCH;
  return null;
}

export function publicAccount(record) {
  if (!record) return null;
  return {
    playerId: record.playerId,
    email: record.email,
    username: record.username,
    displayName: record.displayName,
    avatarId: normalizeAvatarId(record.avatarId),
    countryCode: String(record.countryCode || ""),
    createdAt: record.createdAt,
  };
}
