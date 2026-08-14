/**
 * American Spinner + open-end helpers (pure engine — no React).
 *
 * Spinner: the first double played becomes the Spinner. Later doubles do not.
 * The Spinner may accept tiles on four arms: left, right, north, south.
 * Left/right are the main chain and must be used whenever the hand can match
 * either horizontal end. North/south are secondary branches — legal only when
 * the hand has no left/right play.
 */

import { END, ORIENTATION } from "../constants.js";
import {
  createOpeningPlacement,
  getOpenEnds,
  resolvePlacement,
} from "../board.js";
import { tileHasPip, oppositePip } from "../tiles.js";

/** @typedef {"left"|"right"|"north"|"south"} AmericanEnd */

export const AMERICAN_MATCH_TARGET = 200;

export const AMERICAN_END = Object.freeze({
  LEFT: END.LEFT,
  RIGHT: END.RIGHT,
  NORTH: "north",
  SOUTH: "south",
});

/**
 * @param {object} [state]
 * @returns {{ spinnerId: string|null, spinnerNorth: object[], spinnerSouth: object[] }}
 */
export function readSpinnerState(state) {
  return {
    spinnerId:
      typeof state?.spinnerId === "string" && state.spinnerId
        ? state.spinnerId
        : null,
    spinnerNorth: Array.isArray(state?.spinnerNorth) ? state.spinnerNorth : [],
    spinnerSouth: Array.isArray(state?.spinnerSouth) ? state.spinnerSouth : [],
  };
}

/**
 * @returns {{ spinnerId: null, spinnerNorth: object[], spinnerSouth: object[] }}
 */
export function emptySpinnerState() {
  return { spinnerId: null, spinnerNorth: [], spinnerSouth: [] };
}

/**
 * First double placed becomes Spinner; later doubles never replace it.
 * @param {string|null} prevSpinnerId
 * @param {{ id: string, isDouble?: boolean, left?: number, right?: number, a?: number, b?: number }} placed
 * @param {Record<string, { isDouble?: boolean, a?: number, b?: number }>} [byId]
 * @returns {string|null}
 */
export function resolveSpinnerAfterPlace(prevSpinnerId, placed, byId = {}) {
  if (prevSpinnerId) return prevSpinnerId;
  if (!placed?.id) return null;
  const meta = byId[placed.id];
  if (meta?.isDouble) return placed.id;
  if (placed.isDouble) return placed.id;
  if (
    typeof placed.left === "number" &&
    typeof placed.right === "number" &&
    placed.left === placed.right
  ) {
    return placed.id;
  }
  if (typeof meta?.a === "number" && meta.a === meta.b) return placed.id;
  return null;
}

/**
 * @param {object} tile
 * @param {"left"|"right"|"outer"} side
 * @returns {number}
 */
function tipPip(tile, side) {
  if (side === "left") return tile.left;
  return tile.right;
}

/**
 * Pip value contributed by an open tip. Doubles count both halves.
 * @param {object} tile
 * @param {"left"|"right"|"outer"} side
 * @returns {number}
 */
export function openTipScore(tile, side) {
  if (!tile) return 0;
  if (tile.left === tile.right) return tile.left * 2;
  return tipPip(tile, side);
}

/**
 * Currently open playable ends for an American board (with optional Spinner).
 *
 * @param {object} state
 * @returns {{ end: AmericanEnd, pip: number, isDoubleTip: boolean }[]}
 */
