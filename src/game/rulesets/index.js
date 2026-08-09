/**
 * Ruleset public API — config registry + Classic / Haitian / American / Dominican / Puerto Rican UI catalog.
 */

export {
  LEGACY_RULESET_ID,
  legacyRuleset,
} from "./legacy.js";

export {
  HAITIAN_RULESET_ID,
  HAITIAN_MATCH_TARGET,
  haitianRuleset,
} from "./haitian.js";

export {
  AMERICAN_RULESET_ID,
  americanRuleset,
} from "./american.js";

export {
  DOMINICAN_RULESET_ID,
  DOMINICAN_MATCH_TARGET,
  DOMINICAN_OPENING_TILE_ID,
  dominicanRuleset,
} from "./dominican.js";

export {
  PUERTO_RICAN_RULESET_ID,
  PUERTO_RICAN_MATCH_TARGET,
  PUERTO_RICAN_OPENING_TILE_ID,
  puertoRicanRuleset,
} from "./puertoRican.js";

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
  isPlayerCountSupported,
  listAvailableGameStyles,
  listGameStyles,
  getGameStyle,
  gameStyleToRulesetId,
  gameStyleForRulesetId,
  normalizeGameStyleId,
  isGameStyleCompatibleWithPlayerCount,
} from "./registry.js";
