/**
 * LeoDomino internationalization public API.
 *
 * Every visible string must use:
 *   const { t } = useI18n();
 *   // or
 *   <T id="game.play" />
 *
 * Adding a language:
 *   1. Create locales/<code>.js (same keys as ht.js)
 *   2. Register loader in locales/loadCatalog.js
 *   3. Add entry in config.js SUPPORTED_LOCALES
 */

export {
  DEFAULT_LOCALE,
  FIRST_LAUNCH_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  getLocaleMeta,
} from "./config.js";

export { translate, interpolate, resolveMessage, selectPlural } from "./translate.js";
export { formatNumber, formatDate, formatCurrency } from "./format.js";
export { loadCatalog, getCachedCatalog, loadAllCatalogs } from "./locales/loadCatalog.js";
export { I18nProvider } from "./I18nProvider.jsx";
export { useI18n } from "./useI18n.js";
export { T } from "./T.jsx";