export function listAmericanOpenEnds(state) {
  const board = Array.isArray(state?.board) ? state.board : [];
  if (!board.length) return [];

  const { spinnerId, spinnerNorth, spinnerSouth } = readSpinnerState(state);
  const byId = state?.byId ?? {};
  /** @type {{ end: AmericanEnd, pip: number, isDoubleTip: boolean }[]} */
  const ends = [];

  const leftTile = board[0];
  ends.push({
    end: AMERICAN_END.LEFT,
    pip: leftTile.left,
    isDoubleTip: leftTile.left === leftTile.right,
  });

  const rightTile = board[board.length - 1];
  ends.push({
    end: AMERICAN_END.RIGHT,
    pip: rightTile.right,
    isDoubleTip: rightTile.left === rightTile.right,
  });

  if (!spinnerId) return ends;

  const spinnerMeta = byId[spinnerId];
  const face =
    typeof spinnerMeta?.a === "number"
      ? spinnerMeta.a
      : board.find((t) => t.id === spinnerId)?.left;

  if (typeof face !== "number") return ends;

  if (spinnerNorth.length === 0) {
    ends.push({ end: AMERICAN_END.NORTH, pip: face, isDoubleTip: false });
  } else {
    const tip = spinnerNorth[spinnerNorth.length - 1];
    ends.push({
      end: AMERICAN_END.NORTH,
      pip: tip.right,
      isDoubleTip: tip.left === tip.right,
    });
  }

  if (spinnerSouth.length === 0) {
    ends.push({ end: AMERICAN_END.SOUTH, pip: face, isDoubleTip: false });
  } else {
    const tip = spinnerSouth[spinnerSouth.length - 1];
    ends.push({
      end: AMERICAN_END.SOUTH,
      pip: tip.right,
      isDoubleTip: tip.left === tip.right,
    });
  }

  return ends;
}

/**
 * Tip contribution for a chain end (double tip → both halves).
 * @param {{ left: number, right: number }} tip
 * @param {"left" | "right"} outerSide - which face is exposed
 */
function tipScore(tip, outerSide) {
  if (tip.left === tip.right) return tip.left * 2;
  return outerSide === "left" ? tip.left : tip.right;
}

/**
 * Authoritative American/Muggins scoring ends from board topology only.
 *
 * Each existing branch contributes exactly one value: the pip(s) on its
 * current exposed outer endpoint. Connected / internal halves are 0.
 *
 * Spinner (first double):
 * - While it is still a main-line terminus (west or east unused), it counts
 *   as an open double: both faces, once. That is 6-6 + 6-3 → 6+6+3 = 15.
 * - Once both west and east have tiles, those spinner sides are covered and
 *   must not be counted again. Only outer tips of existing branches count.
 * - An unused north/south side is not a branch and does not add spinner pips.
 *
 * Layout / DOM / pixel orientation are never consulted.
 *
 * @param {object} state
 * @returns {number[]}
 */
export function getAmericanScoringEnds(state) {
  const board = Array.isArray(state?.board) ? state.board : [];
  if (!board.length) return [];

  const { spinnerId, spinnerNorth, spinnerSouth } = readSpinnerState(state);

  if (!spinnerId) {
    if (board.length === 1) return [board[0].left, board[0].right];
    return [
      tipScore(board[0], "left"),
      tipScore(board[board.length - 1], "right"),
    ];
  }

  const spinnerIndex = board.findIndex((t) => t.id === spinnerId);
  if (spinnerIndex < 0) {
    if (board.length === 1) return [board[0].left, board[0].right];
    return [
      tipScore(board[0], "left"),
      tipScore(board[board.length - 1], "right"),
    ];
  }

  const westGrown = spinnerIndex > 0;
  const eastGrown = spinnerIndex < board.length - 1;
  const northGrown = spinnerNorth.length > 0;
  const southGrown = spinnerSouth.length > 0;
  const face = board[spinnerIndex].left;

  /** @type {number[]} */
  const ends = [];

  // Open double on the main line only while at least one of W/E is unused.
  // Connected spinner sides never contribute their own face again.
  if (!westGrown || !eastGrown) {
    ends.push(face, face);
  }

  if (westGrown) ends.push(tipScore(board[0], "left"));
  if (eastGrown) ends.push(tipScore(board[board.length - 1], "right"));
  if (northGrown) {
    ends.push(tipScore(spinnerNorth[spinnerNorth.length - 1], "right"));
  }
  if (southGrown) {
    ends.push(tipScore(spinnerSouth[spinnerSouth.length - 1], "right"));
  }

  return ends;
}

/**
 * Sum of authoritative American scoring ends.
 *
 * @param {object} state
 * @returns {number}
 */
export function americanExposedEndTotal(state) {
  return getAmericanScoringEnds(state).reduce((sum, n) => sum + n, 0);
}

/**
 * Exact American point award from an exposed-end total.
 * Full total when positive and divisible by 5 — never "5 per multiple".
 *
 * @param {number} total
 * @returns {number}
 */
export function americanPointsFromExposedTotal(total) {
  if (total > 0 && total % 5 === 0) return total;
  return 0;
}

