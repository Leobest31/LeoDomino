import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocaleMeta,
  isSupportedLocale,
} from "./config.js";
import { readStorage } from "../utils/storage.js";

/**
 * Resolve the initial locale from storage, falling back to Haitian Creole.
 * @returns {string}
 */
export function readInitialLocale() {
  const saved = readStorage(LOCALE_STORAGE_KEY);
  if (saved && isSupportedLocale(saved)) {
    return saved;
  }
  return DEFAULT_LOCALE;
}

/**
 * Sync lang + dir on <html> for a11y and future RTL layouts.
 * @param {string} locale
 * @param {object} messages
 */
export function syncDocumentLocale(locale, messages) {
  if (typeof document === "undefined") return;
  const meta = getLocaleMeta(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = meta.dir;
  document.documentElement.dataset.locale = locale;
  const description = messages?.meta?.appDescription;
  const tag = document.querySelector('meta[name="description"]');
  if (tag && description) {
    tag.setAttribute("content", description);
  }
  document.title = messages?.common?.brand ?? "LeoDomino";
}
