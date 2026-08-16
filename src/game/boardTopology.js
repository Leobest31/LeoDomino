/**
 * Authoritative logical board topology.
 *
 * Every played tile belongs to exactly one membership:
 *   MAIN_LEFT | MAIN_RIGHT | SPINNER | SPINNER_TOP | SPINNER_BOTTOM
 *
 * Before the first double exists, only MAIN_LEFT and MAIN_RIGHT are valid.
 * SPINNER_TOP / SPINNER_BOTTOM do not exist yet and must stay empty.
 *
 * Layout and the renderer read this structure. They must never infer branch
 * from rotation, CSS, x/y, double orientation, proximity, or bounding box.
 *
 * Scoring endpoints stay on the existing left/right/north/south port names.
 */

import { END } from "./constants.js";

export const BRANCH = Object.freeze({
  MAIN_LEFT: "MAIN_LEFT",
  MAIN_RIGHT: "MAIN_RIGHT",
  SPINNER_TOP: "SPINNER_TOP",
  SPINNER_BOTTOM: "SPINNER_BOTTOM",
});

/** Center anchor — the first double. Not a playable destination. */
export const SPINNER_NODE = "SPINNER";

const MAIN_BRANCHES = new Set([BRANCH.MAIN_LEFT, BRANCH.MAIN_RIGHT]);
const ARM_BRANCHES = new Set([BRANCH.SPINNER_TOP, BRANCH.SPINNER_BOTTOM]);

const END_TO_DESTINATION = Object.freeze({
  [END.LEFT]: BRANCH.MAIN_LEFT,
  [END.RIGHT]: BRANCH.MAIN_RIGHT,
  [END.NORTH]: BRANCH.SPINNER_TOP,
  [END.SOUTH]: BRANCH.SPINNER_BOTTOM,
  [BRANCH.MAIN_LEFT]: BRANCH.MAIN_LEFT,
  [BRANCH.MAIN_RIGHT]: BRANCH.MAIN_RIGHT,
  [BRANCH.SPINNER_TOP]: BRANCH.SPINNER_TOP,
  [BRANCH.SPINNER_BOTTOM]: BRANCH.SPINNER_BOTTOM,
});

const DESTINATION_TO_END = Object.freeze({
  [BRANCH.MAIN_LEFT]: END.LEFT,
  [BRANCH.MAIN_RIGHT]: END.RIGHT,
  [BRANCH.SPINNER_TOP]: END.NORTH,
  [BRANCH.SPINNER_BOTTOM]: END.SOUTH,
  [END.LEFT]: END.LEFT,
  [END.RIGHT]: END.RIGHT,
  [END.NORTH]: END.NORTH,
  [END.SOUTH]: END.SOUTH,
});

function isDoubleTile(tile) {
  return Boolean(tile) && Number(tile.left) === Number(tile.right);
}

/**
 * @param {unknown} end
 * @returns {string|null}
 */
export function destinationFromEnd(end) {
  return END_TO_DESTINATION[end] ?? null;
}

/**
 * Accept MAIN_RIGHT or "right" from UI / AI / tests.
 * @param {unknown} end
 * @returns {unknown}
 */
export function coercePlayEnd(end) {
  return DESTINATION_TO_END[end] ?? end;
}

export function isMainChainBranch(branch) {
  return MAIN_BRANCHES.has(branch) || branch === "left" || branch === "right" || branch === "main";
}

export function isSpinnerArmBranch(branch) {
  return ARM_BRANCHES.has(branch) || branch === "north" || branch === "south";
}

export function isSpinnerNode(branch) {
  return branch === SPINNER_NODE || branch === "center";
}

/**
 * Public layout branch name. Internal packer labels (left/right/north/south)
 * are mapped here so the renderer never sees inferred geometry names.
 *
 * @param {unknown} branch
 * @returns {string|null}
 */
export function publicLayoutBranch(branch) {
  if (branch === "left" || branch === BRANCH.MAIN_LEFT) return BRANCH.MAIN_LEFT;
  if (branch === "right" || branch === "main" || branch === BRANCH.MAIN_RIGHT) {
    return BRANCH.MAIN_RIGHT;
  }
  if (branch === "north" || branch === BRANCH.SPINNER_TOP) return BRANCH.SPINNER_TOP;
  if (branch === "south" || branch === BRANCH.SPINNER_BOTTOM) return BRANCH.SPINNER_BOTTOM;
  if (branch === "center" || branch === SPINNER_NODE) return SPINNER_NODE;
  return typeof branch === "string" ? branch : null;
}

