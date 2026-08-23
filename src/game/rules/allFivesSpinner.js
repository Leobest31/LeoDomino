/**
 * All Fives spinner topology — first double of the round, main-chain
 * left/right, and live scoring from CURRENT TERMINAL CHAIN ENDS only.
 *
 * The spinner is whichever double is played first (0-0 through 6-6).
 * Pip value never changes geometry or scoring rules.
 *
 * LEGAL PLAY PORT != SCORING TERMINAL.
 * Empty TOP/BOTTOM ports are destinations, not extra copies of the spinner pip.
 *
 * While only one MAIN side is occupied, the spinner is still a terminal double
 * on the main line: both halves count (X+X), plus the outer branch pip (Y).
 * Once BOTH main sides are occupied, the spinner is internal (contribution 0).
 *
 * A non-double terminal contributes its outward pip once.
 * A non-spinner double that is the outermost tile of a branch contributes
 * both sides (pip + pip). Extending it makes that double internal (zero).
 */

import { END, ORIENTATION } from "../constants.js";
import { getLegalMoves } from "../moves.js";
import { oppositePip, tileHasPip } from "../tiles.js";
import {
  BRANCH,
  SPINNER_NODE,
  annotateMoveDestination,
  buildBoardTopology,
  stampTileDestination,
} from "../boardTopology.js";

export const SPINNER_NORTH = "north";
export const SPINNER_SOUTH = "south";

export const PLAY_SCORE_HOLD_MS = 2000;

/**
 * @param {object|null|undefined} state
 * @returns {boolean}
 */
export function usesAllFivesSpinner(state) {
  const id = state?.rulesetId;
  return id === "allFives" || id === "american";
}

/**
 * @param {unknown} end
 * @returns {boolean}
 */
export function isSpinnerEnd(end) {
  return end === SPINNER_NORTH || end === SPINNER_SOUTH;
}

/**
 * @param {object} tile
 * @returns {boolean}
 */
function isDoubleTile(tile) {
  return Boolean(tile) && Number(tile.left) === Number(tile.right);
}

function tilePip(tile) {
  return Number(tile?.left);
}

/**
 * Exposed value of one open chain face.
 * Spinner-hub faces and non-double outward faces use this (pip once).
 * A non-spinner terminal double is handled in getCurrentTerminalEnds (both sides).
 *
 * @param {object|null|undefined} tile
 * @param {"left"|"right"} face
 * @returns {number}
 */
export function terminalExposedValue(tile, face) {
  if (!tile) return 0;
  if (isDoubleTile(tile)) return tilePip(tile);
  const pip = face === "left" ? tile.left : tile.right;
  return Number(pip);
}

const BRANCH_TO_PORT = Object.freeze({
  [BRANCH.MAIN_LEFT]: "left",
  [BRANCH.MAIN_RIGHT]: "right",
  [BRANCH.SPINNER_TOP]: "north",
  [BRANCH.SPINNER_BOTTOM]: "south",
  [SPINNER_NODE]: "spinner",
});

function tableTileIds(board, north, south) {
  const ids = [];
  for (const tile of board) {
    if (tile?.id) ids.push(tile.id);
  }
  for (const tile of north) {
    if (tile?.id) ids.push(tile.id);
  }
  for (const tile of south) {
    if (tile?.id) ids.push(tile.id);
  }
  return ids;
}

/**
 * First double on the table is the spinner. Infer it when callers omit spinnerId
 * so live scoring cannot treat that hub as a later terminal-double.
 */
function resolveSpinnerId(board, requested) {
  if (typeof requested === "string" && requested) {
    const tile = board.find((entry) => entry.id === requested);
    if (tile && isDoubleTile(tile)) return tile.id;
  }
  const firstDouble = board.find((tile) => isDoubleTile(tile));
  return firstDouble?.id ?? null;
}

