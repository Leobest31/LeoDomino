import {
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  PBKDF2_KEY_BITS,
  PBKDF2_SALT_BYTES,
} from "./constants.js";

function subtle() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error("CRYPTO_UNAVAILABLE");
  }
  return cryptoObj.subtle;
}

function randomBytes(size) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("CRYPTO_UNAVAILABLE");
  }
  const bytes = new Uint8Array(size);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

export function bytesToB64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveBits(password, salt, iterations) {
  const encoded = new TextEncoder().encode(password);
  const key = await subtle().importKey("raw", encoded, "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt, iterations },
    key,
    PBKDF2_KEY_BITS
  );
  return new Uint8Array(bits);
}

/**
 * @param {string} password
 * @returns {Promise<{ alg: string, iterations: number, salt: string, hash: string }>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return {
    alg: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToB64(salt),
    hash: bytesToB64(hash),
  };
}

/**
 * @param {string} password
 * @param {{ alg?: string, iterations?: number, salt?: string, hash?: string } | null} record
 */
export async function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const iterations = Number(record.iterations) || PBKDF2_ITERATIONS;
  const salt = b64ToBytes(record.salt);
  const expected = b64ToBytes(record.hash);
  const actual = await deriveBits(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

export function randomToken() {
  return bytesToB64(randomBytes(32));
}

export function createPlayerId() {
  const hex = Array.from(randomBytes(6), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `leo_${hex}`;
}
