/**
 * Board presentation fidelity — logical chain + on-table pip facing.
 *
 * Logical tiles store `left` / `right` along the chain (toward board[0] / board[n-1]).
 * DominoTile paints first half toward screen W/N and second half toward E/S.
 *
 * Layout owns footprints. This module swaps painted ends so the half that faces
 * each neighbor always shows the matching connection pip.
 */

const OPP = Object.freeze({ E: "W", W: "E", N: "S", S: "N" });

function isDouble(tile) {
  return Number(tile.left) === Number(tile.right);
}

/**
 * Official rule: every adjacent pair must share the same pip value.
 * @param {{ id?: string, left: number, right: number }[]} board
 */
export function assertLogicalConnections(board) {
  if (!Array.isArray(board)) {
    return { ok: false, reason: "not-array" };
  }
  for (let i = 0; i < board.length - 1; i += 1) {
    const a = board[i];
    const b = board[i + 1];
    if (Number(a.right) !== Number(b.left)) {
      return {
        ok: false,
        reason: "logical-mismatch",
        index: i,
        expected: Number(a.right),
        actual: Number(b.left),
        leftId: a.id,
        rightId: b.id,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} from
 * @param {{ x: number, y: number, w: number, h: number }} to
 * @returns {"E"|"W"|"N"|"S"}
 */
export function facingToward(from, to) {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "E" : "W";
  }
  return dy >= 0 ? "S" : "N";
}

/** Squared distance from a point to the closest point on a rect. */
function dist2ToRect(px, py, r) {
  const qx = Math.max(r.x, Math.min(px, r.x + r.w));
  const qy = Math.max(r.y, Math.min(py, r.y + r.h));
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

/**
 * Which painted half of `pos` faces `neighborPos`.
 * Horizontal: left = west end, right = east end.
 * Vertical: left = north end, right = south end.
 * Uses closest end to the neighbor (corner-safe), not center-axis alone.
 * @returns {"left"|"right"}
 */
export function facingHalf(pos, neighborPos, orientation) {
  if (orientation === "horizontal") {
    const cy = pos.y + pos.h / 2;
    const dLeft = dist2ToRect(pos.x, cy, neighborPos);
    const dRight = dist2ToRect(pos.x + pos.w, cy, neighborPos);
    return dRight <= dLeft ? "right" : "left";
  }
  const cx = pos.x + pos.w / 2;
  const dLeft = dist2ToRect(cx, pos.y, neighborPos);
  const dRight = dist2ToRect(cx, pos.y + pos.h, neighborPos);
  return dRight <= dLeft ? "right" : "left";
}

/** True when neighbor lies mainly along the tile's end-to-end axis. */
function neighborOnAxis(pos, neighborPos, orientation) {
  const dx = Math.abs(neighborPos.x + neighborPos.w / 2 - (pos.x + pos.w / 2));
  const dy = Math.abs(neighborPos.y + neighborPos.h / 2 - (pos.y + pos.h / 2));
  return orientation === "vertical" ? dy >= dx : dx >= dy;
}

/**
 * @param {{ left: number, right: number }} display
 * @param {"left"|"right"} half
 */
export function pipOnHalf(display, half) {
  return half === "left" ? Number(display.left) : Number(display.right);
}

/**
 * @param {{ left: number, right: number }} display
 * @param {"E"|"W"|"N"|"S"} edge
 * @deprecated Prefer pipOnHalf + facingHalf for corners
 */
export function pipOnEdge(display, edge) {
  if (edge === "W" || edge === "N") return Number(display.left);
  return Number(display.right);
}

/**
 * Resolve painted ends for a logical board tile at its laid position.
 */
export function resolveTileDisplay(tile, pos, towardRightPos, towardLeftPos) {
  const orientation =
    pos?.orientation === "horizontal" || pos?.orientation === "vertical"
      ? pos.orientation
      : isDouble(tile)
        ? "vertical"
        : "horizontal";

  let faceRightDir = orientation === "horizontal" ? "E" : "S";
  if (towardRightPos) {
    faceRightDir = facingToward(pos, towardRightPos);
  } else if (towardLeftPos) {
    faceRightDir = OPP[facingToward(pos, towardLeftPos)];
  }

  if (isDouble(tile)) {
    return {
      left: Number(tile.left),
      right: Number(tile.right),
      orientation,
      faceRightDir,
      swapped: false,
    };
  }

  // Put logical `left` on the half that faces board[i-1].
  // When both neighbors collapse to the same end (serpentine corner), prefer
  // the on-axis neighbor so end-to-end links stay correct.
  let swap = false;
  if (towardLeftPos && towardRightPos) {
    let halfTowardLeft = facingHalf(pos, towardLeftPos, orientation);
    const halfTowardRight = facingHalf(pos, towardRightPos, orientation);
    if (halfTowardLeft === halfTowardRight) {
      const leftAxis = neighborOnAxis(pos, towardLeftPos, orientation);
      const rightAxis = neighborOnAxis(pos, towardRightPos, orientation);
      if (rightAxis && !leftAxis) {
        halfTowardLeft = halfTowardRight === "right" ? "left" : "right";
      } else if (leftAxis && !rightAxis) {
        // keep halfTowardLeft
      } else {
        halfTowardLeft = facingHalf(pos, towardLeftPos, orientation);
      }
    }
    swap = halfTowardLeft === "right";
  } else if (towardLeftPos) {
    swap = facingHalf(pos, towardLeftPos, orientation) === "right";
  } else if (towardRightPos) {
    swap = facingHalf(pos, towardRightPos, orientation) === "left";
  }

  return {
    left: swap ? Number(tile.right) : Number(tile.left),
    right: swap ? Number(tile.left) : Number(tile.right),
    orientation,
    faceRightDir,
    swapped: swap,
  };
}

/**
 * Screen positions for Spinner north/south arms (vertical, growing away
 * from the Spinner). Does not invent matching — callers still paint via
 * `resolveTileDisplay` so the connecting half faces the Spinner.
 *
 * @param {{ id?: string, x: number, y: number, w: number, h: number }} spinPos
 * @param {{ id: string, left: number, right: number }[]} spinnerNorth
 * @param {{ id: string, left: number, right: number }[]} spinnerSouth
 * @param {number} [gap]
 */
export function layoutSpinnerArmPositions(
  spinPos,
  spinnerNorth = [],
  spinnerSouth = [],
  gap = 2
) {
  const short = Math.min(spinPos.w, spinPos.h);
  const long = Math.max(spinPos.w, spinPos.h);
  const x = spinPos.x + (spinPos.w - short) / 2;
  const north = spinnerNorth.map((tile, index) => ({
    tile,
    pos: {
      id: tile.id,
      x,
      y: spinPos.y - (index + 1) * (long + gap),
      w: short,
      h: long,
      orientation: "vertical",
    },
  }));
  const south = spinnerSouth.map((tile, index) => ({
    tile,
    pos: {
      id: tile.id,
      x,
      y: spinPos.y + spinPos.h + gap + index * (long + gap),
      w: short,
      h: long,
      orientation: "vertical",
    },
  }));
  return { north, south };
}

/**
 * Painted Spinner-arm tiles. Logical `.left` faces the Spinner; the display
 * swap puts that matching pip on the half that physically touches it.
 * Vertical paint: `left` = north half, `right` = south half.
 *
 * @param {{ id?: string, x: number, y: number, w: number, h: number }} spinPos
 * @param {{ id: string, left: number, right: number }[]} spinnerNorth
 * @param {{ id: string, left: number, right: number }[]} spinnerSouth
 * @param {number} [gap]
 */
export function buildSpinnerArmDisplays(
  spinPos,
  spinnerNorth = [],
  spinnerSouth = [],
  gap = 2,
  armPlacements = null
) {
  const byEngine = Array.isArray(armPlacements) && armPlacements.length
    ? new Map(armPlacements.map((p) => [p.id, p]))
    : null;
  const { north, south } = byEngine
    ? {
        north: spinnerNorth
          .map((tile) => {
            const pos = byEngine.get(tile.id);
            return pos ? { tile, pos } : null;
          })
          .filter(Boolean),
        south: spinnerSouth
          .map((tile) => {
            const pos = byEngine.get(tile.id);
            return pos ? { tile, pos } : null;
          })
          .filter(Boolean),
      }
    : layoutSpinnerArmPositions(
        spinPos,
        spinnerNorth,
        spinnerSouth,
        gap
      );
  const out = [];

  north.forEach((entry, i) => {
    const towardSpinner = i === 0 ? spinPos : north[i - 1].pos;
    out.push({
      tile: entry.tile,
      pos: entry.pos,
      display: resolveTileDisplay(entry.tile, entry.pos, null, towardSpinner),
    });
  });

  south.forEach((entry, i) => {
    const towardSpinner = i === 0 ? spinPos : south[i - 1].pos;
    out.push({
      tile: entry.tile,
      pos: entry.pos,
      display: resolveTileDisplay(entry.tile, entry.pos, null, towardSpinner),
    });
  });

  return out;
}

/**
 * Exposed pip after orientation: the free half opposite the neighbor.
 * North branch → north (top) half; south → south (bottom) half.
 *
 * @param {{ left: number, right: number, orientation?: string }} display
 * @param {"north"|"south"|"left"|"right"} branch
 */
export function exposedPipFromDisplay(display, branch) {
  if (branch === "north" || branch === "left") return Number(display.left);
  return Number(display.right);
}

/**
 * Build display descriptors for every board tile.
 */
export function buildBoardDisplays(boardTiles, placements) {
  const byId = new Map(placements.map((p) => [p.id, p]));
  return boardTiles.map((tile, i) => {
    const pos = byId.get(tile.id);
    if (!pos) {
      return { tile, pos: null, display: null };
    }
    const towardRight = i < boardTiles.length - 1 ? byId.get(boardTiles[i + 1].id) : null;
    const towardLeft = i > 0 ? byId.get(boardTiles[i - 1].id) : null;
    return {
      tile,
      pos,
      display: resolveTileDisplay(tile, pos, towardRight, towardLeft),
    };
  });
}

/**
 * Verify every adjacent pair paints matching pips on the halves that face each other.
 */
export function assertVisualConnections(boardTiles, placements) {
  const displays = buildBoardDisplays(boardTiles, placements);

  for (let i = 0; i < displays.length - 1; i += 1) {
    const a = displays[i];
    const b = displays[i + 1];
    if (!a.pos || !b.pos || !a.display || !b.display) {
      return { ok: false, reason: "missing-placement", index: i };
    }

    const expected = Number(a.tile.right);
    if (expected !== Number(b.tile.left)) {
      return {
        ok: false,
        reason: "logical-mismatch",
        index: i,
        leftId: a.tile.id,
        rightId: b.tile.id,
        expected,
        actual: Number(b.tile.left),
      };
    }

    // Doubles match on both halves — any facing half is valid if value equals expected
    if (isDouble(a.tile) && isDouble(b.tile)) {
      if (Number(a.tile.left) !== expected || Number(b.tile.left) !== expected) {
        return { ok: false, reason: "double-mismatch", index: i };
      }
      continue;
    }

    const halfA = facingHalf(a.pos, b.pos, a.display.orientation);
    const halfB = facingHalf(b.pos, a.pos, b.display.orientation);
    const pipA = isDouble(a.tile) ? expected : pipOnHalf(a.display, halfA);
    const pipB = isDouble(b.tile) ? expected : pipOnHalf(b.display, halfB);

    if (pipA !== expected || pipB !== expected || pipA !== pipB) {
      return {
        ok: false,
        reason: "visual-mismatch",
        index: i,
        leftId: a.tile.id,
        rightId: b.tile.id,
        dir: facingToward(a.pos, b.pos),
        halfA,
        halfB,
        pipA,
        pipB,
        expected,
        logical: { aRight: a.tile.right, bLeft: b.tile.left },
      };
    }
  }

  return { ok: true };
}

/**
 * Full presentation audit: rules + layout + visual facing.
 *
 * @param {{ id: string, left: number, right: number }[]} board
 * @param {object} [options]
 * @param {number} [options.centerIndex]
 * @param {{ width: number, height: number }} [options.viewport]
 * @param {{ w: number, h: number }} [options.tileSize]
 * @param {typeof import("./BoardLayoutEngine.js").layoutBoard} [options.layoutFn]
 */
export function validateBoardPresentation(board, options = {}) {
  const logical = assertLogicalConnections(board);
  if (!logical.ok) {
    return { ok: false, stage: "logical", ...logical };
  }

  if (!board.length) {
    return { ok: true, stage: "empty", tileScale: 1, issues: [] };
  }

  const layoutFn = options.layoutFn;
  if (!layoutFn) {
    return { ok: true, stage: "logical-only", ...logical };
  }

  const viewport = options.viewport ?? { width: 800, height: 400 };
  const tileSize = options.tileSize ?? { w: 40, h: 76 };
  const centerIndex =
    options.centerIndex != null
      ? options.centerIndex
      : Math.max(0, board.findIndex((t) => t.id === options.centerTileId));
  const safeCenter =
    centerIndex >= 0 && centerIndex < board.length ? centerIndex : 0;

  const { placements, tileScale } = layoutFn(board, safeCenter, viewport, tileSize);
  if (placements.length !== board.length) {
    return {
      ok: false,
      stage: "layout",
      reason: "placement-count",
      expected: board.length,
      actual: placements.length,
    };
  }

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const overlap =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      if (overlap) {
        return {
          ok: false,
          stage: "layout",
          reason: "overlap",
          tileScale,
          leftId: a.id,
          rightId: b.id,
        };
      }
    }
  }

  const visual = assertVisualConnections(board, placements);
  if (!visual.ok) {
    return { ok: false, stage: "visual", tileScale, ...visual };
  }

  return {
    ok: true,
    stage: "complete",
    tileScale,
    placementCount: placements.length,
  };
}

/**
 * Dev-friendly reporter — logs once per distinct failure signature.
 * @returns {boolean} true when board is valid
 */
export function reportBoardPresentation(board, options = {}) {
  const result = validateBoardPresentation(board, options);
  if (result.ok) return true;

  const key = `${result.stage}:${result.reason}:${result.index}:${result.leftId}:${result.rightId}`;
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[LeoDomino] Board presentation invalid:", key, result);
  }
  return false;
}
