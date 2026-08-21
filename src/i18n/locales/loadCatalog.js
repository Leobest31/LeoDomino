/**
 * Locale catalog loaders — default (ht) is eager; others lazy for production.
 */

import ht from "./ht.js";
import en from "./en.js";
import { DEFAULT_LOCALE } from "../config.js";

/** @type {Map<string, object>} */
const cache = new Map([
  ["ht", ht],
  ["en", en],
]);

/**
 * Dynamic import map. Add new languages here only.
 * @type {Record<string, () => Promise<{ default: object }>>}
 */
const loaders = {
  ht: () => Promise.resolve({ default: ht }),
  en: () => Promise.resolve({ default: en }),
  fr: () => import("./fr.js"),
  es: () => import("./es.js"),
  pt: () => import("./pt.js"),
};

/**
 * Synchronously read a cached catalog (ht is always available).
 * @param {string} code
 * @returns {object}
 */
export function getCachedCatalog(code) {
  return cache.get(code) ?? cache.get(DEFAULT_LOCALE);
}

/** @param {string} code */
export function hasCatalog(code) {
  return cache.has(code);
}

/**
 * Ensure a catalog is loaded (lazy). Resolves with the dictionary.
 * @param {string} code
 * @returns {Promise<object>}
 */
export async function loadCatalog(code) {
  if (cache.has(code)) {
    return cache.get(code);
  }

  const loader = loaders[code] ?? loaders[DEFAULT_LOCALE];
  const mod = await loader();
  const catalog = mod.default;
  cache.set(code, catalog);
  return catalog;
}

/** Eager default export registry for parity tests (all catalogs). */
export async function loadAllCatalogs() {
  const codes = Object.keys(loaders);
  const entries = await Promise.all(
    codes.map(async (code) => [code, await loadCatalog(code)])
  );
  return Object.fromEntries(entries);
}

export { ht as defaultCatalog };
