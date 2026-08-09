/**
 * DominoLayoutEngine — Matrix / node-based spatial board layout (from scratch)
 *
 * Layer 2 of the board stack:
 *   Logical chain (game) → Spatial engine (this file) → Renderer (BoardContainer)
 *
 * Pure functions only. No React, no CSS flow layout.
 * Every tile gets absolute (x, y, rotation). Overlaps are never emitted.
 *
 * Coordinate system (local): origin (0,0) at the opening tile center.
 * Screen mapping: fixed tile scale, opener pinned to PLAYABLE FELT mid
 * (not the outer stage / viewport center). Soft search bounds never expand
 * past the hard green-table rect — camera/pan must not hide off-felt tiles.
 *
 * Rotation convention (degrees):
 *   0   — horizontal (long axis E–W)
 *   90  — vertical   (long axis N–S)
 *   180 — horizontal flipped (paint handled by display layer)
 *   270 — vertical flipped
 */

/** @typedef {{ id: string, left: number, right: number }} BoardTile */
/** @typedef {{ width: number, height: number }} Viewport */

export const TILE_ASPECT = 2;
/** Constant face-to-face visual gap (0–2 px). */
export const CHAIN_GAP = 2;
export const GAP = CHAIN_GAP;
export const MARGIN = 14;
export const PADDING = 28;
export const BRIDGE_LEN = 2;
/**
 * Plan B/C: readable board floor. Effective tile scale must not fall below
 * this for normal match lengths (≤28) unless a hard layout failure forces
 * the documented emergency path (EMERGENCY_MIN_SCALE).
 */
export const MIN_BOARD_SCALE = 0.85;
/** @deprecated Prefer MIN_BOARD_SCALE — kept as alias for callers/tests. */
export const MIN_TILE_SCALE = MIN_BOARD_SCALE;
export const MIN_SCALE = MIN_BOARD_SCALE;
/**
 * First horizontal run on each arm: exactly this many tiles straight,
 * then the next tile must take the deterministic first fold
 * (right → DOWN/S, left → UP/N).
 */
export const TURN_EVERY = 3;
/** Soft upper bound on later horizontal runs after the first fold. */
export const RUN_CEILING = 6;
export const CHAIN_GAP_PX = CHAIN_GAP;
export const SEGMENT_TILES = TURN_EVERY;
/** Canonical first-fold directions (locked snake). */
export const FIRST_FOLD_RIGHT = "S";
export const FIRST_FOLD_LEFT = "N";
export const SAFETY_MARGIN_PX = MARGIN;
export const MIN_BOARD_ZOOM = MIN_BOARD_SCALE;
export const MAX_GLOBAL_ZOOM = MIN_BOARD_SCALE;
/** Desktop readability floor for effective board tile short side (px). */
export const MIN_DESKTOP_TILE_PX = 30;
/**
 * Board CSS multiplies hand tile vars by this factor (must match
 * BoardContainer.css `--board-tile-hand-factor`). Plan B/C previously used
 * ~3.96 (~134×254 on desktop) which dominated the felt; ~2.15 (~72×136)
 * keeps tiles readable, stable through mid-match, and on-felt for ≤19.
 * LOCKED — do not reduce; layout must fit this size without shrink-to-fit.
 */
export const BOARD_TILE_HAND_FACTOR = 2.15;
/** Soft floor/ceiling for the unscaled board base short side (px). */
export const BOARD_BASE_SHORT_MIN_PX = 44;
export const BOARD_BASE_SHORT_MAX_PX = 80;
/** Locked middle-range board tile (hand×2.15) — tests assert this floor. */
export const LOCKED_BOARD_TILE_SHORT_PX = 72;
export const LOCKED_BOARD_TILE_LONG_PX = 136;
/**
 * Extra collision halo around spinner (double) boxes — not added to face gap.
 * Sized for the locked ~72×136 footprint (was tuned on smaller tiles).
 */
export const SPINNER_RESERVE = 6;
/** Extra collision halo around turn/corner tiles (direction changes). */
export const CORNER_RESERVE = 4;
/** Extra collision halo around vertical-bridge tiles (keeps branches apart). */
export const BRIDGE_RESERVE = 3;
/** Hard floor for the final on-screen gap — never allowed to shrink toward 0. */
export const MIN_SAFE_GAP_PX = 0.6;

const EMERGENCY_MIN_SCALE = 0.05;
/** Extra clearance so half-pixel snap after screen mapping cannot collapse the gap. */
const SNAP_CLEARANCE = 0.5;
const OPP = Object.freeze({ E: "W", W: "E", N: "S", S: "N" });

function snap(n) {
  return Math.round(n * 2) / 2;
}

function isDouble(tile) {
  return Number(tile.left) === Number(tile.right);
}

/** How many tiles ahead (in travel order) to look when preferring a double
 * as the natural fold point instead of an arbitrary run-limit cutoff. */
const DOUBLE_LOOKAHEAD = 2;

/** True if a double appears within `count` tiles ahead of index `i`,
 * walking in travel order (`step` is +1 for the right arm, -1 for left). */
function hasDoubleAhead(tiles, i, step, count) {
  for (let k = 1; k <= count; k += 1) {
    const t = tiles[i + k * step];
    if (!t) break;
    if (isDouble(t)) return true;
  }
  return false;
}

/**
 * Reserve halos shrink proportionally at emergency-small scales (deep
 * chains on tiny viewports) so they never make an already-tight layout
 * geometrically infeasible — at normal scale the full reserve applies.
 */
function scaledReserve(base, span) {
  if (span >= 20) return base;
  return Math.min(base, Math.max(0, span * 0.12));
}

/**
 * Reserve halo for a placed tile — larger around doubles (spinners), then
 * turn/corner tiles, then vertical-bridge tiles, so branches never crowd
 * the geometry that other arms depend on for clearance.
 */
export function reserveFor(p) {
  const span = Math.max(p.w || 0, p.h || 0);
  if (p.double) return scaledReserve(SPINNER_RESERVE, span);
  if (p.isCorner) return scaledReserve(CORNER_RESERVE, span);
  if (p.isBridge) return scaledReserve(BRIDGE_RESERVE, span);
  return 0;
}

/**
 * Fixed collision rectangle for a placed tile.
 * Spinners, corners, and vertical bridges get a reserve halo so branches
 * clear the body and never enter another branch's reserved space.
 */
export function collisionBox(p) {
  const pad = reserveFor(p);
  return {
    id: p.id,
    x: p.x - pad,
    y: p.y - pad,
    w: p.w + pad * 2,
    h: p.h + pad * 2,
    double: !!p.double,
    isCorner: !!p.isCorner,
    isBridge: !!p.isBridge,
  };
}

/**
 * Doubles always stay vertical (spinner on E/W rails; end-to-end on bridges).
 * Non-doubles align with the path.
 */
export function rotationForTravel(tile, dir) {
  if (isDouble(tile)) return 90;
  const alongEW = dir === "E" || dir === "W";
  return alongEW ? 0 : 90;
}

export function orientationForTravel(tile, dir) {
  return rotationForTravel(tile, dir) === 90 ? "vertical" : "horizontal";
}

