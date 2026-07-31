/**
 * App preferences — theme, vibration (offline localStorage).
 */

import { readStorage, writeStorage } from "../utils/storage.js";

export const PREFS_STORAGE_KEY = "leodomino.prefs";

export const THEMES = Object.freeze(["classic", "noir"]);

export const DEFAULT_PREFS = Object.freeze({
  theme: "classic",
  vibration: true,
});

/**
 * @param {unknown} value
 * @returns {typeof DEFAULT_PREFS}
 */
export function normalizePrefs(value) {
  const raw = value && typeof value === "object" ? value : {};
  const theme = THEMES.includes(/** @type {string} */ (raw.theme))
    ? /** @type {"classic"|"noir"} */ (raw.theme)
    : DEFAULT_PREFS.theme;
  return {
    theme,
    vibration: raw.vibration == null ? DEFAULT_PREFS.vibration : Boolean(raw.vibration),
  };
}

export function loadPrefs() {
  try {
    const raw = readStorage(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * @param {Partial<typeof DEFAULT_PREFS>} patch
 */
export function savePrefs(patch) {
  const next = normalizePrefs({ ...loadPrefs(), ...patch });
  writeStorage(PREFS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/**
 * @param {"classic"|"noir"} theme
 */
export function applyTheme(theme) {
  const resolved = THEMES.includes(theme) ? theme : DEFAULT_PREFS.theme;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/**
 * Soft haptic feedback when enabled (no-op if unsupported).
 * @param {number|[number, number]} pattern
 */
export function vibrate(pattern = 12) {
  const prefs = loadPrefs();
  if (!prefs.vibration) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore.
  }
}
