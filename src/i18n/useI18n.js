import { useContext } from "react";
import { I18nContext } from "./I18nContext.js";

/**
 * Access translations, formatters, and locale controls.
 * Every UI screen/component must go through this hook (or <T />).
 */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider — all UI requires i18n");
  }
  return ctx;
}