/**
 * Dev/test snapshot of American exposed-end scoring.
 * Not wired into production UI.
 *
 * @param {object} state
 * @returns {{ exposedEnds: number[], exposedTotal: number, awardedScore: number }}
 */
export function describeAmericanExposedEnds(state) {
  const exposedEnds = getAmericanScoringEnds(state);
  const exposedTotal = exposedEnds.reduce((sum, n) => sum + n, 0);
  return {
    exposedEnds,
    exposedTotal,
    awardedScore: americanPointsFromExposedTotal(exposedTotal),
  };
}

/**
 * Live score for a placement — exact open-end total when divisible by 5.
 * Opening plays may score (no suppression). Repeated totals may score again.
 *
 * @param {object} state - state AFTER the place (includes spinner fields)
 * @returns {number}
 */
export function scoreAmericanPlay(state) {
  return americanPointsFromExposedTotal(americanExposedEndTotal(state));
}

/**
 * @param {object} tile
 * @param {number} endPip
 * @returns {object} BoardTile growing an arm (outer face on `.right`)
 */
function placeOnArmTip(tile, endPip) {
  if (!tileHasPip(tile, endPip)) {
    throw new Error(`Tile ${tile.id} cannot attach to arm pip ${endPip}`);
  }
  const freePip = oppositePip(tile, endPip);
  // N/S arms travel vertically. `.left` faces the spinner / previous tip
  // (matching pip); `.right` is the exposed outer end. Display layer swaps
  // painted halves so the matching pip physically touches the neighbor.
  return {
    id: tile.id,
    left: endPip,
    right: freePip,
    orientation: ORIENTATION.VERTICAL,
  };
}

/**
 * Legal American placements.
 *
 * Main chain is left/right. North/south spinner branches are offered only
 * when the hand has no tile that can legally attach to either horizontal end.
 *
 * @param {string[]} handIds
 * @param {object} state - board + spinner fields + byId
 * @returns {import("../moves.js").LegalMove[]}
 */
export function getAmericanLegalMoves(handIds, state) {
  const board = Array.isArray(state?.board) ? state.board : [];
  const byId = state?.byId ?? {};
  /** @type {import("../moves.js").LegalMove[]} */
  const moves = [];

  if (!handIds.length) return moves;

  if (!board.length) {
    for (const id of handIds) {
      const tile = byId[id];
      if (!tile) throw new Error(`Unknown tile id in hand: ${id}`);
      const placement = createOpeningPlacement(tile);
      moves.push({
        tileId: id,
        end: END.RIGHT,
        left: placement.left,
        right: placement.right,
        orientation: placement.orientation,
      });
    }
    return moves;
  }

  const openEnds = listAmericanOpenEnds(state);
  const mainEnds = openEnds.filter(
    (open) =>
      open.end === AMERICAN_END.LEFT || open.end === AMERICAN_END.RIGHT
  );
  const branchEnds = openEnds.filter(
    (open) =>
      open.end === AMERICAN_END.NORTH || open.end === AMERICAN_END.SOUTH
  );

  pushMatchingAmericanMoves(moves, handIds, byId, mainEnds);
  if (moves.length > 0) return moves;

  pushMatchingAmericanMoves(moves, handIds, byId, branchEnds);
  return moves;
}

/**
 * @param {import("../moves.js").LegalMove[]} moves
 * @param {string[]} handIds
 * @param {Record<string, object>} byId
 * @param {{ end: AmericanEnd, pip: number }[]} openEnds
 */
function pushMatchingAmericanMoves(moves, handIds, byId, openEnds) {
  for (const open of openEnds) {
    for (const id of handIds) {
      const tile = byId[id];
      if (!tile) throw new Error(`Unknown tile id in hand: ${id}`);
      if (!tileHasPip(tile, open.pip)) continue;

      if (open.end === AMERICAN_END.LEFT || open.end === AMERICAN_END.RIGHT) {
        const placement = resolvePlacement(tile, open.pip, open.end);
        moves.push({
          tileId: id,
          end: open.end,
          left: placement.left,
          right: placement.right,
          orientation: placement.orientation,
        });
        continue;
      }

      const placement = placeOnArmTip(tile, open.pip);
      moves.push({
        tileId: id,
        end: open.end,
        left: placement.left,
        right: placement.right,
        orientation: placement.orientation,
      });
    }
  }
}