export function rotationForOrientation(orientation) {
  return orientation === "horizontal" ? 0 : 90;
}

/** Footprint in local px for a travel direction. */
export function footprintForTravel(tile, dir, size) {
  const rotation = rotationForTravel(tile, dir);
  const vertical = rotation === 90 || rotation === 270;
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  return {
    w: vertical ? short : long,
    h: vertical ? long : short,
    orientation: vertical ? "vertical" : "horizontal",
    rotation,
  };
}

export function tileFootprint(tile, size) {
  const vertical = (tile.orientation || "horizontal") === "vertical";
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  return vertical ? { w: short, h: long } : { w: long, h: short };
}

function effectiveGap(short, long, requested = CHAIN_GAP) {
  const span = Math.max(short, long);
  // Keep visual gap in the 0–2 px band; ease down only for emergency tiny tiles.
  if (span >= 12) return Math.min(2, Math.max(0, requested));
  return Math.max(0, Math.min(2, requested, snap(span * 0.08)));
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function axisClearance(a, b) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  if (xOv && yOv) return -1;
  const xClear =
    a.x + a.w <= b.x
      ? b.x - (a.x + a.w)
      : b.x + b.w <= a.x
        ? a.x - (b.x + b.w)
        : 0;
  const yClear =
    a.y + a.h <= b.y
      ? b.y - (a.y + a.h)
      : b.y + b.h <= a.y
        ? a.y - (b.y + b.h)
        : 0;
  if (xOv) return yClear;
  if (yOv) return xClear;
  return Math.min(xClear, yClear);
}

/**
 * Collision gate: fixed AABB (spinner/corner/bridge halo included); non-neighbors
 * need ≥ minClear. Vertical branches vs horizontal rails are rejected on any AABB hit.
 * At emergency-tiny spans, fall back to essential boxes so routing stays feasible.
 */
function findCollision(box, occupied, gap, attachId = null, minClear = gap + SNAP_CLEARANCE) {
  const span = Math.max(box.w || 0, box.h || 0, 0);
  const useEssential = span < 20;
  const probe = useEssential ? essentialCollisionBox(box) : collisionBox(box);
  for (const other of occupied) {
    if (other.id === box.id) continue;
    const hull = useEssential ? essentialCollisionBox(other) : collisionBox(other);
    if (other.id === attachId) {
      // Neighbors: only the visual tile boxes may not overlap (halo may touch).
      if (overlaps(box, other)) return { other, reason: "overlap-attach" };
      continue;
    }
    if (overlaps(probe, hull)) return { other, reason: "aabb-overlap" };
    const xOv = probe.x < hull.x + hull.w && probe.x + probe.w > hull.x;
    const yOv = probe.y < hull.y + hull.h && probe.y + probe.h > hull.y;
    const clear = axisClearance(probe, hull);
    if (xOv && clear < minClear - 0.05) {
      return { other, reason: "row-clearance", clearance: clear };
    }
    if (yOv && clear < minClear - 0.05) {
      return { other, reason: "col-clearance", clearance: clear };
    }
  }
  return null;
}

function fitsSoft(box, soft) {
  return (
    box.x >= soft.minX - 0.01 &&
    box.y >= soft.minY - 0.01 &&
    box.x + box.w <= soft.maxX + 0.01 &&
    box.y + box.h <= soft.maxY + 0.01
  );
}

/**
 * Temporarily widen soft bounds so a started vertical bridge / first fold
 * can finish — but NEVER past the hard playable-table rect.
 */
function expandSoft(soft, size, bridges = BRIDGE_LEN, hard = null) {
  const pad = Math.max(size.w, size.h) * bridges + CHAIN_GAP * 3;
  const expanded = {
    minX: soft.minX - pad,
    maxX: soft.maxX + pad,
    minY: soft.minY - pad,
    maxY: soft.maxY + pad,
  };
  if (!hard) return expanded;
  return {
    minX: Math.max(hard.minX, expanded.minX),
    maxX: Math.min(hard.maxX, expanded.maxX),
    minY: Math.max(hard.minY, expanded.minY),
    maxY: Math.min(hard.maxY, expanded.maxY),
  };
}

/** Local hard bounds when opener maps to playable-felt mid at identity scale. */
function localHardBounds(play) {
  const playW = Math.max(1, play.maxX - play.minX);
  const playH = Math.max(1, play.maxY - play.minY);
  return {
    minX: -playW / 2,
    maxX: playW / 2,
    minY: -playH / 2,
    maxY: playH / 2,
  };
}

function playMid(play) {
  return {
    x: (play.minX + play.maxX) / 2,
    y: (play.minY + play.maxY) / 2,
  };
}

/** True if every screen tile AABB sits fully inside the playable green rect. */
function screenTilesInsidePlay(tiles, play, pad = 0.5) {
  for (const t of tiles) {
    if (t.x < play.minX - pad) return false;
    if (t.y < play.minY - pad) return false;
    if (t.x + t.w > play.maxX + pad) return false;
    if (t.y + t.h > play.maxY + pad) return false;
  }
  return true;
}

/**
 * Place `tile` against `prev` traveling `dir`.
 * Face gap is always `gap` (0–2 px). Spinner reserve is collision-only (see collisionBox).
 *
 * 90° turns use END-SIDE attachment (not underlap): the next tile sits past the
 * open end of `prev` so horizontal and vertical AABBs only touch at the
 * connection endpoint — never stack the vertical body under the rail. That
 * underlap was tuned for smaller tiles and collides with spinner protrusions
 * at the locked ~72×136 board size.
 */
function placeAgainst(prev, tile, dir, size, gap, fromDir) {
  const fp = footprintForTravel(tile, dir, size);
  const turning = Boolean(fromDir && fromDir !== dir);
  const prevVert = prev.h > prev.w + 0.5;
  const prevDouble = !!prev.double;
  const ew = dir === "E" || dir === "W";
  let x;
  let y;

  const edge = () => {
    if (dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y + (prev.h - fp.h) / 2 };
    }
    if (dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y + (prev.h - fp.h) / 2 };
    }
    if (dir === "S") {
      return { x: prev.x + (prev.w - fp.w) / 2, y: prev.y + prev.h + gap };
    }
    return { x: prev.x + (prev.w - fp.w) / 2, y: prev.y - gap - fp.h };
  };

  /** Rail → bridge: sit past the open end, flush with the travel-side edge. */
  const railToBridge = () => {
    if (fromDir === "E" && dir === "S") {
      return { x: prev.x + prev.w + gap, y: prev.y };
    }
    if (fromDir === "E" && dir === "N") {
      return { x: prev.x + prev.w + gap, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "W" && dir === "S") {
      return { x: prev.x - gap - fp.w, y: prev.y };
    }
    if (fromDir === "W" && dir === "N") {
      return { x: prev.x - gap - fp.w, y: prev.y + prev.h - fp.h };
    }
    return null;
  };

  /** Bridge → rail: sit past the open end, flush with the exit edge. */
  const bridgeToRail = () => {
    if (fromDir === "S" && dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "S" && dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "N" && dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y };
    }
    if (fromDir === "N" && dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y };
    }
    return null;
  };

  if (!turning || prevDouble) {
    ({ x, y } = edge());
  } else if (!prevVert && !ew) {
    ({ x, y } = railToBridge() || edge());
  } else if (prevVert && ew) {
    ({ x, y } = bridgeToRail() || edge());
  } else {
    ({ x, y } = edge());
  }

  return {
    id: tile.id,
    x: snap(x),
    y: snap(y),
    w: snap(fp.w),
    h: snap(fp.h),
    orientation: fp.orientation,
    rotation: fp.rotation,
    double: isDouble(tile),
    valueLeft: Number(tile.left),
    valueRight: Number(tile.right),
  };
}