/**
 * Stamp the chosen destination onto a placed board tile. Never overwrite an
 * already-stamped destination — applyPlace is the only writer.
 *
 * @param {object} tile
 * @param {unknown} end
 * @returns {object}
 */
export function stampTileDestination(tile, end) {
  const destination = destinationFromEnd(end) ?? BRANCH.MAIN_RIGHT;
  if (tile?.destination && MAIN_BRANCHES.has(tile.destination) && ARM_BRANCHES.has(destination)) {
    throw new Error(
      `Destination rewrite blocked: ${tile.id} ${tile.destination} → ${destination}`
    );
  }
  return {
    ...tile,
    destination,
    branch: destination,
  };
}

/**
 * Attach destination onto a legal-move object. `end` stays left/right/north/south
 * for scoring and legacy callers.
 *
 * @param {object} move
 * @returns {object}
 */
export function annotateMoveDestination(move) {
  if (!move) return move;
  const destination = destinationFromEnd(move.end) ?? move.destination ?? null;
  if (!destination) return move;
  return { ...move, destination };
}

function emptyBranches() {
  return {
    [BRANCH.MAIN_LEFT]: [],
    [BRANCH.MAIN_RIGHT]: [],
    [BRANCH.SPINNER_TOP]: [],
    [BRANCH.SPINNER_BOTTOM]: [],
  };
}

/**
 * Build the one logical board topology used by applyPlace, layout, and render.
 *
 * Spinner membership is taken only from spinnerId (first double). North/south
 * arrays are ignored until that spinner exists. Main-chain tiles are never
 * moved onto TOP/BOTTOM.
 *
 * @param {object} state
 * @returns {{
 *   spinnerId: string|null,
 *   firstDouble: string|null,
 *   spinner: object|null,
 *   branches: Record<string, object[]>,
 *   membership: Record<string, string>,
 * }}
 */
export function buildBoardTopology(state = {}) {
  const board = Array.isArray(state.board) ? state.board : [];
  const rawSpinnerId = typeof state.spinnerId === "string" && state.spinnerId
    ? state.spinnerId
    : null;
  const spinner = rawSpinnerId
    ? board.find((tile) => tile.id === rawSpinnerId) ?? null
    : null;
  const firstDouble = spinner && isDoubleTile(spinner) ? spinner.id : null;

  const branches = emptyBranches();
  /** @type {Record<string, string>} */
  const membership = {};

  if (!firstDouble) {
    for (const tile of board) {
      const dest = destinationFromEnd(tile.destination) ?? destinationFromEnd(tile.branch);
      const branch = dest === BRANCH.MAIN_LEFT ? BRANCH.MAIN_LEFT : BRANCH.MAIN_RIGHT;
      membership[tile.id] = branch;
      branches[branch].push(tile);
    }
    return {
      spinnerId: null,
      firstDouble: null,
      spinner: null,
      branches,
      membership,
    };
  }

  const spinnerIndex = board.findIndex((tile) => tile.id === firstDouble);
  for (let i = 0; i < board.length; i += 1) {
    const tile = board[i];
    if (i < spinnerIndex) {
      membership[tile.id] = BRANCH.MAIN_LEFT;
      branches[BRANCH.MAIN_LEFT].push(tile);
    } else if (i > spinnerIndex) {
      membership[tile.id] = BRANCH.MAIN_RIGHT;
      branches[BRANCH.MAIN_RIGHT].push(tile);
    } else {
      membership[tile.id] = SPINNER_NODE;
    }
  }

  const north = Array.isArray(state.spinnerNorth) ? state.spinnerNorth : [];
  const south = Array.isArray(state.spinnerSouth) ? state.spinnerSouth : [];
  for (const tile of north) {
    membership[tile.id] = BRANCH.SPINNER_TOP;
    branches[BRANCH.SPINNER_TOP].push(tile);
  }
  for (const tile of south) {
    membership[tile.id] = BRANCH.SPINNER_BOTTOM;
    branches[BRANCH.SPINNER_BOTTOM].push(tile);
  }

  return {
    spinnerId: firstDouble,
    firstDouble,
    spinner,
    branches,
    membership,
  };
}

