/**
 * i18n configuration.
 * Add a language: locale file → register loader in locales/loadCatalog.js → entry here.
 */

/** @typedef {"ht" | "en" | "fr" | "es" | "pt" | string} LocaleCode */

/** Catalog fallback / key source of truth: Haitian Creole. */
export const DEFAULT_LOCALE = "ht";

/** First-launch language when no preference is saved. */
export const FIRST_LAUNCH_LOCALE = "en";

/** localStorage key for the persisted language choice. */
export const LOCALE_STORAGE_KEY = "leodomino.locale";

/**
 * Supported locales.
 * `intl` is the BCP 47 tag for Intl number/date/currency formatting.
 * `dir` prepares RTL; set to "rtl" when adding Arabic/Hebrew/etc.
 *
 * @type {ReadonlyArray<{
 *   code: LocaleCode,
 *   nativeName: string,
 *   intl: string,
 *   dir: "ltr" | "rtl"
 * }>}
 */
export const SUPPORTED_LOCALES = Object.freeze([
  { code: "en", nativeName: "English", intl: "en", dir: "ltr" },
  { code: "ht", nativeName: "Kreyòl Ayisyen", intl: "ht-HT", dir: "ltr" },
  { code: "fr", nativeName: "Français", intl: "fr-FR", dir: "ltr" },
  { code: "es", nativeName: "Español", intl: "es-ES", dir: "ltr" },
  { code: "pt", nativeName: "Português", intl: "pt-BR", dir: "ltr" },
]);

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isSupportedLocale(code) {
  return SUPPORTED_LOCALES.some((locale) => locale.code === code);
}

/**
 * @param {string} code
 * @returns {{ code: string, nativeName: string, intl: string, dir: "ltr"|"rtl" }}
 */
export function getLocaleMeta(code) {
  return (
    SUPPORTED_LOCALES.find((locale) => locale.code === code) ??
    SUPPORTED_LOCALES.find((locale) => locale.code === DEFAULT_LOCALE)
  );
}