function isLegalStep(prev, tile, dir, size) {
  const fp = footprintForTravel(tile, dir, size);
  const prevVert = prev.h > prev.w + 0.5;
  const prevDouble = !!prev.double;
  const ew = dir === "E" || dir === "W";
  if (prevVert && !prevDouble && ew) {
    return !isDouble(tile) && fp.orientation === "horizontal";
  }
  if (!prevVert && !ew) {
    return fp.orientation === "vertical";
  }
  return true;
}

function tryPlace(prev, tile, dir, fromDir, size, gap, soft, occupied, hard = null) {
  if (!isLegalStep(prev, tile, dir, size)) return null;
  // Predict the full rotated footprint before committing the placement.
  const box = placeAgainst(prev, tile, dir, size, gap, fromDir);
  const turning = Boolean(fromDir && fromDir !== dir);
  box.isCorner = turning;
  box.isBridge = dir === "N" || dir === "S";
  // Soft encourages early turns; hard playable-table bounds always win.
  if (!fitsSoft(box, soft)) return null;
  if (hard && !fitsSoft(box, hard)) return null;
  if (findCollision(box, occupied, gap, prev.id)) return null;
  return box;
}

/**
 * Grow one arm as a deterministic serpentine ribbon.
 * First horizontal run: exactly TURN_EVERY tiles, then foldDir
 * (right→S / left→N). Later runs: turn before soft bounds / collision;
 * vertical: short bridge then reverse.
 */
function growArm(
  tiles,
  from,
  to,
  step,
  start,
  startDir,
  foldDir,
  size,
  gap,
  soft,
  out,
  branch,
  bridgeTarget,
  hard = soft
) {
  let prev = start;
  let dir = startDir;
  let lastH = startDir === "E" || startDir === "W" ? startDir : "E";
  let vertRun = 0;
  let exitAfterPivot = false;
  let run = 0;
  let firstFoldDone = false;

  for (let i = from; i !== to; i += step) {
    const tile = tiles[i];
    const occupied = [...out.values()];
    const onVertical = dir === "N" || dir === "S";
    const tileIsDouble = isDouble(tile);

    const attempt = (d) =>
      tryPlace(prev, tile, d, dir, size, gap, soft, occupied, hard);
    // First fold prefers foldDir; may ease soft toward hard (never past it).
    // Table bounds win: if preferred fold won't fit, other dirs are tried.
    const attemptFirstFold = (d) =>
      attempt(d) ||
      tryPlace(
        prev,
        tile,
        d,
        dir,
        size,
        gap,
        expandSoft(soft, size, 1, hard),
        occupied,
        hard
      );

    /** Probe whether a fold from `fromBox` traveling `fromTravel` still fits. */
    const foldFitsFrom = (fromBox, fromTravel, foldD) =>
      tryPlace(
        fromBox,
        tile,
        foldD,
        fromTravel,
        size,
        gap,
        expandSoft(soft, size, 1, hard),
        occupied,
        hard
      ) ||
      tryPlace(
        fromBox,
        tile,
        foldD,
        fromTravel,
        size,
        gap,
        soft,
        occupied,
        hard
      );

    let wantTurn = exitAfterPivot;
    if (!wantTurn) {
      const straight = attempt(dir);
      if (!straight) {
        // Next step would leave the playable table (or collide) — turn early.
        wantTurn = true;
      } else if (onVertical && vertRun >= Math.max(1, bridgeTarget)) {
        if ([OPP[lastH], lastH, foldDir, OPP[foldDir]].some((d) => attempt(d))) {
          wantTurn = true;
        }
      } else if (!onVertical && !firstFoldDone) {
        // Prefer TURN_EVERY straight then fold — but TABLE BOUNDS WIN:
        // if taking another straight would make the preferred fold miss the
        // hard felt, turn now in a safe direction.
        if (run >= TURN_EVERY) {
          wantTurn = true;
        } else if (run >= 1) {
          const foldAfterStraight =
            foldFitsFrom(straight, dir, foldDir) ||
            foldFitsFrom(straight, dir, OPP[foldDir]);
          const foldNow =
            foldFitsFrom(prev, dir, foldDir) ||
            foldFitsFrom(prev, dir, OPP[foldDir]);
          if (!foldAfterStraight && foldNow) {
            wantTurn = true;
          }
        }
      } else if (!onVertical) {
        // Later rails: fold before soft width is consumed (never shrink).
        // After the first fold the snake traverses nearly the FULL felt width
        // (not half) — using half here forced extra rows that blew the height.
        const long = Math.max(size.w, size.h);
        const short = Math.min(size.w, size.h);
        const softW = Math.max(1, soft.maxX - soft.minX);
        const railStep = long + gap + short * 0.35;
        const spaceDrivenRun = Math.max(
          1,
          Math.floor(softW / railStep) - 1
        );
        const compact = softW < 560;
        const targetRun = compact ? 4 : softW < 820 ? 5 : 6;
        const maxRun = Math.max(
          1,
          Math.min(RUN_CEILING, targetRun, spaceDrivenRun)
        );
        const nearLimit = run >= maxRun - 1;
        const effectiveMaxRun =
          nearLimit && hasDoubleAhead(tiles, i, step, DOUBLE_LOOKAHEAD)
            ? maxRun + DOUBLE_LOOKAHEAD
            : maxRun;
        if (run >= effectiveMaxRun && [foldDir, OPP[foldDir]].some((d) => attempt(d))) {
          wantTurn = true;
        }
      }
    }

    if (wantTurn && onVertical && tileIsDouble && attempt(dir)) {
      wantTurn = false;
      exitAfterPivot = true;
    }

    let chosen = null;
    let chosenDir = dir;

    // Prefer finishing bridgeTarget vertical tiles within hard table bounds.
    // If the bridge cannot continue on-felt, fall through to a normal turn.
    if (onVertical && vertRun > 0 && vertRun < Math.max(1, bridgeTarget)) {
      chosen =
        attempt(dir) ||
        tryPlace(
          prev,
          tile,
          dir,
          dir,
          size,
          gap,
          expandSoft(soft, size, bridgeTarget, hard),
          occupied,
          hard
        );
      if (chosen) chosenDir = dir;
    } else if (!wantTurn) {
      chosen = attempt(dir);
      chosenDir = dir;
    }

    // First elbow on this arm: locked foldDir (right→S, left→N).
    const lockingFirstFold = !firstFoldDone && !onVertical && wantTurn;

    if (!chosen) {
      const primary = onVertical
        ? [OPP[lastH], lastH, foldDir, OPP[foldDir], dir]
        : [foldDir, OPP[foldDir], OPP[lastH], lastH, dir];
      const seen = new Set();
      for (const d of primary) {
        if (seen.has(d)) continue;
        seen.add(d);
        const box =
          lockingFirstFold && d === foldDir ? attemptFirstFold(d) : attempt(d);
        if (box) {
          chosen = box;
          chosenDir = d;
          break;
        }
      }
      if (!chosen) {
        for (const d of ["E", "W", "N", "S"]) {
          if (seen.has(d)) continue;
          const box =
            lockingFirstFold && d === foldDir ? attemptFirstFold(d) : attempt(d);
          if (box) {
            chosen = box;
            chosenDir = d;
            break;
          }
        }
      }
    }

    if (!chosen) return false;
    if (findCollision(chosen, occupied, gap, prev.id)) return false;

    if (chosenDir === "E" || chosenDir === "W") {
      lastH = chosenDir;
      run = chosenDir === dir && !onVertical ? run + 1 : 1;
      vertRun = 0;
      if (exitAfterPivot) exitAfterPivot = false;
    } else {
      if (!firstFoldDone && (dir === "E" || dir === "W")) {
        firstFoldDone = true;
      }
      run = 0;
      vertRun = chosenDir === dir && onVertical ? vertRun + 1 : 1;
      if (!tileIsDouble) exitAfterPivot = false;
    }

    const turned = chosenDir !== dir;
    dir = chosenDir;
    const placed = {
      ...chosen,
      travelDir: chosenDir,
      branch,
      isCorner: turned,
      isBridge: chosenDir === "N" || chosenDir === "S",
    };
    out.set(tile.id, placed);
    prev = placed;
  }

  return true;
}