/**
 * Hard pre-spinner / exclusive-membership invariants. Throw on violation.
 *
 * @param {ReturnType<typeof buildBoardTopology>} topology
 */
export function assertBoardTopology(topology) {
  if (!topology) {
    throw new Error("Board topology is missing");
  }
  const top = topology.branches[BRANCH.SPINNER_TOP] || [];
  const bottom = topology.branches[BRANCH.SPINNER_BOTTOM] || [];

  if (topology.firstDouble == null) {
    if (top.length !== 0) {
      throw new Error("Pre-spinner invariant: SPINNER_TOP.length must equal 0");
    }
    if (bottom.length !== 0) {
      throw new Error("Pre-spinner invariant: SPINNER_BOTTOM.length must equal 0");
    }
    for (const [id, branch] of Object.entries(topology.membership || {})) {
      if (branch !== BRANCH.MAIN_LEFT && branch !== BRANCH.MAIN_RIGHT) {
        throw new Error(
          `Pre-spinner invariant: ${id} must be MAIN_LEFT/MAIN_RIGHT, got ${branch}`
        );
      }
    }
  }

  const seen = new Set();
  for (const [id, branch] of Object.entries(topology.membership || {})) {
    if (seen.has(id)) {
      throw new Error(`Topology invariant: ${id} belongs to more than one branch`);
    }
    seen.add(id);
    if (
      branch !== BRANCH.MAIN_LEFT &&
      branch !== BRANCH.MAIN_RIGHT &&
      branch !== BRANCH.SPINNER_TOP &&
      branch !== BRANCH.SPINNER_BOTTOM &&
      branch !== SPINNER_NODE
    ) {
      throw new Error(`Topology invariant: ${id} has unknown branch ${branch}`);
    }
  }
}

/**
 * Layout orientation from topology + travel, never from CSS / bbox / proximity.
 *
 * Doubles on the main line are visually vertical but still belong to MAIN_*.
 * Ordinary pre-spinner tiles are always horizontal.
 *
 * @param {object} tile
 * @param {string|null} branch
 * @param {"E"|"W"|"N"|"S"|null} [travelDir]
 * @param {boolean} [hasSpinner]
 * @returns {"horizontal"|"vertical"}
 */
export function orientationForBranch(tile, branch, travelDir = null, hasSpinner = false) {
  if (isDoubleTile(tile) && (isSpinnerNode(branch) || hasSpinner && isMainChainBranch(branch))) {
    return "vertical";
  }
  if (isDoubleTile(tile) && !hasSpinner) {
    return "vertical";
  }
  if (!hasSpinner && isMainChainBranch(branch)) {
    return "horizontal";
  }
  if (isMainChainBranch(branch) && (travelDir === "E" || travelDir === "W" || !travelDir)) {
    return isDoubleTile(tile) ? "vertical" : "horizontal";
  }
  if (isSpinnerArmBranch(branch) && (travelDir === "N" || travelDir === "S" || !travelDir)) {
    return isDoubleTile(tile) ? "horizontal" : "vertical";
  }
  if (travelDir === "N" || travelDir === "S") return "vertical";
  return "horizontal";
}

function traceEnabled() {
  if (typeof globalThis !== "undefined" && globalThis.__LEO_TOPOLOGY_TRACE__) {
    return true;
  }
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Dev-only per-move topology trace. Production builds strip import.meta.env.DEV.
 *
 * @param {object} entry
 */
export function traceTopologyMove(entry) {
  if (!entry || !traceEnabled()) return;
  const tile = entry.tile ?? "?";
  const chosen = entry.chosenDestination ?? "?";
  const stored = entry.storedBranch ?? "?";
  const layout = entry.layoutBranch ?? "?";
  const orientation = entry.orientation ?? "?";
  const x = entry.x != null ? Number(entry.x).toFixed(1) : "?";
  const y = entry.y != null ? Number(entry.y).toFixed(1) : "?";
  console.debug(
    `tile=${tile} chosenDestination=${chosen} storedBranch=${stored} layoutBranch=${layout} orientation=${orientation} x=${x} y=${y}`
  );
}
