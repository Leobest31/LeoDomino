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

export { isDekabes } from "./dekabes.js";
export {
  HAITIAN_OPENING_TILE_ID,
  chooseDoubleSixStarter,
} from "./haitianStart.js";
export {
  calculateHaitianRoundPoints,
  applyHaitianAfterRoundScoreUpdate,
  isHaitianMatchWon,
} from "./haitianScoring.js";

export {
  DOMINICAN_OPENING_TILE_ID,
  chooseDominicanRound1Starter,
  chooseDominicanBlockedStarter,
  chooseDominicanNextRoundStarter,
} from "./dominicanStart.js";
export {
  getDominicanTeams,
  partnerSeat,
  teamIdForSeat,
  teamPipTotal,
  arePartners,
  seatsOnTeam,
  teamLeadSeat,
} from "./dominicanTeams.js";
export {
  DOMINICAN_MATCH_TARGET,
  calculateDominicanRoundPoints,
  applyDominicanAfterRoundScoreUpdate,
  isDominicanMatchWon,
  isCapicua,
  resolveDominicanMatchWinner,
} from "./dominicanScoring.js";

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