function bboxOf(items) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of items) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { minX, minY, maxX, maxY };
}

function screenAxisOk(placements, tiles, gap, boxFn = collisionBox) {
  const attach = new Set();
  for (let i = 0; i < tiles.length - 1; i += 1) {
    attach.add(`${tiles[i].id}|${tiles[i + 1].id}`);
    attach.add(`${tiles[i + 1].id}|${tiles[i].id}`);
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const connected = attach.has(`${a.id}|${b.id}`);
      // Neighbors: visual face gap must stay in the constant band (no overlap).
      if (connected) {
        if (overlaps(a, b)) return false;
        continue;
      }
      // Non-neighbors: fixed collision boxes (spinner halo included) must not intersect.
      const ca = boxFn(a);
      const cb = boxFn(b);
      if (overlaps(ca, cb)) return false;
      const xOv = ca.x < cb.x + cb.w && ca.x + ca.w > cb.x;
      const yOv = ca.y < cb.y + cb.h && ca.y + ca.h > cb.y;
      const clear = axisClearance(ca, cb);
      if ((xOv || yOv) && clear < gap - 0.05) return false;
    }
  }
  return true;
}

/** Essential-only box: doubles keep their spinner halo; corner/bridge reserve
 * is dropped. Used as a graceful-degradation fallback at emergency-tiny
 * scales, where the full reserve set would make an already-tight chain
 * geometrically unplaceable. */
function essentialCollisionBox(p) {
  return collisionBox({ ...p, isCorner: false, isBridge: false });
}

function chainCollisionFree(placements, gap, tiles, minClear = gap + SNAP_CLEARANCE) {
  const attach = new Map();
  if (tiles) {
    for (let i = 0; i < tiles.length - 1; i += 1) {
      const a = tiles[i].id;
      const b = tiles[i + 1].id;
      if (!attach.has(a)) attach.set(a, new Set());
      if (!attach.has(b)) attach.set(b, new Set());
      attach.get(a).add(b);
      attach.get(b).add(a);
    }
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const linked = attach.get(a.id)?.has(b.id);
      if (findCollision(a, [b], gap, linked ? b.id : null, minClear)) return false;
    }
  }
  return true;
}

function placeGraph(
  tiles,
  centerIndex,
  size,
  gap,
  soft,
  bridgeTarget,
  foldRight,
  foldLeft,
  swapArms,
  hard = soft
) {
  const opener = tiles[centerIndex];
  const fp = footprintForTravel(opener, "E", size);
  const origin = {
    id: opener.id,
    x: snap(-fp.w / 2),
    y: snap(-fp.h / 2),
    w: snap(fp.w),
    h: snap(fp.h),
    orientation: fp.orientation,
    rotation: fp.rotation,
    double: isDouble(opener),
    valueLeft: Number(opener.left),
    valueRight: Number(opener.right),
    branch: "center",
  };
  // Opener itself must sit inside the hard playable table.
  if (!fitsSoft(origin, hard)) {
    return { map: new Map(), ok: false };
  }

  const bridgeLens =
    bridgeTarget <= 1 ? [1] : [bridgeTarget, 1];
  for (const bridgeLen of bridgeLens) {
    const map = new Map([[opener.id, origin]]);
    const growRight = () =>
      growArm(
        tiles,
        centerIndex + 1,
        tiles.length,
        1,
        origin,
        "E",
        foldRight,
        size,
        gap,
        soft,
        map,
        "right",
        bridgeLen,
        hard
      );
    const growLeft = () =>
      growArm(
        tiles,
        centerIndex - 1,
        -1,
        -1,
        origin,
        "W",
        foldLeft,
        size,
        gap,
        soft,
        map,
        "left",
        bridgeLen,
        hard
      );

    const first = swapArms ? growLeft() : growRight();
    if (!first) continue;
    const second = swapArms ? growRight() : growLeft();
    if (!second) continue;

    const list = [...map.values()];
    if (
      map.size === tiles.length &&
      chainCollisionFree(list, gap, tiles) &&
      list.every((p) => fitsSoft(p, hard))
    ) {
      return { map, ok: true };
    }
  }
  return { map: new Map([[opener.id, origin]]), ok: false };
}

/** True if the local bbox, centered on (cx,cy) at `scale`, fits the playable felt. */
function bboxFitsPlay(bb, cx, cy, scale, play, midX, midY) {
  const shiftedMinX = (bb.minX - cx) * scale + midX;
  const shiftedMaxX = (bb.maxX - cx) * scale + midX;
  const shiftedMinY = (bb.minY - cy) * scale + midY;
  const shiftedMaxY = (bb.maxY - cy) * scale + midY;
  return (
    shiftedMinX >= play.minX - 0.5 &&
    shiftedMaxX <= play.maxX + 0.5 &&
    shiftedMinY >= play.minY - 0.5 &&
    shiftedMaxY <= play.maxY + 0.5
  );
}

/**
 * Pick a camera focus in local space. Prefer opener (playable-felt mid) when
 * the chain still fits; otherwise recenter on newest / endpoints / bbox —
 * but ONLY if the full chain stays inside the hard green table. Overflow
 * layouts are rejected by the searcher (camera must not hide off-felt tiles).
 */