function describeTerminal(tile, outwardFace, spinnerId) {
  const double = isDoubleTile(tile);
  const pip = tilePip(tile);
  const outward = terminalExposedValue(tile, outwardFace);
  const isHub = Boolean(spinnerId && tile.id === spinnerId);
  if (!double) {
    return {
      type: "single-terminal",
      value: outward,
      contribution: outward,
      source: "terminal",
    };
  }
  if (isHub) {
    return {
      type: "single-terminal",
      value: pip,
      contribution: pip,
      source: "spinner-port",
    };
  }
  return {
    type: "terminal-double",
    value: pip * 2,
    contribution: pip * 2,
    values: [pip, pip],
    source: "terminal",
  };
}

function pushTerminal(ends, branch, tile, outwardFace, spinnerId) {
  if (!tile) return;
  const described = describeTerminal(tile, outwardFace, spinnerId);
  const port = BRANCH_TO_PORT[branch] ?? branch;
  const scoringSides =
    described.type === "terminal-double" ? ["left", "right"] : [outwardFace];
  const entry = {
    branch,
    port,
    sourceTileId: tile.id,
    tileId: tile.id,
    sourcePort: outwardFace,
    scoringSide: described.type === "terminal-double" ? "both" : outwardFace,
    scoringSides,
    value: described.contribution,
    contribution: described.contribution,
    type: described.type,
    source: described.source,
  };
  if (described.values) entry.values = described.values;
  ends.push(entry);
}

/**
 * Spinner still sits at an open main-chain end: both halves count.
 * Empty TOP/BOTTOM ports are not extra copies of this pip.
 */
function pushSpinnerMainTerminalDouble(ends, tile) {
  if (!tile) return;
  const pip = tilePip(tile);
  ends.push({
    branch: SPINNER_NODE,
    port: "spinner",
    sourceTileId: tile.id,
    tileId: tile.id,
    sourcePort: "both",
    scoringSide: "both",
    scoringSides: ["left", "right"],
    value: pip * 2,
    contribution: pip * 2,
    values: [pip, pip],
    type: "terminal-double",
    source: "spinner-terminal-double-on-main-line",
    reason: "spinner-terminal-double-on-main-line",
  });
}

/**
 * Canonical live-play terminals from post-move topology.
 *
 * MAIN_LEFT / MAIN_RIGHT: outermost tile of that occupied main branch.
 * SPINNER: terminal double on the main line while the spinner is not enclosed
 *   between two main-chain tiles (lone spinner, or only one main side filled).
 * SPINNER_TOP / SPINNER_BOTTOM: outermost tile of that arm, only when it has tiles.
 *
 * Empty TOP/BOTTOM ports are not terminals. Legal future destinations are not
 * terminals. Hands and the boneyard are ignored.
 *
 * @param {object|object[]} boardState
 * @returns {object[]}
 */
