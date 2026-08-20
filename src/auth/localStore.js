import { ACCOUNTS_STORAGE_KEY, SESSION_STORAGE_KEY } from "./constants.js";
import { readStorage, removeStorage, writeStorage } from "../utils/storage.js";

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stripSecrets(record) {
  if (!record || typeof record !== "object") return null;
  const password = record.password;
  if (!password || typeof password !== "object") return null;
  if (typeof record.passwordPlain === "string" || typeof record.password === "string") {
    return null;
  }
  return {
    playerId: String(record.playerId || ""),
    email: String(record.email || ""),
    username: String(record.username || ""),
    displayName: String(record.displayName || record.username || ""),
    avatarId: String(record.avatarId || ""),
    countryCode: String(record.countryCode || ""),
    createdAt: String(record.createdAt || ""),
    password: {
      alg: String(password.alg || ""),
      iterations: Number(password.iterations) || 0,
      salt: String(password.salt || ""),
      hash: String(password.hash || ""),
    },
  };
}

export function loadAccounts() {
  const parsed = parseJson(readStorage(ACCOUNTS_STORAGE_KEY, "[]"), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(stripSecrets).filter((row) => row?.playerId && row.email && row.password?.hash);
}

export function saveAccounts(accounts) {
  const safe = accounts.map(stripSecrets).filter(Boolean);
  writeStorage(ACCOUNTS_STORAGE_KEY, JSON.stringify(safe));
}

export function loadSession() {
  const parsed = parseJson(readStorage(SESSION_STORAGE_KEY, "null"), null);
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.playerId || typeof parsed.playerId !== "string") return null;
  return {
    playerId: parsed.playerId,
    token: typeof parsed.token === "string" ? parsed.token : "",
    issuedAt: typeof parsed.issuedAt === "string" ? parsed.issuedAt : "",
  };
}

export function saveSession(session) {
  writeStorage(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      playerId: session.playerId,
      token: session.token,
      issuedAt: session.issuedAt,
    })
  );
}

export function clearSession() {
  removeStorage(SESSION_STORAGE_KEY);
}

export function findAccount(accounts, { email, username, playerId } = {}) {
  const emailNorm = email ? String(email).toLowerCase() : null;
  const userNorm = username ? String(username).toLowerCase() : null;
  return (
    accounts.find((row) => {
      if (playerId && row.playerId === playerId) return true;
      if (emailNorm && row.email === emailNorm) return true;
      if (userNorm && row.username.toLowerCase() === userNorm) return true;
      return false;
    }) || null
  );
}
