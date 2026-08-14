/**
 * Ruleset registry — resolve by id; register future styles without engine rewrites.
 * Avoid scattering `if (rulesetId === "…")` through the engine: resolve once, read config/policies.
 */

import { LEGACY_RULESET_ID, legacyRuleset } from "./legacy.js";
import { HAITIAN_RULESET_ID, haitianRuleset } from "./haitian.js";
import { AMERICAN_RULESET_ID, americanRuleset } from "./american.js";
import { DOMINICAN_RULESET_ID, dominicanRuleset } from "./dominican.js";
import { PUERTO_RICAN_RULESET_ID, puertoRicanRuleset } from "./puertoRican.js";
import { ALL_FIVES_RULESET_ID } from "./allFives.js";

/** @type {Map<string, object>} */
const REGISTRY = new Map();

export const DEFAULT_RULESET_ID = LEGACY_RULESET_ID;

/** Preference key for last-selected ruleset (setup → new match). */
export const RULESET_STORAGE_KEY = "leodomino.rulesetId";

/**
 * Map legacy / alias ids onto the canonical registered ruleset id.
 * @param {string} id
 * @returns {string}
 */
function canonicalRulesetId(id) {
  // All Fives was merged into American — old saves/prefs keep working.
  if (id === ALL_FIVES_RULESET_ID) return AMERICAN_RULESET_ID;
  return id;
}

/**
 * UI-facing game style catalog (single registry for Setup / Game Style screens).
 * `id` is the UI style id; `rulesetId` is what the match engine stores.
 * Add future variants here (countryCode, enabled, available) — do not hard-code lists in pages.
 *
 * @typedef {{
 *   id: string,
 *   rulesetId: string,
 *   nameKey: string,
 *   descriptionKey?: string,
 *   countryCode?: string|null,
 *   enabled: boolean,
 *   available: boolean,
 * }} GameStyleEntry
 */
export const GAME_STYLES = Object.freeze([
  Object.freeze({
    id: "classic",
    rulesetId: LEGACY_RULESET_ID,
    nameKey: "setup.gameStyle.classic",
    descriptionKey: "setup.gameStyle.classicDescription",
    countryCode: null,
    enabled: true,
    available: true,
  }),
  Object.freeze({
    id: "haitian",
    rulesetId: HAITIAN_RULESET_ID,
    nameKey: "setup.gameStyle.haitian",
    descriptionKey: "setup.gameStyle.haitianDescription",
    countryCode: "HT",
    enabled: true,
    available: true,
  }),
  Object.freeze({
    id: "american",
    rulesetId: AMERICAN_RULESET_ID,
    nameKey: "setup.gameStyle.american",
    descriptionKey: "setup.gameStyle.americanDescription",
    countryCode: "US",
    enabled: true,
    available: true,
  }),
  Object.freeze({
    id: "dominican",
    rulesetId: DOMINICAN_RULESET_ID,
    nameKey: "setup.gameStyle.dominican",
    descriptionKey: "setup.gameStyle.dominicanDescription",
    countryCode: "DO",
    enabled: true,
    available: true,
  }),
  Object.freeze({
    id: "puertorican",
    rulesetId: PUERTO_RICAN_RULESET_ID,
    nameKey: "setup.gameStyle.puertorican",
    descriptionKey: "setup.gameStyle.puertoricanDescription",
    countryCode: "PR",
    enabled: true,
    available: true,
  }),
]);

export const DEFAULT_GAME_STYLE_ID = "classic";

/**
 * @param {object} ruleset
 */
export function registerRuleset(ruleset) {
  if (!ruleset || typeof ruleset !== "object" || typeof ruleset.id !== "string" || !ruleset.id) {
    throw new Error("registerRuleset: ruleset.id is required");
  }
  REGISTRY.set(ruleset.id, Object.freeze(ruleset));
}

/**
 * Resolve a registered ruleset. Unknown ids throw (fail safely).
 * Legacy "allFives" resolves to American.
 * @param {string|null|undefined} id
 * @returns {object}
 */
export function resolveRuleset(id) {
  const key = id == null || id === "" ? DEFAULT_RULESET_ID : canonicalRulesetId(id);
  const ruleset = REGISTRY.get(key);
  if (!ruleset) {
    throw new Error(`Unknown ruleset: ${key}`);
  }
  return ruleset;
}

/**
 * @param {unknown} id
 * @returns {object|null}
 */