export function getCurrentTerminalEnds(boardState = {}) {
  const options = Array.isArray(boardState) ? { board: boardState } : boardState;
  const board = Array.isArray(options.board) ? options.board : [];
  if (!board.length) return [];

  const spinnerId = resolveSpinnerId(board, options.spinnerId);
  const topology = buildBoardTopology({ ...options, board, spinnerId });
  const north = topology.branches[BRANCH.SPINNER_TOP];
  const south = topology.branches[BRANCH.SPINNER_BOTTOM];
  const ends = [];
  const spinnerIndex = spinnerId
    ? board.findIndex((tile) => tile.id === spinnerId)
    : -1;
  const spinnerTile = spinnerIndex >= 0 ? board[spinnerIndex] : null;
  const leftOccupied = spinnerIndex > 0;
  const rightOccupied =
    spinnerIndex >= 0 && spinnerIndex < board.length - 1;
  const spinnerEnclosedOnMain = leftOccupied && rightOccupied;

  if (spinnerIndex < 0) {
    pushTerminal(ends, BRANCH.MAIN_LEFT, board[0], "left", null);
    pushTerminal(ends, BRANCH.MAIN_RIGHT, board[board.length - 1], "right", null);
  } else {
    if (leftOccupied) {
      pushTerminal(ends, BRANCH.MAIN_LEFT, board[0], "left", spinnerId);
    }
    if (rightOccupied) {
      pushTerminal(
        ends,
        BRANCH.MAIN_RIGHT,
        board[board.length - 1],
        "right",
        spinnerId
      );
    }
    if (!spinnerEnclosedOnMain) {
      pushSpinnerMainTerminalDouble(ends, spinnerTile);
    }
    if (north.length) {
      pushTerminal(
        ends,
        BRANCH.SPINNER_TOP,
        north[north.length - 1],
        "right",
        spinnerId
      );
    }
    if (south.length) {
      pushTerminal(
        ends,
        BRANCH.SPINNER_BOTTOM,
        south[south.length - 1],
        "right",
        spinnerId
      );
    }
  }

  const allowed = new Set(tableTileIds(board, north, south));
  for (const end of ends) {
    if (!allowed.has(end.sourceTileId)) {
      throw new Error(
        `Scoring terminal ${end.sourceTileId} is not on the post-move board`
      );
    }
    if (spinnerId && end.sourceTileId === spinnerId) {
      if (spinnerEnclosedOnMain) {
        throw new Error(
          `Internal spinner ${spinnerId} must not remain a scoring terminal`
        );
      }
      if (end.reason !== "spinner-terminal-double-on-main-line") {
        throw new Error(
          `Spinner ${spinnerId} may only score as a main-line terminal double`
        );
      }
    }
  }
  return ends;
}

/**
 * @param {object} state
 * @returns {{ id: string|null, pip: number|null, north: object[], south: object[] }}
 */
export function readSpinnerLayout(state) {
  const north = Array.isArray(state?.spinnerNorth) ? state.spinnerNorth : [];
  const south = Array.isArray(state?.spinnerSouth) ? state.spinnerSouth : [];
  const id = typeof state?.spinnerId === "string" ? state.spinnerId : null;
  const tile = id && state?.byId ? state.byId[id] : null;
  const pip =
    tile && tile.isDouble
      ? Number(tile.a)
      : id && Array.isArray(state?.board)
        ? Number(state.board.find((entry) => entry.id === id)?.left)
        : null;
  return { id, pip: Number.isFinite(pip) ? pip : null, north, south };
}

function boardTileById(board, id) {
  if (!id || !Array.isArray(board)) return null;
  return board.find((tile) => tile.id === id) ?? null;
}

/**
 * Occupancy of the four spinner directions from logical topology.
 * Empty N/S ports are inactive until a branch exists — they are not scoring
 * ends. Occupied ports are not scoring ends; the outer terminal is.
 *
 * @param {object} options
 * @returns {{ left: object, right: object, north: object, south: object }}
 */
export function getSpinnerPortStates(options = {}) {
  const board = Array.isArray(options.board) ? options.board : [];
  const north = Array.isArray(options.spinnerNorth) ? options.spinnerNorth : [];
  const south = Array.isArray(options.spinnerSouth) ? options.spinnerSouth : [];
  const spinnerId = typeof options.spinnerId === "string" ? options.spinnerId : null;
  const spinner = boardTileById(board, spinnerId);
  const spinnerIndex = spinner ? board.findIndex((tile) => tile.id === spinner.id) : -1;
  const pip = spinner && isDoubleTile(spinner) ? tilePip(spinner) : null;

  const port = (status, extra = {}) => ({ status, value: null, tileId: null, ...extra });

  if (!spinner || pip == null) {
    return {
      left: port(board.length ? "open" : "inactive"),
      right: port(board.length ? "open" : "inactive"),
      north: port("inactive"),
      south: port("inactive"),
    };
  }

  const leftOccupied = spinnerIndex > 0;
  const rightOccupied = spinnerIndex >= 0 && spinnerIndex < board.length - 1;
  return {
    left: leftOccupied
      ? port("occupied", { tileId: board[0].id, value: 0 })
      : port("open", { tileId: spinner.id, value: pip }),
    right: rightOccupied
      ? port("occupied", { tileId: board[board.length - 1].id, value: 0 })
      : port("open", { tileId: spinner.id, value: pip }),
    north: north.length
      ? port("occupied", { tileId: north[north.length - 1].id, value: 0 })
      : port("inactive"),
    south: south.length
      ? port("occupied", { tileId: south[south.length - 1].id, value: 0 })
      : port("inactive"),
  };
}

