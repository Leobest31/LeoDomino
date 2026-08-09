/**
 * LeoDomino game engine — public API.
 *
 * Pure JavaScript. No React imports.
 * Phase 3: set, shuffle/deal, reserve, legal moves, placement.
 * Phase 4: draw-dominoes rules (turns, scoring, round/match end).
 */

export {
  PIP_MAX,
  TILE_COUNT,
  HAND_SIZE,
  DEFAULT_PLAYER_COUNT,
  END,
  ORIENTATION,
} from "./constants.js";

export {
  HUMAN_INDEX,
  MIN_PLAYER_COUNT,
  MAX_PLAYER_COUNT,
  PLAYER_COUNT_STORAGE_KEY,
  NEXT_PLAYER_4P,
  OPPONENT_FELT_POSITION,
  normalizePlayerCount,
  buildOfflinePlayerIds,
  nextPlayerIndex,
  opponentFeltPosition,
  isHumanSeat,
  isAiSeat,
} from "./players.js";

export {
  tileId,
  createTile,
  generateSet,
  indexTiles,
  tileHasPip,
  oppositePip,
} from "./tiles.js";

export { createShuffledDeck, deal } from "./deck.js";

export {
  createBoard,
  getOpenEnds,
  createOpeningPlacement,
  resolvePlacement,
  placeTile,
  canPlaceOnEnd,
} from "./board.js";

export { getLegalMoves, hasLegalMove, findLegalMove } from "./moves.js";

export {
  movesForTile,
  legalEndsForTile,
  isAmbiguousPlacement,
  isAutoPlaceable,
  resolvePlayChoice,
} from "./interaction.js";

export {
  createMatch,
  readOpenEnds,
  listLegalMoves,
  applyPlace,
  applyDraw,
  playerHasLegalMove,
  cloneMatch,
} from "./match.js";

export {
  DEFAULT_TARGET_SCORE,
  PHASE,
  ROUND_END_REASON,
  tilePipValue,
  handPipTotal,
  startingStrength,
  calculateRoundPoints,
  chooseStartingPlayer,
  isDekabes,
  HAITIAN_OPENING_TILE_ID,
  chooseDoubleSixStarter,
  calculateHaitianRoundPoints,
  applyHaitianAfterRoundScoreUpdate,
  isHaitianMatchWon,
  DOMINICAN_OPENING_TILE_ID,
  chooseDominicanRound1Starter,
  chooseDominicanBlockedStarter,
  chooseDominicanNextRoundStarter,
  getDominicanTeams,
  partnerSeat,
  teamIdForSeat,
  teamPipTotal,
  arePartners,
  calculateDominicanRoundPoints,
  applyDominicanAfterRoundScoreUpdate,
  isDominicanMatchWon,
  isCapicua,
  DOMINICAN_MATCH_TARGET,
  startMatch,
  getCurrentLegalMoves,
  getAvailableActions,
  playTile,
  drawTile,
  passTurn,
  startNextRound,
  isBoardBlocked,
  chooseAutoAction,
  applyAutoAction,
} from "./rules/index.js";

export {
  DIFFICULTY,
  DIFFICULTY_ORDER,
  DIFFICULTY_CONFIG,
  DEFAULT_DIFFICULTY,
  AI_DIFFICULTY_STORAGE_KEY,
  isDifficulty,
  normalizeDifficulty,
  getDifficultyConfig,
  chooseAiAction,
  chooseThinkTimeMs,
  applyAiTurn,
  buildMemory,
  opponentMatchProbability,
  scoreMove,
} from "./ai/index.js";

export {
  LEGACY_RULESET_ID,
  legacyRuleset,
  HAITIAN_RULESET_ID,
  HAITIAN_MATCH_TARGET,
  haitianRuleset,
  AMERICAN_RULESET_ID,
  americanRuleset,
  DOMINICAN_RULESET_ID,
  dominicanRuleset,
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
} from "./rulesets/index.js";