export function tryResolveRuleset(id) {
  if (typeof id !== "string" || !id) return null;
  return REGISTRY.get(canonicalRulesetId(id)) ?? null;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isKnownRulesetId(id) {
  if (typeof id !== "string" || !id) return false;
  if (id === ALL_FIVES_RULESET_ID) return true;
  return REGISTRY.has(id);
}

/**
 * Normalize for match creation. Missing/empty → legacy. Unknown → throws.
 * Legacy "allFives" → "american".
 * @param {unknown} id
 * @returns {string}
 */
export function normalizeRulesetId(id) {
  if (id == null || id === "") return DEFAULT_RULESET_ID;
  if (typeof id !== "string") {
    throw new Error(`Unknown ruleset: ${id}`);
  }
  const canonical = canonicalRulesetId(id);
  if (!REGISTRY.has(canonical)) {
    throw new Error(`Unknown ruleset: ${id}`);
  }
  return canonical;
}

/**
 * Soft coerce for save migration.
 * Missing/empty → legacy. Legacy "allFives" → "american". Unknown → null.
 * @param {unknown} id
 * @returns {string|null}
 */
export function coerceRulesetId(id) {
  if (id == null || id === "") return DEFAULT_RULESET_ID;
  if (typeof id !== "string") return null;
  const canonical = canonicalRulesetId(id);
  if (!REGISTRY.has(canonical)) return null;
  return canonical;
}

/**
 * @returns {string[]}
 */
export function listRulesetIds() {
  return Array.from(REGISTRY.keys());
}

/**
 * Hand size for a ruleset (number or function of playerCount).
 * @param {object} ruleset
 * @param {number} [playerCount]
 * @returns {number}
 */
export function resolveHandSize(ruleset, playerCount) {
  const hs = ruleset.handSize;
  if (typeof hs === "function") return hs(playerCount);
  return hs;
}

/**
 * Whether a player count is supported by the ruleset.
 * Uses `supportedPlayerCounts` when present; otherwise min/max inclusive.
 * @param {object} ruleset
 * @param {number} playerCount
 * @returns {boolean}
 */
export function isPlayerCountSupported(ruleset, playerCount) {
  const n = Number(playerCount);
  if (!Number.isFinite(n)) return false;
  if (Array.isArray(ruleset.supportedPlayerCounts)) {
    return ruleset.supportedPlayerCounts.includes(n);
  }
  const min = ruleset.playerCount?.min ?? 2;
  const max = ruleset.playerCount?.max ?? 4;
  return n >= min && n <= max;
}

/**
 * Game styles available for selection (enabled + available).
 * @returns {ReadonlyArray<object>}
 */
export function listAvailableGameStyles() {
  return GAME_STYLES.filter((style) => style.enabled !== false && style.available);
}

/**
 * All registered UI styles (including unavailable) — for future Coming Soon chips.
 * @returns {ReadonlyArray<object>}
 */
export function listGameStyles() {
  return GAME_STYLES;
}

/**
 * @param {string} styleId
 * @returns {object|null}
 */
export function getGameStyle(styleId) {
  return GAME_STYLES.find((style) => style.id === styleId) ?? null;
}

/**
 * Map Setup style id → engine rulesetId. Unknown / unavailable → null.
 * @param {string} styleId
 * @returns {string|null}
 */
export function gameStyleToRulesetId(styleId) {
  const style = getGameStyle(styleId);
  if (!style || !style.available || style.enabled === false) return null;
  return style.rulesetId;
}

/**
 * Find the Setup style that maps to a rulesetId (Classic → legacy).
 * @param {string} rulesetId
 * @returns {object|null}
 */
export function gameStyleForRulesetId(rulesetId) {
  const canonical =
    typeof rulesetId === "string" ? canonicalRulesetId(rulesetId) : rulesetId;
  return GAME_STYLES.find((style) => style.rulesetId === canonical) ?? null;
}

/**
 * Normalize a stored preference into a selectable style id.
 * Legacy "allFives" → American.
 * @param {unknown} rulesetIdOrStyleId
 * @returns {string}
 */
export function normalizeGameStyleId(rulesetIdOrStyleId) {
  if (rulesetIdOrStyleId === ALL_FIVES_RULESET_ID) return "american";
  if (rulesetIdOrStyleId === DEFAULT_GAME_STYLE_ID) return DEFAULT_GAME_STYLE_ID;
  const byStyle = getGameStyle(/** @type {string} */ (rulesetIdOrStyleId));
  if (byStyle?.available && byStyle.enabled !== false) return byStyle.id;
  const byRuleset = gameStyleForRulesetId(/** @type {string} */ (rulesetIdOrStyleId));
  if (byRuleset?.available && byRuleset.enabled !== false) return byRuleset.id;
  return DEFAULT_GAME_STYLE_ID;
}

/**
 * Setup compatibility: style available AND ruleset supports the seat count.
 * @param {string} styleId
 * @param {number} playerCount
 * @returns {boolean}
 */
export function isGameStyleCompatibleWithPlayerCount(styleId, playerCount) {
  const style = getGameStyle(styleId);
  if (!style?.available || style.enabled === false) return false;
  try {
    const ruleset = resolveRuleset(style.rulesetId);
    return isPlayerCountSupported(ruleset, playerCount);
  } catch {
    return false;
  }
}

// Boot: register engine rulesets (All Fives merged into American — not registered).
registerRuleset(legacyRuleset);
registerRuleset(haitianRuleset);
registerRuleset(americanRuleset);
registerRuleset(dominicanRuleset);
registerRuleset(puertoRicanRuleset);