function pickCameraFocus(placements, bb, openerId, focusTileId, scale, play, midX, midY) {
  const candidates = [];
  const pushFocus = (id, mode) => {
    if (!id) return;
    const p = placements.find((t) => t.id === id);
    if (!p) return;
    candidates.push({
      cx: p.x + p.w / 2,
      cy: p.y + p.h / 2,
      mode,
    });
  };
  pushFocus(openerId, "opener");
  pushFocus(focusTileId, "newest");
  // Midpoint of chain tips (playable endpoints).
  if (placements.length >= 2) {
    const a = placements[0];
    const b = placements[placements.length - 1];
    candidates.push({
      cx: (a.x + a.w / 2 + b.x + b.w / 2) / 2,
      cy: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
      mode: "endpoints",
    });
  }
  candidates.push({
    cx: (bb.minX + bb.maxX) / 2,
    cy: (bb.minY + bb.maxY) / 2,
    mode: "bbox",
  });

  for (const c of candidates) {
    if (bboxFitsPlay(bb, c.cx, c.cy, scale, play, midX, midY)) {
      return { ...c, recentered: c.mode !== "opener", overflow: false };
    }
  }
  // No on-felt focus — mark overflow so the searcher rejects this candidate.
  const fallback =
    candidates.find((c) => c.mode === "opener") ||
    candidates.find((c) => c.mode === "newest") ||
    candidates.find((c) => c.mode === "endpoints") ||
    candidates[candidates.length - 1];
  return { ...fallback, recentered: true, overflow: true };
}

/**
 * Map local layout → screen top-left with FIXED scale.
 *
 * Screen scale is identity (1); unit scale is applied during placement.
 * Origin maps to the PLAYABLE GREEN TABLE midpoint (HUD carve-out honored),
 * not the outer stage center. Does not accept off-table overflow.
 */
function toScreen(
  placements,
  viewport,
  padding = PADDING,
  openerId = null,
  margin = MARGIN,
  hudRight = null,
  focusTileId = null
) {
  void padding; // retained for call-site compatibility; no longer used for fit-shrink
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const play = computePlayBounds({ width, height }, margin, hudRight);
  const mid = playMid(play);
  const midX = mid.x;
  const midY = mid.y;

  if (!placements.length) {
    return {
      tiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: midX, y: midY },
      camera: {
        recentered: false,
        overflow: false,
        focusMode: "empty",
        x: midX,
        y: midY,
      },
    };
  }

  const bb = bboxOf(placements);
  const contentW = Math.max(1, bb.maxX - bb.minX);
  const contentH = Math.max(1, bb.maxY - bb.minY);

  // Identity screen scale — placement already used the chosen unitScale.
  // Do NOT derive scale from content bounding box.
  const scale = 1;
  const focus = pickCameraFocus(
    placements,
    bb,
    openerId,
    focusTileId,
    scale,
    play,
    midX,
    midY
  );
  const cx = focus.cx;
  const cy = focus.cy;

  const tiles = placements.map((p, zIndex) => {
    const lx = p.x + p.w / 2;
    const ly = p.y + p.h / 2;
    const sx = (lx - cx) * scale + midX;
    const sy = (ly - cy) * scale + midY;
    const w = p.w * scale;
    const h = p.h * scale;
    const quantize = snap;
    return {
      tileId: p.id,
      valueLeft: p.valueLeft,
      valueRight: p.valueRight,
      x: quantize(sx - w / 2),
      y: quantize(sy - h / 2),
      w: quantize(w),
      h: quantize(h),
      rotation: p.rotation,
      orientation: p.orientation,
      zIndex,
      travelDir: p.travelDir,
      branch: p.branch,
      double: p.double,
      isCorner: p.isCorner,
      isBridge: p.isBridge,
    };
  });

  // Snap can nudge half-pixels — re-verify hard playable containment.
  const overflow =
    focus.overflow || !screenTilesInsidePlay(tiles, play, 0.75);

  return {
    tiles,
    scale,
    content: {
      width: contentW,
      height: contentH,
      minX: bb.minX,
      maxX: bb.maxX,
      minY: bb.minY,
      maxY: bb.maxY,
    },
    origin: { x: midX, y: midY },
    camera: {
      recentered: focus.recentered,
      overflow,
      focusMode: focus.mode,
      x: midX,
      y: midY,
      localFocus: { x: cx, y: cy },
    },
  };
}

/**
 * Primary API — spatial layout for the full board chain.
 *
 * @param {BoardTile[]} boardGraph
 * @param {Viewport} viewportDimensions
 * @param {object} [options]
 * @returns {{
 *   tiles: Array<{tileId,valueLeft,valueRight,x,y,w,h,rotation,orientation,zIndex}>,
 *   scale: number,
 *   content: object,
 *   origin: {x:number,y:number},
 *   gap: number,
 * }}
 */
