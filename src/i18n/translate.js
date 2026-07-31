/**
 * Pure translation helpers: interpolation, pluralization, key resolution.
 */

/**
 * @param {Record<string, unknown>} messages
 * @param {string} key
 * @returns {unknown}
 */
export function resolveMessage(messages, key) {
  if (!key || typeof key !== "string") return undefined;

  return key.split(".").reduce((node, part) => {
    if (node == null || typeof node !== "object") return undefined;
    return /** @type {Record<string, unknown>} */ (node)[part];
  }, /** @type {unknown} */ (messages));
}

/**
 * @param {string} template
 * @param {Record<string, string|number|boolean|null|undefined>} [vars]
 * @returns {string}
 */
export function interpolate(template, vars = {}) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    const value = vars[name];
    return value == null ? "" : String(value);
  });
}

/**
 * Pick a plural form using Intl.PluralRules when available.
 * Message value may be a string or `{ one, other, zero?, few?, many?, two? }`.
 *
 * @param {string|Record<string, string>} value
 * @param {string} intlLocale
 * @param {Record<string, string|number|boolean|null|undefined>} [vars]
 * @returns {string}
 */
export function selectPlural(value, intlLocale, vars = {}) {
  if (typeof value === "string") {
    return interpolate(value, vars);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const count = Number(vars.count);
  let form = "other";

  if (Number.isFinite(count)) {
    try {
      form = new Intl.PluralRules(intlLocale).select(count);
    } catch {
      form = count === 1 ? "one" : "other";
    }
  }

  const template =
    value[form] ??
    value.other ??
    value.one ??
    Object.values(value).find((entry) => typeof entry === "string") ??
    "";

  return interpolate(template, vars);
}

/**
 * @param {object} options
 * @param {Record<string, unknown>} options.messages
 * @param {Record<string, unknown>[]} [options.fallbacks]
 * @param {string} options.key
 * @param {Record<string, string|number|boolean|null|undefined>} [options.vars]
 * @param {string} [options.intlLocale="en"]
 * @returns {string}
 */
export function translate({
  messages,
  fallbacks = [],
  key,
  vars,
  intlLocale = "en",
}) {
  const dictionaries = [messages, ...fallbacks];

  for (const dict of dictionaries) {
    const value = resolveMessage(dict, key);
    if (typeof value === "string" || (value && typeof value === "object")) {
      return selectPlural(/** @type {any} */ (value), intlLocale, vars);
    }
  }

  return key;
}
