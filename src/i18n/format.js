/**
 * Locale-aware number, date, and currency formatting (Intl).
 */

import { DEFAULT_LOCALE, getLocaleMeta } from "./config.js";

/**
 * @param {string} [localeCode]
 * @returns {string}
 */
function intlTag(localeCode = DEFAULT_LOCALE) {
  return getLocaleMeta(localeCode).intl;
}

/**
 * @param {number} value
 * @param {string} [localeCode]
 * @param {Intl.NumberFormatOptions} [options]
 * @returns {string}
 */
export function formatNumber(value, localeCode = DEFAULT_LOCALE, options = {}) {
  try {
    return new Intl.NumberFormat(intlTag(localeCode), options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {number|Date|string} value
 * @param {string} [localeCode]
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDate(value, localeCode = DEFAULT_LOCALE, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlTag(localeCode), options).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Ready for future economy / tournament entry fees.
 * @param {number} value
 * @param {string} [currency="USD"]
 * @param {string} [localeCode]
 * @param {Intl.NumberFormatOptions} [options]
 * @returns {string}
 */
export function formatCurrency(
  value,
  currency = "USD",
  localeCode = DEFAULT_LOCALE,
  options = {}
) {
  try {
    return new Intl.NumberFormat(intlTag(localeCode), {
      style: "currency",
      currency,
      ...options,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