export function calculateBoardLayout(boardGraph, viewportDimensions, options = {}) {
  const tiles = Array.isArray(boardGraph) ? boardGraph : [];
  const width = Math.max(120, viewportDimensions?.width ?? 640);
  const height = Math.max(120, viewportDimensions?.height ?? 320);

  const marginEarly = options.margin ?? MARGIN;
  const hudRightEarly = options.hudRight ?? null;
  const playEarly = computePlayBounds(
    { width, height },
    marginEarly,
    hudRightEarly
  );
  const midEarly = playMid(playEarly);

  if (!tiles.length) {
    return {
      tiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: midEarly.x, y: midEarly.y },
      gap: CHAIN_GAP,
    };
  }

  let centerIndex =
    options.centerIndex != null
      ? options.centerIndex
      : tiles.findIndex((t) => t.id === options.centerTileId);
  if (centerIndex < 0 || centerIndex >= tiles.length) centerIndex = 0;

  const baseW = Math.max(1, options.tileWidth ?? options.tileSize?.w ?? 40);
  const baseH = Math.max(1, options.tileHeight ?? options.tileSize?.h ?? baseW * TILE_ASPECT);
  const margin = marginEarly;
  const requestedGap = options.gap ?? CHAIN_GAP;
  // Optional, measured-live reserve for HUD chrome (scoreboard / reserve
  // counter) pinned over the top-right / bottom-right of the felt — see
  // BoardContainer's `hudReserve` prop. Falls back to the built-in estimate
  // in computePlayBounds when not supplied, so existing callers/tests are
  // unaffected.
  const hudRight = hudRightEarly;
  const play = playEarly;

  // Hard local bounds = playable green table centered on opener (= felt mid).
  // Soft is a slight inset so the snake prefers turning before the edge.
  // Soft NEVER expands past hard — no off-felt sprawl / camera overflow.
  const hardLocal = localHardBounds(play);
  const softInset = Math.min(10, PADDING);
  const playW0 = Math.max(1, play.maxX - play.minX);
  const playH0 = Math.max(1, play.maxY - play.minY);
  const softW0 = Math.max(120, playW0 - softInset);
  const softH0 = Math.max(100, playH0 - softInset);
  // Cramped = genuinely small playable felt. Do NOT key off base tile size:
  // board base is a moderate hand×factor capped by the felt (see resolveBoardTileBase).
  const crampedViewport = playW0 < 480 || playH0 < 400;

  // Cap starting unit scale so a growing chain on a fixed viewport cannot
  // suddenly upscale (BoardContainer passes prior scale as maxScale).
  const scaleCap = Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(1, options.maxScale != null ? Number(options.maxScale) : 1)
  );
  let unitScale = Number.isFinite(scaleCap) ? scaleCap : 1;
  let result = null;
  let looseFallback = null;
  let fallback = null;
  let essentialFallback = null;
  /** Best collision-free layout by tile scale — prefer full-size early match. */
  let bestByScale = null;
  const matchLen = tiles.length;
  const focusTileId =
    options.focusTileId ??
    options.newestId ??
    (tiles.length ? tiles[tiles.length - 1].id : null);
  // Ease soft from inset toward hard (never past) while searching — early
  // turns first, then use the full felt if packing needs it.
  const largeBase = Math.min(baseW, baseH) >= BOARD_BASE_SHORT_MAX_PX;
  // Reach hard bounds quickly so long chains can use the full green table.
  const softEaseStep = crampedViewport || largeBase || matchLen > 14 ? 0.14 : 0.08;
  let softEaseEpoch = 0;
  let unitScaleAtEpoch = unitScale;

  const preferFullSize = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    // Never prefer an overflowing (off-felt) layout over an on-felt one.
    if (!!a.camera?.overflow !== !!b.camera?.overflow) {
      return a.camera?.overflow ? b : a;
    }
    if (b.scale > a.scale + 0.01) return b;
    if (a.scale > b.scale + 0.01) return a;
    return a;
  };

  const attemptLimit =
    matchLen >= 80
      ? 240
      : crampedViewport || largeBase
        ? matchLen > 22
          ? 200
          : 160
        : matchLen > 22
          ? 170
          : matchLen > 14
            ? 130
            : 90;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    if (Math.abs(unitScale - unitScaleAtEpoch) > 0.0005) {
      softEaseEpoch = attempt;
      unitScaleAtEpoch = unitScale;
    }
    const size = { w: baseW * unitScale, h: baseH * unitScale };
    const gap = effectiveGap(size.w, size.h, requestedGap);
    const easeAttempt = Math.max(0, attempt - softEaseEpoch);
    // t=0 → inset soft (turn early); t=1 → hard playable table (full felt).
    const easeT = Math.min(1, easeAttempt * softEaseStep);
    const bounds = {
      minX: (-softW0 / 2) * (1 - easeT) + hardLocal.minX * easeT,
      maxX: (softW0 / 2) * (1 - easeT) + hardLocal.maxX * easeT,
      minY: (-softH0 / 2) * (1 - easeT) + hardLocal.minY * easeT,
      maxY: (softH0 / 2) * (1 - easeT) + hardLocal.maxY * easeT,
    };

    // Prefer dual-tile bridges when height allows; on short felts / long
    // chains use single-tile bridges so the snake stays inside hard bounds
    // without shrinking tiles.
    const longSide = Math.max(baseW, baseH) * unitScale;
    const heightTight = playH0 < longSide * 4.2 || matchLen * longSide > playH0 * 3.2;
    // When the felt is short, ONLY single-tile bridges — dual bridges blow
    // the hard top/bottom before a full double-six chain can pack.
    const bridgeTarget = heightTight
      ? 1
      : matchLen <= 22
        ? attempt % 3 === 2
          ? 1
          : BRIDGE_LEN
        : attempt < 56
          ? BRIDGE_LEN
          : attempt % 2 === 0
            ? BRIDGE_LEN
            : 1;
    // Locked snake elbows: right arm folds DOWN, left arm folds UP.
    // Only after many failed canonical attempts may we invert as emergency.
    const invertFolds = attempt >= 72;
    const foldRight = invertFolds ? FIRST_FOLD_LEFT : FIRST_FOLD_RIGHT;
    const foldLeft = invertFolds ? FIRST_FOLD_RIGHT : FIRST_FOLD_LEFT;
    const swapArms = attempt >= 24 && Math.floor(attempt / 2) % 2 === 1;

    const { map, ok } = placeGraph(
      tiles,
      centerIndex,
      size,
      gap,
      bounds,
      bridgeTarget,
      foldRight,
      foldLeft,
      swapArms,
      hardLocal
    );
    if (ok && map.size === tiles.length) {
      const list = tiles.map((t) => map.get(t.id)).filter(Boolean);
      if (
        list.length === tiles.length &&
        chainCollisionFree(list, gap, tiles) &&
        list.every((p) => fitsSoft(p, hardLocal))
      ) {
        const screen = toScreen(
          list,
          { width, height },
          options.padding ?? PADDING,
          tiles[centerIndex].id,
          margin,
          hudRight,
          focusTileId
        );
        const tileSpan = Math.max(screen.tiles[0]?.w || 0, screen.tiles[0]?.h || 0);
        const safeFloor =
          tileSpan >= 20
            ? MIN_SAFE_GAP_PX
            : Math.min(MIN_SAFE_GAP_PX, tileSpan * 0.05);
        const screenGap = Math.max(safeFloor, Math.min(2, gap * screen.scale));
        const screenPlacements = screen.tiles.map((t) => ({
          id: t.tileId,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          double: t.double,
          isCorner: t.isCorner,
          isBridge: t.isBridge,
        }));
        // HARD REQUIREMENT: every tile AABB must stay inside playable green.
        // Do not accept camera-overflow layouts.
        const onFelt =
          !screen.camera?.overflow &&
          screenTilesInsidePlay(screen.tiles, play, 0.75);
        let screenClear = onFelt;
        for (let i = 0; i < screenPlacements.length && screenClear; i += 1) {
          for (let j = i + 1; j < screenPlacements.length; j += 1) {
            if (overlaps(screenPlacements[i], screenPlacements[j])) {
              screenClear = false;
              break;
            }
          }
        }
        if (screenClear && onFelt) {
          const bridges = measureVerticalBridges(list);
          const dualCount = bridges.filter((n) => n >= BRIDGE_LEN).length;
          const mostlyDual =
            bridges.length === 0 ||
            dualCount >= Math.ceil(bridges.length * 0.5);
          const candidate = {
            ...screen,
            scale: unitScale * screen.scale,
            gap: screenGap,
          };
          const axisOk = screenAxisOk(screenPlacements, tiles, screenGap);
          if (axisOk) {
            bestByScale = preferFullSize(bestByScale, candidate);
          }
          if (axisOk && mostlyDual) {
            result = preferFullSize(result, candidate);
            if (candidate.scale >= MIN_BOARD_SCALE - 0.001 && !candidate.camera?.overflow) {
              break;
            }
            if (candidate.scale >= 0.97 && !candidate.camera?.overflow) break;
          }
          if (axisOk && (bridges.length === 0 || dualCount >= 1)) {
            looseFallback = preferFullSize(looseFallback, candidate);
          }
          if (axisOk) fallback = preferFullSize(fallback, candidate);
          {
            const essentialGap = Math.min(2, gap * screen.scale);
            const essentialOk = screenAxisOk(
              screenPlacements,
              tiles,
              essentialGap,
              essentialCollisionBox
            );
            if (essentialOk) {
              essentialFallback = preferFullSize(essentialFallback, candidate);
            }
          }
        }
      }
    }

    // Scale policy: keep tiles at/above MIN_BOARD_SCALE. Early turns inside
    // hard felt first. Shrink is last resort for hard layout failure only.
    const playW = play.maxX - play.minX;
    const playH = play.maxY - play.minY;
    const noLayoutYet =
      !bestByScale &&
      !result &&
      !looseFallback &&
      !fallback &&
      !essentialFallback;
    const tileSpan = Math.min(baseW, baseH);
    const overcrowded =
      matchLen * tileSpan > (playW + playH) * 1.75 || matchLen >= 200;
    const cramped = overcrowded || crampedViewport || playW < 260 || playH < 240;
    const softEaseExhausted =
      easeAttempt >= (crampedViewport || matchLen > 26 ? 22 : 18);
    const needEmergencyFit = noLayoutYet && (cramped || softEaseExhausted);
    const bestEffective = preferFullSize(
      preferFullSize(preferFullSize(result, looseFallback), bestByScale),
      preferFullSize(fallback, essentialFallback)
    );
    // Accept any on-felt layout at/above the board floor as readable.
    const hasReadable =
      bestEffective != null &&
      !bestEffective.camera?.overflow &&
      bestEffective.scale >= MIN_BOARD_SCALE - 0.001;
    const shrinkFloor =
      matchLen <= 28 ? MIN_BOARD_SCALE : EMERGENCY_MIN_SCALE;
    const shrinkEvery = needEmergencyFit
      ? matchLen >= 80
        ? 3
        : 6
      : matchLen >= 80
        ? 4
        : matchLen >= 28
          ? 10
          : 14;
    if (result && hasReadable && attempt >= 36) break;
    // HARD LAYOUT FAILURE path: only when still empty after soft ease, allow
    // scale below MIN_BOARD_SCALE (documented emergency). Real matches (≤28)
    // stay on the floor unless literally no on-felt placement exists.
    // Prefer exhausting on-felt packing at the current scale before shrinking.
    // After a scale drop, soft-ease resets — allow shrink once we've re-eased
    // OR spent enough attempts at this scale so tiny felts never fail closed.
    const easedOrPatient = easeT >= 0.999 || easeAttempt >= 10;
    const allowShrink =
      noLayoutYet &&
      easedOrPatient &&
      (needEmergencyFit ||
        (crampedViewport && attempt >= 36) ||
        (matchLen > 22 && attempt >= 28) ||
        attempt >= 40);
    if (attempt % shrinkEvery === shrinkEvery - 1) {
      if (allowShrink && unitScale > shrinkFloor + 0.001) {
        const step =
          needEmergencyFit || crampedViewport || matchLen >= 80 ? 0.85 : 0.94;
        unitScale = Math.max(shrinkFloor, unitScale * step);
      } else if (
        allowShrink &&
        noLayoutYet &&
        matchLen <= 28 &&
        unitScale <= MIN_BOARD_SCALE + 0.001 &&
        attempt >= (crampedViewport || largeBase ? 28 : 50)
      ) {
        // Hard layout failure: no collision-free serpentine at MIN_BOARD_SCALE
        // on this viewport/tile base. Drop toward EMERGENCY_MIN_SCALE so the
        // board never fails closed (empty). Documented exception to the floor.
        const drop = crampedViewport || largeBase ? 0.78 : 0.85;
        unitScale = Math.max(EMERGENCY_MIN_SCALE, unitScale * drop);
      } else if (
        allowShrink &&
        noLayoutYet &&
        matchLen > 28 &&
        unitScale > EMERGENCY_MIN_SCALE + 0.001
      ) {
        // Pathological long chains: keep dropping until a pack appears.
        unitScale = Math.max(EMERGENCY_MIN_SCALE, unitScale * 0.75);
      } else if (
        noLayoutYet &&
        attempt > attemptLimit - 12 &&
        unitScale <= EMERGENCY_MIN_SCALE + 0.001
      ) {
        break;
      }
    }
  }

  // Final pick: largest readable on-felt scale (overflow layouts discarded).
  let picked = result;
  if (matchLen <= 28) {
    if (looseFallback && (!picked || looseFallback.scale > picked.scale * 1.05)) {
      picked = preferFullSize(picked, looseFallback);
    }
    if (bestByScale && (!picked || bestByScale.scale > picked.scale * 1.02)) {
      picked = preferFullSize(picked, bestByScale);
    }
    if (!picked) picked = fallback;
    if (!picked) picked = essentialFallback;
  } else {
    if (picked && looseFallback && looseFallback.scale > picked.scale * 1.1) {
      picked = looseFallback;
    }
    if (!picked) picked = bestByScale;
    if (!picked) picked = looseFallback;
    if (!picked) picked = fallback;
    if (!picked) picked = essentialFallback;
  }
  result = picked;

  if (!result) {
    const mid = playMid(play);
    return {
      tiles: [],
      scale: unitScale,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: mid.x, y: mid.y },
      gap: requestedGap,
      camera: {
        recentered: false,
        overflow: false,
        focusMode: "empty",
        x: mid.x,
        y: mid.y,
      },
    };
  }

  return result;
}

