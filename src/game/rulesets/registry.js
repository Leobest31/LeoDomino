/**
 * Ruleset registry — resolve by id; register future styles without engine rewrites.
 * Avoid scattering `if (rulesetId === "…")` through the engine: resolve once, read config/policies.
 */

import { LEGACY_RULESET_ID, legacyRuleset } from "./legacy.js";

/** @type {Map<string, object>} */
const REGISTRY = new Map();

export const DEFAULT_RULESET_ID = LEGACY_RULESET_ID;

/** Preference key for last-selected ruleset (setup → new match). */
export const RULESET_STORAGE_KEY = "leodomino.rulesetId";

/**
 * UI-facing game style catalog.
 * `id` is the Setup chip id; `rulesetId` is what the match engine stores.
 * Only Classic is exposed for V1 — architecture supports more later.
 */
export const GAME_STYLES = Object.freeze([
  Object.freeze({
    id: "classic",
    rulesetId: LEGACY_RULESET_ID,
    nameKey: "setup.gameStyle.classic",
    descriptionKey: "setup.gameStyle.classicDescription",
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
 * @param {string|null|undefined} id
 * @returns {object}
 */
export function resolveRuleset(id) {
  const key = id == null || id === "" ? DEFAULT_RULESET_ID : id;
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
  return REGISTRY.get(id) ?? null;
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isKnownRulesetId(id) {
  return typeof id === "string" && REGISTRY.has(id);
}

/**
 * Normalize for match creation. Missing/empty → legacy. Unknown → throws.
 * @param {unknown} id
 * @returns {string}
 */
export function normalizeRulesetId(id) {
  if (id == null || id === "") return DEFAULT_RULESET_ID;
  if (typeof id !== "string" || !REGISTRY.has(id)) {
    throw new Error(`Unknown ruleset: ${id}`);
  }
  return id;
}

/**
 * Soft coerce for save migration.
 * Missing/empty → legacy. Unknown → null (caller rejects).
 * @param {unknown} id
 * @returns {string|null}
 */
export function coerceRulesetId(id) {
  if (id == null || id === "") return DEFAULT_RULESET_ID;
  if (typeof id !== "string" || !REGISTRY.has(id)) return null;
  return id;
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
 * Game styles available for Setup selection (available !== false).
 * @returns {ReadonlyArray<object>}
 */
export function listAvailableGameStyles() {
  return GAME_STYLES.filter((style) => style.available);
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
  if (!style || !style.available) return null;
  return style.rulesetId;
}

/**
 * Find the Setup style that maps to a rulesetId (Classic → legacy).
 * @param {string} rulesetId
 * @returns {object|null}
 */
export function gameStyleForRulesetId(rulesetId) {
  return GAME_STYLES.find((style) => style.rulesetId === rulesetId) ?? null;
}

/**
 * Normalize a stored preference into a selectable style id.
 * @param {unknown} rulesetIdOrStyleId
 * @returns {string}
 */
export function normalizeGameStyleId(rulesetIdOrStyleId) {
  if (rulesetIdOrStyleId === DEFAULT_GAME_STYLE_ID) return DEFAULT_GAME_STYLE_ID;
  const byStyle = getGameStyle(/** @type {string} */ (rulesetIdOrStyleId));
  if (byStyle?.available) return byStyle.id;
  const byRuleset = gameStyleForRulesetId(/** @type {string} */ (rulesetIdOrStyleId));
  if (byRuleset?.available) return byRuleset.id;
  return DEFAULT_GAME_STYLE_ID;
}

// Boot: register the sole V1 engine ruleset.
registerRuleset(legacyRuleset);