/**
 * Legacy scoring endpoints. Same terminals as getCurrentTerminalEnds, with
 * `branch` aliased to the old left/right/north/south port names.
 *
 * @param {object|object[]} boardState
 * @returns {object[]}
 */
export function getOpenScoringEndpoints(boardState = {}) {
  return getCurrentTerminalEnds(boardState).map((end) => ({
    ...end,
    branch: end.port,
  }));
}

/**
 * @deprecated Prefer getOpenScoringEndpoints — same topology, legacy field names.
 */
export function getExposedBoardEnds(options = {}) {
  return getOpenScoringEndpoints(options);
}

/**
 * Active exposed-end pip values after the move.
 *
 * @param {object} options
 * @returns {number[]}
 */
export function collectExposedEndValues(options = {}) {
  return getOpenScoringEndpoints(options).map((end) => end.value);
}

/**
 * Sum of currently exposed / open playable ends.
 *
 * @param {object[]|object} boardOrState
 * @param {object} [layout]
 * @returns {number}
 */
export function exposedEndTotalFromLayout(boardOrState, layout = {}) {
  if (Array.isArray(boardOrState)) {
    return collectExposedEndValues({ board: boardOrState, ...layout }).reduce(
      (sum, pip) => sum + pip,
      0
    );
  }
  return collectExposedEndValues({
    board: boardOrState?.board,
    spinnerId: boardOrState?.spinnerId,
    spinnerNorth: boardOrState?.spinnerNorth,
    spinnerSouth: boardOrState?.spinnerSouth,
    ...layout,
  }).reduce((sum, pip) => sum + pip, 0);
}

/**
 * Whether the hand has any legal main-chain (left/right) placement.
 *
 * @param {string[]} handIds
 * @param {object[]} board
 * @param {Record<string, object>} byId
 * @returns {{ left: boolean, right: boolean, moves: object[] }}
 */
export function mainChainLegal(handIds, board, byId) {
  const moves = getLegalMoves(handIds, board, byId);
  return {
    left: moves.some((move) => move.end === END.LEFT),
    right: moves.some((move) => move.end === END.RIGHT),
    moves,
  };
}

/**
 * True when this hand has at least one legal spinner N/S placement.
 * Spinner destinations are independent of left/right — a tile may legally
 * choose either a main-chain end or a spinner branch.
 *
 * @param {string[]} handIds
 * @param {object} state
 * @returns {boolean}
 */
export function spinnerBranchesAvailable(handIds, state) {
  if (!usesAllFivesSpinner(state) || !state?.spinnerId) return false;
  if (!Array.isArray(state.board) || state.board.length === 0) return false;
  return spinnerBranchMoves(handIds, state).length > 0;
}

function branchOpenPip(branchTiles, spinnerPip) {
  if (!branchTiles.length) return spinnerPip;
  return Number(branchTiles[branchTiles.length - 1].right);
}

/**
 * Place a tile onto a spinner arm. Matching half faces the spinner / prior
 * arm tile; `right` is the new exposed pip of that branch.
 *
 * @param {object} tile
 * @param {number} endPip
 * @returns {object}
 */