/* ---------- Compatibility shims for legacy layoutBoard callers ---------- */

/**
 * Resolve a moderate unscaled board tile base from the CSS probe size and
 * the current felt. Prefer the renderer hand×factor measurement, then cap
 * to a fraction of the playable area so desktop rem scaling cannot recreate
 * the oversized (~134×254) Plan B/C base.
 *
 * @param {Viewport} viewport - Board stage size in CSS px
 * @param {{ w: number, h: number }} measured - Probe tile at scale 1
 * @returns {{ w: number, h: number }}
 */
export function resolveBoardTileBase(viewport, measured) {
  const mw = Math.max(1, Number(measured?.w) || 40);
  const mh = Math.max(1, Number(measured?.h) || mw * TILE_ASPECT);
  const ratio = mh / mw;
  const cssShort = Math.min(mw, mh);
  const vw = Math.max(120, Number(viewport?.width) || 640);
  const vh = Math.max(120, Number(viewport?.height) || 320);
  // ~12–14 short sides across width, or ~6–7 longs across height.
  const fromVp = Math.min(vw / 14, vh / 6.5);
  const short = Math.min(
    BOARD_BASE_SHORT_MAX_PX,
    Math.max(BOARD_BASE_SHORT_MIN_PX, Math.min(cssShort, fromVp))
  );
  return { w: short, h: short * ratio };
}

/**
 * @param {Viewport} viewport
 * @param {number} [margin]
 * @param {number|null} [hudRightOverride] - Real measured HUD footprint (px)
 *   from BoardContainer's `hudReserve` prop — the scoreboard/reserve chrome
 *   pinned over the felt's top-right/bottom-right corners already include
 *   their own permanent safety gap (see GamePage's HUD measurement effect).
 *   When omitted (e.g. every existing test/caller), falls back to the
 *   original width-based estimate below so behavior is unchanged.
 */
