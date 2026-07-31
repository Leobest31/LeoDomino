/** Phase 4 rules public surface. */

export {
  DEFAULT_TARGET_SCORE,
  PHASE,
  ROUND_END_REASON,
} from "./constants.js";

export {
  tilePipValue,
  handPipTotal,
  startingStrength,
  calculateRoundPoints,
} from "./scoring.js";

export { chooseStartingPlayer } from "./start.js";

export {
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
} from "./drawDominoes.js";