export function resolveSpinnerBranchPlacement(tile, endPip, end = END.NORTH) {
  if (!tileHasPip(tile, endPip)) {
    throw new Error(`Tile ${tile.id} cannot attach to spinner pip ${endPip}`);
  }
  const freePip = oppositePip(tile, endPip);
  return stampTileDestination(
    {
      id: tile.id,
      left: endPip,
      right: freePip,
      orientation: tile.isDouble ? ORIENTATION.HORIZONTAL : ORIENTATION.VERTICAL,
    },
    end === END.SOUTH || end === BRANCH.SPINNER_BOTTOM ? END.SOUTH : END.NORTH
  );
}

function spinnerBranchMoves(handIds, state) {
  const { id, pip, north, south } = readSpinnerLayout(state);
  if (!id || pip == null) return [];
  const northPip = branchOpenPip(north, pip);
  const southPip = branchOpenPip(south, pip);
  /** @type {object[]} */
  const moves = [];
  for (const tileId of handIds) {
    const tile = state.byId[tileId];
    if (!tile) throw new Error(`Unknown tile id in hand: ${tileId}`);
    if (tileHasPip(tile, northPip)) {
      const placement = resolveSpinnerBranchPlacement(tile, northPip, END.NORTH);
      moves.push(
        annotateMoveDestination({
          tileId,
          end: SPINNER_NORTH,
          left: placement.left,
          right: placement.right,
          orientation: placement.orientation,
        })
      );
    }
    if (tileHasPip(tile, southPip)) {
      const placement = resolveSpinnerBranchPlacement(tile, southPip, END.SOUTH);
      moves.push(
        annotateMoveDestination({
          tileId,
          end: SPINNER_SOUTH,
          left: placement.left,
          right: placement.right,
          orientation: placement.orientation,
        })
      );
    }
  }
  return moves;
}

/**
 * All Fives legal moves: every currently legal destination — main-chain
 * left/right plus spinner N/S when the spinner is on the board. The UI
 * chooses among them; the engine does not collapse or prioritize.
 *
 * @param {string[]} handIds
 * @param {object} state
 * @returns {object[]}
 */
export function getAllFivesLegalMoves(handIds, state) {
  const main = mainChainLegal(handIds, state.board, state.byId);
  if (!state.spinnerId || !state.board?.length) return main.moves;
  return [...main.moves, ...spinnerBranchMoves(handIds, state)];
}

/**
 * Apply a legal All Fives placement (main chain or spinner branch).
 *
 * @param {object} match
 * @param {number} playerIndex
 * @param {object} legal
 * @param {object} tile
 * @param {object[]} nextBoard
 * @returns {object}
 */
export function stampAllFivesSpinner(match, tile, nextBoard, _legal, nextNorth, nextSouth) {
  let spinnerId = match.spinnerId ?? null;
  if (!spinnerId && tile.isDouble) spinnerId = tile.id;
  return {
    ...match,
    board: nextBoard,
    spinnerId,
    spinnerNorth: nextNorth,
    spinnerSouth: nextSouth,
  };
}

/**
 * HUD scores while the table +N event is still showing.
 * Engine scores are already updated; the board HUD lags by ~2s.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number} [options.lastPlayPoints]
 * @param {number|null} [options.lastPlayPointsSeat]
 * @param {number} [options.holdElapsedMs]
 * @param {number} [options.holdMs]
 * @returns {number[]}
 */
export function hudScoresDuringHold({
  scores,
  lastPlayPoints = 0,
  lastPlayPointsSeat = null,
  holdElapsedMs = 0,
  holdMs = PLAY_SCORE_HOLD_MS,
}) {
  if (!Array.isArray(scores)) return [];
  const pts = Number(lastPlayPoints) || 0;
  if (pts <= 0 || lastPlayPointsSeat == null) return scores.slice();
  if (holdElapsedMs >= holdMs) return scores.slice();
  return scores.map((score, index) =>
    index === lastPlayPointsSeat ? score - pts : score
  );
}

/**
 * @param {number} points
 * @returns {boolean}
 */
export function shouldShowPlayScorePopup(points) {
  const pts = Number(points);
  return Number.isFinite(pts) && pts > 0 && pts % 5 === 0;
}