export function computePlayBounds(viewport, margin = MARGIN, hudRightOverride = null) {
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const estimate =
    width < 500
      ? Math.min(52, Math.max(32, width * 0.12))
      : Math.min(112, Math.max(56, width * 0.16));
  // Never let an oversized measured HUD footprint collapse the playable
  // width below a sane floor — routing still needs room for early turns.
  // Empirically, usable widths under ~200px on phone felt (with a mid-game
  // 12-tile chain + real HUD) make placement search fail closed. Keep ≥220px.
  const MIN_PLAYABLE_WIDTH = 220;
  const maxHudRight = Math.max(estimate, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  // Prefer the live measured HUD carve-out when supplied — do NOT inflate it
  // up to the width-based estimate (that falsely shrinks the green table).
  const hudRight =
    hudRightOverride != null && Number.isFinite(hudRightOverride)
      ? Math.min(Math.max(0, hudRightOverride), maxHudRight)
      : estimate;
  return {
    minX: margin,
    minY: margin,
    maxX: width - margin - hudRight,
    maxY: height - margin,
    width,
    height,
    hudRight,
  };
}

export function computeLayoutMetrics(viewport, tileSize, margin, tileCount = 0) {
  const short = Math.max(1, tileSize.w);
  const long = Math.max(short + 1, tileSize.h);
  const bounds = computePlayBounds(viewport, margin);
  const usableW = Math.max(1, bounds.maxX - bounds.minX);
  const step = long + CHAIN_GAP;
  const maxRun = Math.max(3, Math.floor(usableW / step) - 1);
  void tileCount;
  return {
    short,
    long,
    chainGap: CHAIN_GAP,
    rowClear: Math.max(short * 0.55, 2 * long + 2 * CHAIN_GAP - short),
    maxRun,
    usableW,
    usableH: Math.max(1, bounds.maxY - bounds.minY),
    laneExtraFor: () => 0,
    bridgeLen: BRIDGE_LEN,
  };
}

/**
 * Planned scale hint for callers. Never recommend below MIN_BOARD_SCALE for
 * normal match lengths — the serpentine must fold inside the playable felt
 * rather than pre-shrinking to a theoretical full-chain bbox.
 */
export function computeStableFitScale(viewport, tileSize, margin, tileCount) {
  const planned = Math.max(tileCount, 28);
  const metrics = computeLayoutMetrics(viewport, tileSize, margin, planned);
  const step = metrics.long + CHAIN_GAP;
  const tilesPerRow = Math.max(
    3,
    Math.min(RUN_CEILING, Math.floor(metrics.usableW / 2 / step) - 1)
  );
  const perArm = Math.ceil(planned / 2);
  const folds = Math.max(0, Math.ceil(perArm / tilesPerRow) - 1);
  const bridgeH =
    BRIDGE_LEN * metrics.long + (BRIDGE_LEN + 1) * CHAIN_GAP + metrics.short * 0.25;
  const contentH = (folds + 1) * metrics.short + folds * bridgeH;
  const contentW = tilesPerRow * step + metrics.short * 0.5 + PADDING;
  const sx = metrics.usableW / Math.max(1, contentW);
  const sy = metrics.usableH / Math.max(1, contentH);
  const raw = Math.min(1, Math.min(sx, sy));
  if (planned <= 28) return Math.max(MIN_BOARD_SCALE, raw);
  return Math.max(EMERGENCY_MIN_SCALE, raw);
}

export function measureMinRowClearance(placements) {
  let minClear = Infinity;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (!(a.w >= a.h - 0.5 && b.w >= b.h - 0.5)) continue;
      const xOverlap = a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1;
      if (!xOverlap) continue;
      const clear = a.y >= b.y ? a.y - (b.y + b.h) : b.y - (a.y + a.h);
      if (clear >= 0) minClear = Math.min(minClear, clear);
    }
  }
  return minClear === Infinity ? null : minClear;
}

export function countTurns(placements) {
  let turns = 0;
  for (let i = 1; i < placements.length; i += 1) {
    const a = placements[i - 1].travelDir;
    const b = placements[i].travelDir;
    if (a && b && a !== b) turns += 1;
  }
  return turns;
}

export function measureVerticalBridges(placements) {
  const lengths = [];
  let run = 0;
  for (const p of placements) {
    const d = p.travelDir;
    if (d === "N" || d === "S") run += 1;
    else if (run > 0) {
      lengths.push(run);
      run = 0;
    }
  }
  if (run > 0) lengths.push(run);
  return lengths;
}

/**
 * Legacy-compatible layoutBoard — wraps calculateBoardLayout.
 */
export function layoutBoard(tiles, centerIndex, viewport, tileSize, options = {}) {
  if (!tiles?.length || centerIndex < 0 || centerIndex >= tiles.length) {
    return {
      placements: [],
      scale: 1,
      tileScale: 1,
      content: { width: 0, height: 0 },
      center: { x: 0, y: 0 },
      metrics: null,
      debug: { boxes: [], path: [], turnPoints: [] },
      gap: CHAIN_GAP,
    };
  }

  const result = calculateBoardLayout(tiles, viewport, {
    ...options,
    centerIndex,
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
  });

  const placements = result.tiles.map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    rotation: t.rotation ?? rotationForOrientation(t.orientation),
    travelDir: t.travelDir,
    branch: t.branch,
    double: t.double,
    isCorner: t.isCorner,
    isBridge: t.isBridge,
  }));

  return {
    placements,
    scale: 1,
    tileScale: result.scale,
    content: result.content ?? {
      width: viewport.width,
      height: viewport.height,
    },
    center: result.origin,
    camera: result.camera ?? null,
    metrics: computeLayoutMetrics(viewport, tileSize, options.margin ?? MARGIN, tiles.length),
    debug: {
      boxes: placements.map((p, index) => {
        const col = collisionBox(p);
        return {
          index,
          id: p.id,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          cx: p.x + p.w / 2,
          cy: p.y + p.h / 2,
          rotation: p.rotation,
          travelDir: p.travelDir,
          branch: p.branch,
          double: !!p.double,
          collision: { x: col.x, y: col.y, w: col.w, h: col.h },
        };
      }),
      path: placements.map((p) => ({
        id: p.id,
        x: p.x + p.w / 2,
        y: p.y + p.h / 2,
      })),
      turnPoints: placements
        .map((p, index, arr) => {
          if (index === 0) return null;
          const a = arr[index - 1];
          if (!a.travelDir || !p.travelDir || a.travelDir === p.travelDir) return null;
          return {
            index,
            id: p.id,
            x: p.x + p.w / 2,
            y: p.y + p.h / 2,
            from: a.travelDir,
            to: p.travelDir,
          };
        })
        .filter(Boolean),
    },
    gap: result.gap,
  };
}

/** @deprecated Prefer layoutBoard / calculateBoardLayout */
export function layoutSnakeFromCenter(
  tiles,
  centerIndex,
  maxWidth,
  sizes,
  gap = CHAIN_GAP,
  maxHeight = 400,
  options = {}
) {
  const result = layoutBoard(
    tiles,
    centerIndex,
    { width: maxWidth, height: maxHeight },
    sizes,
    { ...options, gap }
  );
  return { positions: result.placements, zoom: result.tileScale };
}

export function layoutHeight() {
  return 0;
}

export function layoutWidth() {
  return 0;
}
