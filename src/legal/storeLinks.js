/**
 * Official store listing URLs. Empty until listings exist.
 * Do not invent Play or App Store IDs.
 */
export const PLAY_STORE_URL_ENV = "VITE_PLAY_STORE_URL";
export const APP_STORE_URL_ENV = "VITE_APP_STORE_URL";

function readViteEnv(name) {
  try {
    const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
    const value = env[name];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function parseHttpsUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function isOfficialPlayStoreUrl(raw) {
  const href = parseHttpsUrl(raw);
  if (!href) return false;
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === "play.google.com" || host.endsWith(".play.google.com");
  } catch {
    return false;
  }
}

export function isOfficialAppStoreUrl(raw) {
  const href = parseHttpsUrl(raw);
  if (!href) return false;
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === "apps.apple.com" || host === "itunes.apple.com";
  } catch {
    return false;
  }
}

export function getConfiguredPlayStoreUrl(env) {
  const raw = env?.[PLAY_STORE_URL_ENV] ?? readViteEnv(PLAY_STORE_URL_ENV);
  return isOfficialPlayStoreUrl(raw) ? parseHttpsUrl(raw) : "";
}

export function getConfiguredAppStoreUrl(env) {
  const raw = env?.[APP_STORE_URL_ENV] ?? readViteEnv(APP_STORE_URL_ENV);
  return isOfficialAppStoreUrl(raw) ? parseHttpsUrl(raw) : "";
}

/**
 * Listing URL for the current native platform only.
 * Web and missing config stay empty so Rate LeoDomino remains Coming Soon.
 */
export function getConfiguredStoreUrl(platform, env) {
  if (platform === "android") return getConfiguredPlayStoreUrl(env);
  if (platform === "ios") return getConfiguredAppStoreUrl(env);
  return "";
}

export function canOpenStoreListing(platform, env) {
  return Boolean(getConfiguredStoreUrl(platform, env));
}

export function openConfiguredStoreListing(platform, env, openWindow = globalThis.open) {
  const url = getConfiguredStoreUrl(platform, env);
  if (!url || typeof openWindow !== "function") return false;
  openWindow(url, "_blank", "noopener,noreferrer");
  return true;
}
