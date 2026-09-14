/**
 * Supabase Auth password recovery helpers.
 * Uses resetPasswordForEmail + updateUser only. Never stores raw passwords.
 */

export const PASSWORD_RECOVERY_EVENT = "PASSWORD_RECOVERY";
export const PASSWORD_RESET_PATH = "/";

/** Isolated LeoPips preview — never substitute testers/production from here. */
export const LEOPIPS_PREVIEW_ORIGIN = "https://leodomino-leopips-preview.vercel.app";

/**
 * Optional build-time override (e.g. Vercel preview builds).
 * Must be an https origin; never a password or token.
 */
function envPasswordResetOrigin() {
  try {
    const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
    const raw = String(env.VITE_PASSWORD_RESET_REDIRECT || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isLoopbackOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(String(origin || ""));
  }
}

/**
 * Absolute redirect for resetPasswordForEmail.
 * Prefers the live page origin. Rejects loopback when a deployed https origin
 * (env override or known preview host) is available — prevents emails that
 * open http://localhost:3000 after Supabase verify.
 *
 * @param {{ origin?: string, hostname?: string, href?: string }} [locationLike]
 */
export function passwordResetRedirectTo(locationLike = globalThis.location) {
  const envOrigin = envPasswordResetOrigin();
  const rawOrigin = String(locationLike?.origin || "").replace(/\/$/, "");
  const hostname = String(
    locationLike?.hostname || (rawOrigin ? (() => {
      try {
        return new URL(rawOrigin).hostname;
      } catch {
        return "";
      }
    })() : "")
  ).toLowerCase();

  let origin = rawOrigin;
  if (!origin && envOrigin) origin = envOrigin;
  if (!origin && hostname === "leodomino-leopips-preview.vercel.app") {
    origin = LEOPIPS_PREVIEW_ORIGIN;
  }

  if (origin && isLoopbackOrigin(origin)) {
    if (envOrigin && !isLoopbackOrigin(envOrigin)) origin = envOrigin;
    else if (hostname === "leodomino-leopips-preview.vercel.app") origin = LEOPIPS_PREVIEW_ORIGIN;
    else {
      /* Local `npm run dev` may intentionally use localhost; Auth allowlist must include it. */
    }
  }

  if (!origin) return PASSWORD_RESET_PATH;
  return `${origin.replace(/\/$/, "")}${PASSWORD_RESET_PATH}`;
}

/**
 * Detect recovery/callback markers in URL search or hash without logging tokens.
 * @param {{ search?: string, hash?: string }} [locationLike]
 */
export function locationLooksLikeAuthCallback(locationLike = globalThis.location) {
  const search = String(locationLike?.search || "");
  const hash = String(locationLike?.hash || "");
  const combined = `${search}\n${hash}`;
  if (/[?&#]code=/.test(combined)) return true;
  if (/[?&#]type=recovery\b/i.test(combined)) return true;
  if (/access_token=/.test(combined) && /type=recovery/i.test(combined)) return true;
  return false;
}

/**
 * Strip auth callback params from the address bar without a navigation reload.
 * Never logs token values.
 * @param {Pick<Location, "pathname" | "search" | "hash" | "href"> & { replaceState?: History["replaceState"] }} [loc]
 * @param {History} [historyObj]
 */
export function clearAuthCallbackUrl(
  loc = globalThis.location,
  historyObj = globalThis.history
) {
  if (!loc || !historyObj?.replaceState) return false;
  const url = new URL(loc.href || `${loc.pathname || "/"}${loc.search || ""}${loc.hash || ""}`, "https://leodomino.local");
  let changed = false;
  for (const key of ["code", "type", "error", "error_code", "error_description"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.hash && /access_token=|refresh_token=|type=recovery/i.test(url.hash)) {
    url.hash = "";
    changed = true;
  }
  if (!changed) return false;
  const next = `${url.pathname}${url.search}${url.hash}`;
  historyObj.replaceState(historyObj.state || {}, "", next);
  return true;
}

/** Safe success copy contract — must not reveal whether the email exists. */
export const PASSWORD_RESET_SENT_COPY_KEY = "auth.forgotSent";
