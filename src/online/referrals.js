/**
 * Invite & Win client — codes, share links, and attribution RPCs.
 * Counts and status stay on the server. Clicks are not referrals.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const PUBLIC_APP_URL_ENV = "VITE_PUBLIC_APP_URL";
export const REFERRAL_PENDING_STORAGE_KEY = "leodomino.referral.pendingCode";
export const REFERRAL_NOTICE_STORAGE_KEY = "leodomino.referral.notice";
export const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export class ReferralError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "ReferralError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function readViteEnv(name) {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeReferralCode(raw) {
  const code = String(raw || "").trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : "";
}

function parseHttpOrigin(value) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * Production share origin: configured public URL first, else the current http(s) origin.
 * Never hardcodes a Cloudflare Quick Tunnel host.
 */
export function getAppOrigin({ env, location } = {}) {
  const viteEnv = env || (typeof import.meta !== "undefined" ? import.meta.env : {});
  const configured = parseHttpOrigin(viteEnv?.[PUBLIC_APP_URL_ENV] || readViteEnv(PUBLIC_APP_URL_ENV));
  if (configured) return configured;
  return parseHttpOrigin(location?.origin || "");
}

export function buildReferralLink(code, options = {}) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return "";
  const origin = getAppOrigin(options);
  if (!origin) return "";
  return `${origin}/invite?ref=${encodeURIComponent(normalized)}`;
}

export function parseReferralCodeFromHref(href) {
  if (!href || typeof href !== "string") return "";
  try {
    const url = new URL(href, "https://app.local");
    const fromQuery = normalizeReferralCode(
      url.searchParams.get("ref") || url.searchParams.get("referral")
    );
    if (fromQuery) return fromQuery;
    const pathMatch = url.pathname.match(/\/invite\/([A-HJ-NP-Z2-9]{8})\/?$/i);
    if (pathMatch) return normalizeReferralCode(pathMatch[1]);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      const fromHash = normalizeReferralCode(hashParams.get("ref") || hashParams.get("referral"));
      if (fromHash) return fromHash;
    }
  } catch {
    return "";
  }
  return "";
}

function storageOf(win = globalThis) {
  try {
    return win?.localStorage;
  } catch {
    return undefined;
  }
}