/**
 * Apply an American placement (main chain or Spinner arm).
 *
 * @param {object} state
 * @param {{ id: string, a: number, b: number, isDouble: boolean }} tile
 * @param {AmericanEnd} end
 * @returns {object} partial next board/spinner fields
 */
export function placeAmericanTile(state, tile, end) {
  const board = Array.isArray(state.board) ? state.board : [];
  const { spinnerId, spinnerNorth, spinnerSouth } = readSpinnerState(state);

  if (board.some((t) => t.id === tile.id)) {
    throw new Error(`Tile ${tile.id} is already on the board`);
  }
  if (
    spinnerNorth.some((t) => t.id === tile.id) ||
    spinnerSouth.some((t) => t.id === tile.id)
  ) {
    throw new Error(`Tile ${tile.id} is already on a spinner arm`);
  }

  if (!board.length) {
    const opening = createOpeningPlacement(tile);
    const nextSpinner = resolveSpinnerAfterPlace(null, opening, {
      [tile.id]: tile,
    });
    return {
      board: [opening],
      spinnerId: nextSpinner,
      spinnerNorth: [],
      spinnerSouth: [],
    };
  }

  if (end === AMERICAN_END.LEFT || end === AMERICAN_END.RIGHT) {
    const ends = getOpenEnds(board);
    const pip = end === AMERICAN_END.LEFT ? ends.left : ends.right;
    const placed = resolvePlacement(tile, /** @type {number} */ (pip), end);
    const nextBoard =
      end === AMERICAN_END.LEFT ? [placed, ...board] : [...board, placed];
    const nextSpinner = resolveSpinnerAfterPlace(spinnerId, placed, {
      ...(state.byId ?? {}),
      [tile.id]: tile,
    });
    return {
      board: nextBoard,
      spinnerId: nextSpinner,
      spinnerNorth,
      spinnerSouth,
    };
  }

  if (!spinnerId) {
    throw new Error("Cannot play on spinner arms before a Spinner exists");
  }

  if (end === AMERICAN_END.NORTH) {
    const pip =
      spinnerNorth.length === 0
        ? (state.byId?.[spinnerId]?.a ??
          board.find((t) => t.id === spinnerId)?.left)
        : spinnerNorth[spinnerNorth.length - 1].right;
    const placed = placeOnArmTip(tile, /** @type {number} */ (pip));
    return {
      board,
      spinnerId,
      spinnerNorth: [...spinnerNorth, placed],
      spinnerSouth,
    };
  }

  if (end === AMERICAN_END.SOUTH) {
    const pip =
      spinnerSouth.length === 0
        ? (state.byId?.[spinnerId]?.a ??
          board.find((t) => t.id === spinnerId)?.left)
        : spinnerSouth[spinnerSouth.length - 1].right;
    const placed = placeOnArmTip(tile, /** @type {number} */ (pip));
    return {
      board,
      spinnerId,
      spinnerNorth,
      spinnerSouth: [...spinnerSouth, placed],
    };
  }

  throw new Error(`Unknown American board end: ${end}`);
}

/**
 * True when exactly one legal destination exists for a tile (auto-place OK).
 * @param {import("../moves.js").LegalMove[]} legalMoves
 * @param {string} tileId
 */
export function hasUniqueDestination(legalMoves, tileId) {
  const ends = new Set(
    legalMoves.filter((m) => m.tileId === tileId).map((m) => m.end)
  );
  return ends.size === 1;
}

/**
 * Resolve drag destination: auto when unique; otherwise require explicit end.
 *
 * @param {import("../moves.js").LegalMove[]} legalMoves
 * @param {string} tileId
 * @param {string|null|undefined} end
 * @returns {import("../moves.js").LegalMove|null}
 */
export function resolveAmericanPlayChoice(legalMoves, tileId, end) {
  const moves = legalMoves.filter((m) => m.tileId === tileId);
  if (!moves.length) return null;

  if (typeof end === "string" && end) {
    return moves.find((m) => m.end === end) ?? null;
  }

  const ends = [...new Set(moves.map((m) => m.end))];
  if (ends.length === 1) {
    return moves.find((m) => m.end === ends[0]) ?? null;
  }
  return null;
}
