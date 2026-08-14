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
  resolveDominicanTeamBlockedOutcome,
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
  PUERTO_RICAN_OPENING_TILE_ID,
  choosePuertoRicanRound1Starter,
  choosePuertoRicanBlockedStarter,
  choosePuertoRicanNextRoundStarter,
  resolvePuertoRicanTeamBlockedOutcome,
} from "./puertoRicanStart.js";
export {
  getPuertoRicanTeams,
  puertoRicanPartnerSeat,
  puertoRicanTeamIdForSeat,
  puertoRicanTeamPipTotal,
  puertoRicanArePartners,
  puertoRicanSeatsOnTeam,
  puertoRicanTeamLeadSeat,
} from "./puertoRicanTeams.js";
export {
  PUERTO_RICAN_MATCH_TARGET,
  calculatePuertoRicanRoundPoints,
  applyPuertoRicanAfterRoundScoreUpdate,
  isPuertoRicanMatchWon,
  isPuertoRicanCapicua,
  isChuchazo,
  resolvePuertoRicanMatchWinner,
} from "./puertoRicanScoring.js";

export {
  ALL_FIVES_MATCH_TARGET,
  AMERICAN_MATCH_TARGET,
  exposedEndTotal,
  americanExposedEndTotal,
  scoreAllFivesPlay,
  allFivesScorePlay,
  roundToNearestFive,
  calculateAllFivesRoundPoints,
} from "./allFivesScoring.js";

export {
  AMERICAN_END,
  listAmericanOpenEnds,
  getAmericanScoringEnds,
  describeAmericanExposedEnds,
  americanPointsFromExposedTotal,
  scoreAmericanPlay,
  getAmericanLegalMoves,
  placeAmericanTile,
  resolveSpinnerAfterPlace,
  resolveAmericanPlayChoice,
  hasUniqueDestination,
  readSpinnerState,
  emptySpinnerState,
} from "./americanSpinner.js";

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