export function readPendingReferralCode(win = globalThis) {
  const storage = storageOf(win);
  if (!storage) return "";
  try {
    return normalizeReferralCode(storage.getItem(REFERRAL_PENDING_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writePendingReferralCode(code, win = globalThis) {
  const normalized = normalizeReferralCode(code);
  const storage = storageOf(win);
  if (!normalized || !storage) return "";
  try {
    storage.setItem(REFERRAL_PENDING_STORAGE_KEY, normalized);
  } catch {
    return normalized;
  }
  return normalized;
}

export function clearPendingReferralCode(win = globalThis) {
  const storage = storageOf(win);
  if (!storage) return;
  try {
    storage.removeItem(REFERRAL_PENDING_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function writeReferralNotice(key, win = globalThis) {
  const storage = storageOf(win);
  if (!key || !storage) return;
  try {
    storage.setItem(REFERRAL_NOTICE_STORAGE_KEY, String(key));
  } catch {
    /* ignore */
  }
}

export function consumeReferralNotice(win = globalThis) {
  const storage = storageOf(win);
  if (!storage) return "";
  try {
    const key = storage.getItem(REFERRAL_NOTICE_STORAGE_KEY) || "";
    storage.removeItem(REFERRAL_NOTICE_STORAGE_KEY);
    return key;
  } catch {
    return "";
  }
}

export function capturePendingReferralFromWindow(win = globalThis) {
  const loc = win?.location;
  if (!loc?.href) return "";
  const code = parseReferralCodeFromHref(loc.href);
  if (!code) return "";
  writePendingReferralCode(code, win);
  if (typeof win.history?.replaceState === "function") {
    try {
      const next = new URL(loc.href);
      next.searchParams.delete("ref");
      next.searchParams.delete("referral");
      if (/\/invite(?:\/[A-HJ-NP-Z2-9]{8})?\/?$/i.test(next.pathname)) {
        next.pathname = `${next.pathname.replace(/\/invite(?:\/[A-HJ-NP-Z2-9]{8})?\/?$/i, "/")}` || "/";
      }
      const hash = next.hash.startsWith("#") ? next.hash.slice(1) : next.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash);
        hashParams.delete("ref");
        hashParams.delete("referral");
        next.hash = hashParams.toString() ? `#${hashParams}` : "";
      }
      win.history.replaceState(win.history.state, "", `${next.pathname}${next.search}${next.hash}`);
    } catch {
      /* keep the original URL if history cannot be rewritten */
    }
  }
  return code;
}

function throwFromReferralError(error, fallbackCode = "GENERIC") {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/cannot refer yourself/i.test(msg)) {
    throw new ReferralError("SELF", msg, error);
  }
  if (/referral window expired/i.test(msg)) {
    throw new ReferralError("WINDOW", msg, error);
  }
  if (/referrer already locked/i.test(msg)) {
    throw new ReferralError("LOCKED", msg, error);
  }
  if (/referral code not found/i.test(msg)) {
    throw new ReferralError("NOT_FOUND", msg, error);
  }
  if (/invalid referral code/i.test(msg)) {
    throw new ReferralError("INVALID", msg, error);
  }
  if (/no active referral season/i.test(msg)) {
    throw new ReferralError("NO_SEASON", msg, error);
  }
  if (/authentication required/i.test(msg) || error?.code === "28000") {
    throw new ReferralError("AUTH", msg, error);
  }
  throw new ReferralError(fallbackCode, msg, error);
}

export function referralNoticeKey(code) {
  switch (code) {
    case "SELF":
      return "referral.self";
    case "WINDOW":
      return "referral.windowExpired";
    case "LOCKED":
      return "referral.alreadyLocked";
    case "NOT_FOUND":
    case "INVALID":
      return "referral.notFound";
    case "NO_SEASON":
      return "referral.noSeason";
    case "AUTH":
      return "referral.auth";
    case "UNAVAILABLE":
      return "referral.unavailable";
    case "APPLIED":
      return "referral.applied";
    default:
      return "referral.generic";
  }
}

export function isReferralSuccessNotice(key) {
  return (
    key === "referral.copied" ||
    key === "referral.linkCopied" ||
    key === "referral.shared" ||
    key === "referral.applied" ||
    key === "referral.preparing"
  );
}

export async function ensureMyReferralCode(client) {
  if (!client && !isSupabaseConfigured()) {
    throw new ReferralError("UNAVAILABLE");
  }
  const { data, error } = await clientOf(client).rpc("ensure_my_referral_code");
  if (error) throwFromReferralError(error, "GENERIC");
  const code = normalizeReferralCode(data);
  if (!code) throw new ReferralError("GENERIC");
  return code;
}

export async function applyReferralCode(code, client) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new ReferralError("INVALID");
  if (!client && !isSupabaseConfigured()) throw new ReferralError("UNAVAILABLE");
  const { data, error } = await clientOf(client).rpc("apply_referral_code", {
    p_code: normalized,
  });
  if (error) throwFromReferralError(error, "GENERIC");
  return data;
}

export async function getMyReferralProfile(client) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await clientOf(client).rpc("get_my_referral_profile");
  if (error) throwFromReferralError(error, "GENERIC");
  return data;
}

/**
 * After sign-in/registration, try to lock attribution. Never throws into auth.
 * @returns {{ status: string, noticeKey: string }}
 */
export async function applyPendingReferralAttribution(options = {}) {
  const win = options.win || globalThis;
  const ownCode = normalizeReferralCode(options.ownCode);
  const pending = readPendingReferralCode(win);
  if (!pending) return { status: "none", noticeKey: "" };
  if (ownCode && pending === ownCode) {
    clearPendingReferralCode(win);
    const noticeKey = referralNoticeKey("SELF");
    writeReferralNotice(noticeKey, win);
    return { status: "self", noticeKey };
  }
  if (!options.client && !isSupabaseConfigured()) {
    return { status: "skipped", noticeKey: "" };
  }
  try {
    await applyReferralCode(pending, options.client);
    clearPendingReferralCode(win);
    const noticeKey = referralNoticeKey("APPLIED");
    writeReferralNotice(noticeKey, win);
    return { status: "applied", noticeKey };
  } catch (error) {
    const code = error instanceof ReferralError ? error.code : "GENERIC";
    if (code === "SELF" || code === "WINDOW" || code === "LOCKED" || code === "NOT_FOUND" || code === "INVALID") {
      clearPendingReferralCode(win);
    }
    const noticeKey = referralNoticeKey(code);
    writeReferralNotice(noticeKey, win);
    return { status: "rejected", noticeKey };
  }
}

function copyWithExecCommand(value) {
  const doc = globalThis.document;
  if (!doc?.body) return false;
  const area = doc.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange?.(0, value.length);
  let ok = false;
  try {
    ok = doc.execCommand?.("copy") === true;
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export async function copyText(text, clip = globalThis.navigator?.clipboard) {
  const value = String(text || "");
  if (!value) return false;
  if (clip && typeof clip.writeText === "function") {
    try {
      await clip.writeText(value);
      return true;
    } catch {
      /* fall through to execCommand; mobile browsers often require it */
    }
  }
  return copyWithExecCommand(value);
}

export async function shareReferralInvite({ title, text, url, share = globalThis.navigator?.share?.bind(globalThis.navigator) }) {
  if (typeof share === "function") {
    try {
      await share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  try {
    const copied = await copyText(url);
    return copied ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
