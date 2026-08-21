import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  getLocaleMeta,
  isSupportedLocale,
} from "./config.js";
import { getCachedCatalog, hasCatalog, loadCatalog } from "./locales/loadCatalog.js";
import { translate } from "./translate.js";
import { formatCurrency, formatDate, formatNumber } from "./format.js";
import { writeStorage } from "../utils/storage.js";
import { I18nContext } from "./I18nContext.js";
import { readInitialLocale, syncDocumentLocale } from "./documentLocale.js";

/**
 * App-wide i18n provider.
 * - First launch uses English; Haitian Creole remains the catalog fallback.
 * - Preference restored from localStorage.
 * - Non-eager catalogs are lazy-loaded.
 * - Sets `dir` for RTL-ready layout switching.
 */
export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(readInitialLocale);
  const [messages, setMessages] = useState(() => getCachedCatalog(locale));
  const [ready, setReady] = useState(() => hasCatalog(locale));

  useEffect(() => {
    let cancelled = false;

    async function ensure() {
      if (!hasCatalog(locale)) setReady(false);
      const catalog = await loadCatalog(locale);
      if (cancelled) return;
      setMessages(catalog);
      setReady(true);
    }

    ensure();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const fallbackMessages = useMemo(() => {
    const list = [];
    const ht = getCachedCatalog(DEFAULT_LOCALE);
    if (locale !== DEFAULT_LOCALE && ht) list.push(ht);
    return list;
  }, [locale]);

  const intlLocale = getLocaleMeta(locale).intl;
  const dir = getLocaleMeta(locale).dir;

  const t = useCallback(
    (key, vars) =>
      translate({
        messages,
        fallbacks: fallbackMessages,
        key,
        vars,
        intlLocale,
      }),
    [messages, fallbackMessages, intlLocale]
  );

  const setLocale = useCallback((nextLocale) => {
    if (!isSupportedLocale(nextLocale)) return;
    setLocaleState(nextLocale);
    writeStorage(LOCALE_STORAGE_KEY, nextLocale);
  }, []);

  useEffect(() => {
    if (ready) {
      syncDocumentLocale(locale, messages);
    }
  }, [locale, messages, ready]);

  const value = useMemo(
    () => ({
      locale,
      dir,
      ready,
      setLocale,
      t,
      locales: SUPPORTED_LOCALES,
      formatNumber: (value, options) => formatNumber(value, locale, options),
      formatDate: (value, options) => formatDate(value, locale, options),
      formatCurrency: (value, currency, options) =>
        formatCurrency(value, currency, locale, options),
    }),
    [locale, dir, ready, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
