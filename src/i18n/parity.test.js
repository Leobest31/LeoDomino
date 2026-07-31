/**
 * Locale key parity — ht is source of truth.
 * Plural maps ({ one, other }) count as a single leaf key.
 * Run: npm run test:i18n
 */

import assert from "node:assert/strict";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./config.js";
import { loadAllCatalogs } from "./locales/loadCatalog.js";

function isPluralMap(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function flattenKeys(obj, prefix = "") {
  /** @type {string[]} */
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPluralMap(value)) {
      keys.push(path);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const catalogs = await loadAllCatalogs();
const source = catalogs[DEFAULT_LOCALE];
assert.ok(source, `Default locale "${DEFAULT_LOCALE}" must exist`);
const sourceKeys = flattenKeys(source);

assert.equal(DEFAULT_LOCALE, "ht", "Haitian Creole must remain the default locale");

assert.deepEqual(
  SUPPORTED_LOCALES.map((l) => l.code).sort(),
  Object.keys(catalogs).sort(),
  "SUPPORTED_LOCALES must match registered catalogs"
);

for (const locale of SUPPORTED_LOCALES) {
  assert.ok(locale.intl, `${locale.code} must define intl tag`);
  assert.ok(locale.dir === "ltr" || locale.dir === "rtl", `${locale.code} must define dir`);
}

for (const { code } of SUPPORTED_LOCALES) {
  const keys = flattenKeys(catalogs[code]);
  assert.deepEqual(keys, sourceKeys, `Locale "${code}" keys must match "${DEFAULT_LOCALE}"`);
  console.log(`  ✓ ${code} — ${keys.length} keys (dir=${SUPPORTED_LOCALES.find((l) => l.code === code).dir})`);
}

console.log(`\ni18n parity OK (${sourceKeys.length} keys × ${SUPPORTED_LOCALES.length} locales). Default=${DEFAULT_LOCALE}.\n`);
