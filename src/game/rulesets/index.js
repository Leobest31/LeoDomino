/**
 * Ruleset public API — config registry + Classic UI catalog.
 */

export {
  LEGACY_RULESET_ID,
  legacyRuleset,
} from "./legacy.js";

export {
  DEFAULT_RULESET_ID,
  RULESET_STORAGE_KEY,
  GAME_STYLES,
  DEFAULT_GAME_STYLE_ID,
  registerRuleset,
  resolveRuleset,
  tryResolveRuleset,
  isKnownRulesetId,
  normalizeRulesetId,
  coerceRulesetId,
  listRulesetIds,
  resolveHandSize,
  listAvailableGameStyles,
  listGameStyles,
  getGameStyle,
  gameStyleToRulesetId,
  gameStyleForRulesetId,
  normalizeGameStyleId,
} from "./registry.js";
