export { default as BoardContainer } from "./BoardContainer.jsx";
/** @deprecated Prefer BoardContainer */
export { default as BoardRenderer } from "./BoardContainer.jsx";
export {
  calculateBoardLayout,
  layoutBoard,
  orientationForTravel,
  footprintForTravel,
  computeLayoutMetrics,
  computeStableFitScale,
  measureMinRowClearance,
  measureVerticalBridges,
  countTurns,
  BRIDGE_LEN,
  GAP,
  CHAIN_GAP,
  TURN_EVERY,
  MARGIN,
  MIN_TILE_SCALE,
  MIN_SCALE,
  CHAIN_GAP_PX,
  SEGMENT_TILES,
  SAFETY_MARGIN_PX,
  collisionBox,
  reserveFor,
  SPINNER_RESERVE,
  CORNER_RESERVE,
  BRIDGE_RESERVE,
  MIN_SAFE_GAP_PX,
} from "./DominoLayoutEngine.js";
export {
  isBoardDebugEnabled,
  setBoardDebug,
  logCollision,
  edgeClearance,
  buildLayoutDebugInfo,
} from "./boardDebug.js";
export {
  assertLogicalConnections,
  assertVisualConnections,
  resolveTileDisplay,
  facingToward,
  facingHalf,
  pipOnHalf,
  buildBoardDisplays,
  validateBoardPresentation,
  reportBoardPresentation,
} from "./connectionDisplay.js";
