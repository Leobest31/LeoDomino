/**
 * DominoLayoutEngine — logical board layout, then fit-to-felt.
 *
 * Pipeline (same game state → same layout):
 *   1. Place every played tile in logical coordinates (opener center = 0,0)
 *      including American spinner N/S branches in that same space.
 *   2. Measure the full AABB of rotated footprints (not centers only).
 *   3. Auto-fit: one uniform scale for the whole board
 *        fitScale = min(preferred, safeW / chainW, safeH / chainH)
 *   4. Translate so chain bbox center = safe-felt center.
 *
 * Routing (snake) still turns before the table edge so the pack stays compact.
 * Scale is applied after the complete chain exists — never by dropping tiles
 * or shrinking individual bones. Fail-closed empty placements are forbidden.
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
/** Extra inset inside the playable felt so bones stay off the gold border. */
export const SAFE_FELT_INSET = 8;
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
 * Readable short-side floor (px) at locked base × MIN_BOARD_SCALE.
 * Preferred for mid-match (≤21). Snap may land ~0.5px under this.
 */
export const MIN_READABLE_TILE_SHORT_PX =
  LOCKED_BOARD_TILE_SHORT_PX * MIN_BOARD_SCALE;
/**
 * Hard scale floor for a full double-six chain (≤28). Spinner-tall rows need
 * ~4 lanes on mid tablets/portrait — slightly below MIN_BOARD_SCALE is
 * required, but never the old emergency strip scales (~0.4).
 */
export const MIN_MATCH_SCALE = 0.62;
export const MIN_MATCH_TILE_SHORT_PX =
  LOCKED_BOARD_TILE_SHORT_PX * MIN_MATCH_SCALE;
/**
 * Extra collision halo around spinner (double) boxes — not added to face gap.
 * Sized for the locked ~72×136 footprint (was tuned on smaller tiles).
 */
export const SPINNER_RESERVE = 3;
/** Extra collision halo around turn/corner tiles (direction changes). */
export const CORNER_RESERVE = 3;
/** Extra collision halo around vertical-bridge tiles (keeps branches apart). */
export const BRIDGE_RESERVE = 2;
/** Hard floor for the final on-screen gap — never allowed to shrink toward 0. */
export const MIN_SAFE_GAP_PX = 0.6;

const EMERGENCY_MIN_SCALE = 0.05;
/** Extra clearance so half-pixel snap after screen mapping cannot collapse the gap. */
const SNAP_CLEARANCE = 0.5;
const OPP = Object.freeze({ E: "W", W: "E", N: "S", S: "N" });
const RESERVE_PREFIX = "__spin-";

function isReserveId(id) {
  return typeof id === "string" && id.startsWith(RESERVE_PREFIX);
}

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
  hard = soft,
  /** Unscaled (or floor-scale) size used only for run-length topology. */
  packSize = null,
  /**
   * Prefer shorter later rails so the snake fills vertical room instead of
   * one/two wide center rows. When set, overrides the default targetRun.
   */
  targetRunOverride = null,
  force = false
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
        // Topology is SCALE-INVARIANT: pack from unscaled packSize so shrink
        // cannot unlock longer rails mid-search (that was the ~19–21 cliff).
        const pack = packSize ?? size;
        const packH = Math.max(
          1,
          (hard?.maxY ?? soft.maxY) - (hard?.minY ?? soft.minY)
        );
        const packW = Math.max(
          1,
          (hard?.maxX ?? soft.maxX) - (hard?.minX ?? soft.minX)
        );
        const tallFelt = packH > packW * 0.85;
        const long = Math.max(pack.w, pack.h);
        const short = Math.min(pack.w, pack.h);
        const railStep = long + gap + short * 0.35;
        // Prefer turning before the far edge so unused height is claimed.
        const spaceDrivenRun = Math.max(
          2,
          Math.floor(packW / railStep) - (tallFelt ? 0 : 1)
        );
        const compact = packW < 560;
        const defaultRun = tallFelt
          ? TURN_EVERY + 1
          : compact
            ? TURN_EVERY + 1
            : packW < 820
              ? 5
              : 6;
        const targetRun =
          targetRunOverride != null
            ? Math.max(2, targetRunOverride)
            : defaultRun;
        const runCap =
          targetRunOverride != null && targetRunOverride > RUN_CEILING
            ? targetRunOverride
            : RUN_CEILING;
        const maxRun = Math.max(
          2,
          Math.min(runCap, targetRun, spaceDrivenRun)
        );
        const nearLimit = run >= maxRun - 1;
        const effectiveMaxRun =
          nearLimit && hasDoubleAhead(tiles, i, step, DOUBLE_LOOKAHEAD)
            ? maxRun + DOUBLE_LOOKAHEAD
            : maxRun;
        // Prefer a turn once the run is long enough. Probe with expandSoft so
        // early soft insets do not block the fold and leave a horizontal strip.
        // If no turn fits yet, keep going straight until bounds force a bend.
        if (run >= effectiveMaxRun) {
          const turnDirs = [foldDir, OPP[foldDir], OPP[lastH], lastH];
          const canTurn = turnDirs.some(
            (d) =>
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
              )
          );
          if (canTurn) wantTurn = true;
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

    // Forced turn could not place — continue straight rather than fail the arm.
    if (!chosen && wantTurn) {
      chosen = attempt(dir);
      if (chosen) chosenDir = dir;
    }

    if (!chosen && force) {
      const open = [...out.values()];
      for (const d of [dir, foldDir, OPP[foldDir], OPP[dir], "E", "W", "N", "S"]) {
        if (!isLegalStep(prev, tile, d, size)) continue;
        const box = placeAgainst(prev, tile, d, size, gap, dir);
        box.isCorner = d !== dir;
        box.isBridge = d === "N" || d === "S";
        if (!findCollision(box, open, gap, prev.id)) {
          chosen = box;
          chosenDir = d;
          break;
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

/** Playable felt minus inner padding (margin from the gold/table border). */
export function computeSafeFeltBounds(play, inset = SAFE_FELT_INSET) {
  const pad = Math.max(0, Number(inset) || 0);
  const width = play.maxX - play.minX;
  const height = play.maxY - play.minY;
  const padX = Math.min(pad, Math.max(0, (width - 48) / 2));
  const padY = Math.min(pad, Math.max(0, (height - 48) / 2));
  return {
    minX: play.minX + padX,
    maxX: play.maxX - padX,
    minY: play.minY + padY,
    maxY: play.maxY - padY,
  };
}

/** AABB of rotated tile footprints (not centers). */
export function computeChainBounds(placements) {
  if (!placements?.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  const bb = bboxOf(placements);
  return {
    ...bb,
    width: Math.max(0, bb.maxX - bb.minX),
    height: Math.max(0, bb.maxY - bb.minY),
    cx: (bb.minX + bb.maxX) / 2,
    cy: (bb.minY + bb.maxY) / 2,
  };
}

/**
 * Uniform board scale. Never upscales past preferred. Only shrinks when the
 * complete chain AABB no longer fits in the safe felt.
 */
export function computeFitScale(chainBounds, safeBounds, preferredScale = 1) {
  const chainW = Math.max(1, chainBounds.width ?? chainBounds.maxX - chainBounds.minX);
  const chainH = Math.max(1, chainBounds.height ?? chainBounds.maxY - chainBounds.minY);
  const safeW = Math.max(1, safeBounds.maxX - safeBounds.minX);
  const safeH = Math.max(1, safeBounds.maxY - safeBounds.minY);
  const preferred = Math.max(
    EMERGENCY_MIN_SCALE,
    Number.isFinite(preferredScale) ? preferredScale : 1
  );
  return Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(preferred, safeW / chainW, safeH / chainH)
  );
}

function spinnerLaneOccupants(spinner, northCount, southCount, size, gap) {
  if (!spinner || (northCount <= 0 && southCount <= 0)) return [];
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  const x = spinner.x + (spinner.w - short) / 2;
  const out = [];
  for (let i = 0; i < northCount; i += 1) {
    out.push({
      id: `${RESERVE_PREFIX}n-${i}`,
      x,
      y: spinner.y - (i + 1) * (long + gap),
      w: short,
      h: long,
      double: false,
      isBridge: true,
      branch: "north",
    });
  }
  for (let i = 0; i < southCount; i += 1) {
    out.push({
      id: `${RESERVE_PREFIX}s-${i}`,
      x,
      y: spinner.y + spinner.h + gap + i * (long + gap),
      w: short,
      h: long,
      double: false,
      isBridge: true,
      branch: "south",
    });
  }
  return out;
}

function placeSpinnerBranch(map, spinner, tiles, dir, size, gap, hard, force) {
  const branch = dir === "N" ? "north" : "south";
  let prev = spinner;
  let fromDir = dir;
  for (const tile of tiles) {
    const occupied = [...map.values()];
    let box =
      tryPlace(prev, tile, dir, fromDir, size, gap, hard, occupied, hard) ||
      tryPlace(
        prev,
        tile,
        dir,
        fromDir,
        size,
        gap,
        expandSoft(hard, size, 2, null),
        occupied,
        force ? null : hard
      );
    if (!box && force) {
      const cand = placeAgainst(prev, tile, dir, size, gap, fromDir);
      cand.isCorner = false;
      cand.isBridge = true;
      if (!findCollision(cand, occupied, gap, prev.id)) box = cand;
    }
    if (!box) return false;
    const placed = {
      ...box,
      travelDir: dir,
      branch,
      isCorner: false,
      isBridge: true,
    };
    map.set(tile.id, placed);
    prev = placed;
    fromDir = dir;
  }
  return true;
}

function attachSpinnerBranches(map, spinnerId, northTiles, southTiles, size, gap, hard, force) {
  if (!spinnerId) return { ok: true, armIds: [] };
  const north = Array.isArray(northTiles) ? northTiles : [];
  const south = Array.isArray(southTiles) ? southTiles : [];
  if (!north.length && !south.length) return { ok: true, armIds: [] };
  const spinner = map.get(spinnerId);
  if (!spinner) return { ok: false, armIds: [] };
  if (north.length && !placeSpinnerBranch(map, spinner, north, "N", size, gap, hard, force)) {
    return { ok: false, armIds: [] };
  }
  if (south.length && !placeSpinnerBranch(map, spinner, south, "S", size, gap, hard, force)) {
    return { ok: false, armIds: [] };
  }
  return {
    ok: true,
    armIds: [...north, ...south].map((t) => t.id),
  };
}

function completeMissingTiles(map, tiles, centerIndex, size, gap) {
  const opener = tiles[centerIndex];
  if (!opener) return;
  if (!map.has(opener.id)) {
    const fp = footprintForTravel(opener, "E", size);
    map.set(opener.id, {
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
    });
  }
  const fill = (from, to, step, startDir, branch) => {
    let prev = map.get(tiles[centerIndex].id);
    let dir = startDir;
    for (let i = from; i !== to; i += step) {
      const tile = tiles[i];
      if (map.has(tile.id)) {
        prev = map.get(tile.id);
        dir = prev.travelDir || dir;
        continue;
      }
      const occupied = [...map.values()];
      let box = null;
      let chosenDir = dir;
      for (const d of [dir, "E", "W", "N", "S"]) {
        if (!isLegalStep(prev, tile, d, size)) continue;
        const cand = placeAgainst(prev, tile, d, size, gap, dir);
        if (!findCollision(cand, occupied, gap, prev.id)) {
          box = cand;
          chosenDir = d;
          break;
        }
      }
      if (!box) {
        box = placeAgainst(prev, tile, dir, size, gap, dir);
        chosenDir = dir;
      }
      const placed = {
        ...box,
        travelDir: chosenDir,
        branch,
        isCorner: chosenDir !== dir,
        isBridge: chosenDir === "N" || chosenDir === "S",
      };
      map.set(tile.id, placed);
      prev = placed;
      dir = chosenDir;
    }
  };
  fill(centerIndex + 1, tiles.length, 1, "E", "right");
  fill(centerIndex - 1, -1, -1, "W", "left");
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
  hard = soft,
  packSize = null,
  targetRunOverride = null,
  extraOccupied = [],
  force = false
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
    for (const extra of extraOccupied) {
      if (extra?.id) map.set(extra.id, extra);
    }
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
        hard,
        packSize,
        targetRunOverride,
        force
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
        hard,
        packSize,
        targetRunOverride,
        force
      );

    const first = swapArms ? growLeft() : growRight();
    if (!first) continue;
    const second = swapArms ? growRight() : growLeft();
    if (!second) continue;

    for (const id of [...map.keys()]) {
      if (isReserveId(id)) map.delete(id);
    }

    const list = [...map.values()];
    const insideHard = force || list.every((p) => fitsSoft(p, hard));
    if (
      map.size === tiles.length &&
      chainCollisionFree(list, gap, tiles) &&
      insideHard
    ) {
      return { map, ok: true };
    }
  }
  return { map: new Map([[opener.id, origin]]), ok: false };
}

/**
 * Map logical layout → screen: one uniform auto-fit scale, then bbox-center
 * onto the safe felt. Does not pin the opening tile.
 */
function toScreen(
  placements,
  viewport,
  padding = PADDING,
  openerId = null,
  margin = MARGIN,
  hudRight = null,
  focusTileId = null,
  hudLeft = null,
  maxScale = 1
) {
  void padding;
  void openerId;
  void focusTileId;
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const play = computePlayBounds({ width, height }, margin, hudRight, hudLeft);
  const safe = computeSafeFeltBounds(play);
  const midX = (safe.minX + safe.maxX) / 2;
  const midY = (safe.minY + safe.maxY) / 2;
  const preferred = Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(1, Number.isFinite(maxScale) ? maxScale : 1)
  );

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
      play,
      safe,
    };
  }

  const chain = computeChainBounds(placements);
  let scale = computeFitScale(chain, safe, preferred);
  const cx = chain.cx;
  const cy = chain.cy;

  const project = (s) =>
    placements.map((p, zIndex) => {
      const lx = p.x + p.w / 2;
      const ly = p.y + p.h / 2;
      const sx = (lx - cx) * s + midX;
      const sy = (ly - cy) * s + midY;
      const w = p.w * s;
      const h = p.h * s;
      return {
        tileId: p.id,
        valueLeft: p.valueLeft,
        valueRight: p.valueRight,
        x: sx - w / 2,
        y: sy - h / 2,
        w,
        h,
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

  let tiles = project(scale);
  if (!screenTilesInsidePlay(tiles, safe, 0.5) && scale > EMERGENCY_MIN_SCALE) {
    scale = Math.max(EMERGENCY_MIN_SCALE, scale * 0.985);
    tiles = project(scale);
  }
  const overflow = !screenTilesInsidePlay(tiles, safe, 0.75);

  return {
    tiles,
    scale,
    content: {
      width: chain.width,
      height: chain.height,
      minX: chain.minX,
      maxX: chain.maxX,
      minY: chain.minY,
      maxY: chain.maxY,
      cx,
      cy,
    },
    origin: { x: midX, y: midY },
    camera: {
      recentered: true,
      overflow,
      focusMode: "bbox",
      x: midX,
      y: midY,
      localFocus: { x: cx, y: cy },
    },
    play,
    safe,
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
  const hudLeftEarly = options.hudLeft ?? null;
  const playEarly = computePlayBounds(
    { width, height },
    marginEarly,
    hudRightEarly,
    hudLeftEarly
  );
  const midEarly = playMid(playEarly);

  if (!tiles.length) {
    return {
      tiles: [],
      armTiles: [],
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
  // Optional, measured-live reserve for HUD chrome: scoreboard (left) and
  // reserve counter (right). Falls back to the built-in right estimate in
  // computePlayBounds when not supplied, so existing callers/tests are
  // unaffected.
  const hudRight = hudRightEarly;
  const hudLeft = hudLeftEarly;
  const play = playEarly;

  const hardLocal = localHardBounds(play);
  const playW0 = Math.max(1, play.maxX - play.minX);
  const playH0 = Math.max(1, play.maxY - play.minY);
  const crampedViewport = playW0 < 400 || playH0 < 320;
  const tallPlay = playH0 > playW0 * 0.85;
  const matchLen = tiles.length;
  const size = { w: baseW, h: baseH };
  const gap = effectiveGap(size.w, size.h, requestedGap);
  const scaleCap = Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(1, options.maxScale != null ? Number(options.maxScale) : 1)
  );

  const northTiles = Array.isArray(options.spinnerNorth) ? options.spinnerNorth : [];
  const southTiles = Array.isArray(options.spinnerSouth) ? options.spinnerSouth : [];
  const northCount = Math.max(
    northTiles.length,
    Number(options.spinnerNorthCount) || 0
  );
  const southCount = Math.max(
    southTiles.length,
    Number(options.spinnerSouthCount) || 0
  );
  const spinnerId = typeof options.spinnerId === "string" ? options.spinnerId : null;
  const openerFp = footprintForTravel(tiles[centerIndex], "E", size);
  const originProbe = {
    id: tiles[centerIndex].id,
    x: snap(-openerFp.w / 2),
    y: snap(-openerFp.h / 2),
    w: snap(openerFp.w),
    h: snap(openerFp.h),
  };
  const extraOccupied =
    spinnerId && tiles[centerIndex].id === spinnerId
      ? spinnerLaneOccupants(originProbe, northCount, southCount, size, gap)
      : [];

  let result = null;
  let looseFallback = null;
  let fallback = null;
  let essentialFallback = null;
  let bestByScale = null;

  const preferFullSize = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    // Never prefer an overflowing (off-felt) layout over an on-felt one.
    if (!!a.camera?.overflow !== !!b.camera?.overflow) {
      return a.camera?.overflow ? b : a;
    }
    if (b.scale > a.scale + 0.01) return b;
    if (a.scale > b.scale + 0.01) return a;
    // Same scale: prefer the pack that actually uses table height (rejects
    // tiny horizontal strips that waste the felt while claiming "fit").
    const aUse = a.heightUse ?? 0;
    const bUse = b.heightUse ?? 0;
    if (bUse > aUse + 0.08) return b;
    if (aUse > bUse + 0.08) return a;
    const aTurns = a.turnCount ?? 0;
    const bTurns = b.turnCount ?? 0;
    if (bTurns > aTurns) return b;
    if (aTurns > bTurns) return a;
    return a;
  };

  const footprintStats = (placements) => {
    if (!placements.length) return { heightUse: 0, turnCount: 0, aspect: 99 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of placements) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    let turnCount = 0;
    for (let i = 1; i < placements.length - 1; i += 1) {
      const a = placements[i - 1];
      const b = placements[i];
      const c = placements[i + 1];
      const d1x = b.x + b.w / 2 - (a.x + a.w / 2);
      const d1y = b.y + b.h / 2 - (a.y + a.h / 2);
      const d2x = c.x + c.w / 2 - (b.x + b.w / 2);
      const d2y = c.y + c.h / 2 - (b.y + b.h / 2);
      const aH = Math.abs(d1x) > Math.abs(d1y);
      const bH = Math.abs(d2x) > Math.abs(d2y);
      if (aH !== bH) turnCount += 1;
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    return {
      heightUse: bh / playH0,
      turnCount,
      aspect: bw / bh,
    };
  };

  const packSize = { w: baseW, h: baseH };
  const matchFloor =
    matchLen <= 21 ? MIN_BOARD_SCALE : matchLen <= 28 ? MIN_MATCH_SCALE : EMERGENCY_MIN_SCALE;
  const safe0 = computeSafeFeltBounds(play);
  const safeW0 = Math.max(1, safe0.maxX - safe0.minX);
  const safeH0 = Math.max(1, safe0.maxY - safe0.minY);
  const floorMul =
    Math.min(safeW0 / playW0, safeH0 / playH0) / Math.max(0.2, matchFloor);
  const canvasMultipliers =
    matchLen > 200
      ? [4, 8, 16, 32]
      : matchLen > 80
        ? [1.5, 2.5, 4, 8, 16]
          : matchLen > 28
          ? [1, 1.25, 1.5, 2, 2.6, 3.5, 5, 8, 12]
          : [1, 1.06, 1.14, 1.22, 1.32, 1.45, floorMul, 1.7, 1.85, 2.2, 2.8];
  const variantsForCanvas = (canvasIndex) => {
    if (matchLen >= 80) return 28;
    if (canvasIndex === 0) {
      return matchLen >= 12 ? 72 : 36;
    }
    return matchLen >= 24 ? 28 : 20;
  };
  const refLong = Math.max(baseW, baseH);
  const heightTight =
    playH0 < refLong * (Math.min(baseW, baseH) >= 60 ? 3.5 : 2.8);
  const softInset = Math.min(10, PADDING);

  const projectPack = (map, force) => {
    const attached = attachSpinnerBranches(
      map,
      spinnerId,
      northTiles,
      southTiles,
      size,
      gap,
      {
        minX: -1e6,
        maxX: 1e6,
        minY: -1e6,
        maxY: 1e6,
      },
      force
    );
    if (!attached.ok && !force) return null;
    completeMissingTiles(map, tiles, centerIndex, size, gap);
    if ((!attached.ok || attached.armIds.length < northTiles.length + southTiles.length) && force) {
      attachSpinnerBranches(
        map,
        spinnerId,
        northTiles,
        southTiles,
        size,
        gap,
        { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
        true
      );
    }
    const armSet = new Set([
      ...northTiles.map((t) => t.id),
      ...southTiles.map((t) => t.id),
    ]);
    const mainList = tiles.map((t) => map.get(t.id)).filter(Boolean);
    if (mainList.length !== tiles.length) return null;
    const armList = [...armSet].map((id) => map.get(id)).filter(Boolean);
    const combined = [...mainList, ...armList];
    const linkTiles = [...tiles];
    if (spinnerId && northTiles[0]) {
      linkTiles.push({ id: spinnerId }, northTiles[0]);
      for (let i = 0; i < northTiles.length - 1; i += 1) {
        linkTiles.push(northTiles[i], northTiles[i + 1]);
      }
    }
    if (spinnerId && southTiles[0]) {
      linkTiles.push({ id: spinnerId }, southTiles[0]);
      for (let i = 0; i < southTiles.length - 1; i += 1) {
        linkTiles.push(southTiles[i], southTiles[i + 1]);
      }
    }
    if (!chainCollisionFree(combined, gap, linkTiles) && !force) return null;

    const screen = toScreen(
      combined,
      { width, height },
      options.padding ?? PADDING,
      tiles[centerIndex].id,
      margin,
      hudRight,
      null,
      hudLeft,
      scaleCap
    );
    const byId = new Map(screen.tiles.map((t) => [t.tileId, t]));
    const orderedMain = tiles.map((t) => byId.get(t.id)).filter(Boolean);
    if (orderedMain.length !== tiles.length) return null;
    const orderedArms = [...northTiles, ...southTiles]
      .map((t) => byId.get(t.id))
      .filter(Boolean);
    const screenPlacements = orderedMain.map((t) => ({
      id: t.tileId,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      double: t.double,
      isCorner: t.isCorner,
      isBridge: t.isBridge,
    }));
    let aabbClear = true;
    for (let i = 0; i < screen.tiles.length && aabbClear; i += 1) {
      for (let j = i + 1; j < screen.tiles.length; j += 1) {
        if (overlaps(screen.tiles[i], screen.tiles[j])) {
          aabbClear = false;
          break;
        }
      }
    }
    if (!aabbClear && !force) return null;
    const screenGap = Math.max(MIN_SAFE_GAP_PX, Math.min(2, gap * screen.scale));
    const stats = footprintStats(screenPlacements);
    return {
      ...screen,
      tiles: orderedMain,
      armTiles: orderedArms,
      scale: screen.scale,
      gap: screenGap,
      heightUse: stats.heightUse,
      turnCount: stats.turnCount,
      aspect: stats.aspect,
    };
  };

  for (let canvasIndex = 0; canvasIndex < canvasMultipliers.length; canvasIndex += 1) {
    const mul = canvasMultipliers[canvasIndex];
    const packHard = {
      minX: hardLocal.minX * mul,
      maxX: hardLocal.maxX * mul,
      minY: hardLocal.minY * mul,
      maxY: hardLocal.maxY * mul,
    };
    const packW0 = Math.max(1, packHard.maxX - packHard.minX);
    const packH0 = Math.max(1, packHard.maxY - packHard.minY);
    const softW0 = Math.max(120, packW0 - softInset);
    const softH0 = Math.max(100, packH0 - softInset);

    for (let attempt = 0; attempt < variantsForCanvas(canvasIndex); attempt += 1) {
      const easeT = Math.min(1, 0.55 + attempt * 0.08);
      const bounds = {
        minX: (-softW0 / 2) * (1 - easeT) + packHard.minX * easeT,
        maxX: (softW0 / 2) * (1 - easeT) + packHard.maxX * easeT,
        minY: (-softH0 / 2) * (1 - easeT) + packHard.minY * easeT,
        maxY: (softH0 / 2) * (1 - easeT) + packHard.maxY * easeT,
      };
      const bridgeTarget =
        heightTight || (crampedViewport && matchLen > 28)
          ? 1
          : matchLen >= 80
            ? 1
            : tallPlay || playW0 < 760
              ? attempt % 2 === 0
                ? BRIDGE_LEN
                : 1
              : attempt % 5 === 4
                ? 1
                : BRIDGE_LEN;
      const invertFolds = canvasIndex >= 2 && attempt >= 10;
      const foldRight = invertFolds ? FIRST_FOLD_LEFT : FIRST_FOLD_RIGHT;
      const foldLeft = invertFolds ? FIRST_FOLD_RIGHT : FIRST_FOLD_LEFT;
      const swapArms = canvasIndex >= 1 && attempt >= 12 && attempt % 2 === 1;
      const railCycle = attempt % 4;
      const targetRunOverride =
        matchLen > 200
          ? 8 + (attempt % 6)
          : matchLen >= 12
            ? railCycle === 0
              ? TURN_EVERY
              : railCycle === 1
                ? TURN_EVERY + 1
                : railCycle === 2
                  ? Math.max(2, TURN_EVERY - 1)
                  : TURN_EVERY + 2
            : null;

      const forcePack = canvasIndex >= 2 && attempt >= variantsForCanvas(canvasIndex) - 3;
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
        packHard,
        packSize,
        targetRunOverride,
        extraOccupied,
        forcePack
      );
      if (!ok || map.size !== tiles.length) continue;
      const candidate = projectPack(map, false);
      if (!candidate) continue;

      const onFelt = !candidate.camera?.overflow;
      const axisOk = screenAxisOk(
        candidate.tiles.map((t) => ({
          id: t.tileId,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          double: t.double,
          isCorner: t.isCorner,
          isBridge: t.isBridge,
        })),
        tiles,
        candidate.gap
      );
      const stripLike =
        matchLen >= 14 &&
        candidate.heightUse < 0.42 &&
        candidate.aspect > 3.2 &&
        candidate.turnCount < 2;

      if (onFelt) {
        if (axisOk && !stripLike) {
          bestByScale = preferFullSize(bestByScale, candidate);
        }
        if (axisOk && !stripLike) {
          result = preferFullSize(result, candidate);
        }
        if (axisOk) {
          looseFallback = preferFullSize(looseFallback, candidate);
          fallback = preferFullSize(fallback, candidate);
          essentialFallback = preferFullSize(essentialFallback, candidate);
        }
        const wellPacked =
          candidate.heightUse >= 0.55 || candidate.turnCount >= 2 || matchLen < 14;
        if (
          result &&
          !result.camera?.overflow &&
          result.scale >= Math.min(scaleCap, 0.97) &&
          wellPacked &&
          attempt >= 4
        ) {
          canvasIndex = canvasMultipliers.length;
          break;
        }
      } else if (axisOk) {
        essentialFallback = preferFullSize(essentialFallback, candidate);
      }
    }
    const goodEnough =
      matchLen <= 21 ? 0.97 : matchLen <= 28 ? matchFloor : 0.25;
    if (
      result &&
      !result.camera?.overflow &&
      result.scale >= Math.min(scaleCap, goodEnough) - 0.001
    ) {
      break;
    }
  }

  let picked = preferFullSize(
    preferFullSize(preferFullSize(result, looseFallback), bestByScale),
    preferFullSize(fallback, essentialFallback)
  );

  if (!picked) {
    const huge = {
      minX: hardLocal.minX * 32,
      maxX: hardLocal.maxX * 32,
      minY: hardLocal.minY * 32,
      maxY: hardLocal.maxY * 32,
    };
    let map = placeGraph(
      tiles,
      centerIndex,
      size,
      gap,
      huge,
      1,
      FIRST_FOLD_RIGHT,
      FIRST_FOLD_LEFT,
      false,
      huge,
      packSize,
      TURN_EVERY,
      extraOccupied,
      true
    ).map;
    completeMissingTiles(map, tiles, centerIndex, size, gap);
    picked = projectPack(map, true);
  }

  if (!picked || picked.tiles.length !== tiles.length) {
    const map = new Map();
    completeMissingTiles(map, tiles, centerIndex, size, gap);
    picked = projectPack(map, true);
  }

  if (!picked) {
    const map = new Map();
    completeMissingTiles(map, tiles, centerIndex, size, gap);
    const list = tiles.map((t) => map.get(t.id)).filter(Boolean);
    const screen = toScreen(
      list,
      { width, height },
      options.padding ?? PADDING,
      tiles[centerIndex].id,
      margin,
      hudRight,
      null,
      hudLeft,
      scaleCap
    );
    return {
      ...screen,
      tiles: screen.tiles,
      armTiles: [],
      gap,
    };
  }

  return picked;
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
 * @param {number|null} [hudRightOverride] - Measured right HUD footprint (px)
 *   from BoardContainer when a right-side HUD occupied the felt.
 *   Live GamePage keeps reserve outside the green table (hudRight = 0).
 * @param {number|null} [hudLeftOverride] - Optional measured left HUD
 *   footprint (px). Unused by the live GamePage (scoreboard is outside the
 *   green table); kept for layout engine tests / tooling.
 *   When omitted (e.g. every existing test/caller), falls back to the
 *   original width-based estimate below so behavior is unchanged.
 */
export function computePlayBounds(
  viewport,
  margin = MARGIN,
  hudRightOverride = null,
  hudLeftOverride = null
) {
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
  const maxHudSide = Math.max(estimate, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  // Prefer the live measured HUD carve-out when supplied — do NOT inflate it
  // up to the width-based estimate (that falsely shrinks the green table).
  // Default estimate stays on the right for backward-compatible callers/tests.
  const hudRight =
    hudRightOverride != null && Number.isFinite(hudRightOverride)
      ? Math.min(Math.max(0, hudRightOverride), maxHudSide)
      : estimate;
  const hudLeft =
    hudLeftOverride != null && Number.isFinite(hudLeftOverride)
      ? Math.min(Math.max(0, hudLeftOverride), maxHudSide)
      : 0;
  // Keep a usable playable width even if both sides report large footprints.
  const combined = hudLeft + hudRight;
  const maxCombined = Math.max(0, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  let left = hudLeft;
  let right = hudRight;
  if (combined > maxCombined && combined > 0) {
    const scale = maxCombined / combined;
    left *= scale;
    right *= scale;
  }
  return {
    minX: margin + left,
    minY: margin,
    maxX: width - margin - right,
    maxY: height - margin,
    width,
    height,
    hudRight: right,
    hudLeft: left,
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
 * Planned scale hint: preferred size unless a packed full-match AABB would
 * miss the safe felt. Same planned length (28) keeps this stable mid-match.
 */
export function computeStableFitScale(viewport, tileSize, margin, tileCount) {
  const planned = Math.max(tileCount, 28);
  const metrics = computeLayoutMetrics(viewport, tileSize, margin, planned);
  const play = computePlayBounds(viewport, margin);
  const safe = computeSafeFeltBounds(play);
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
  return computeFitScale(
    { width: contentW, height: contentH, minX: 0, minY: 0, maxX: contentW, maxY: contentH },
    safe,
    1
  );
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
      armPlacements: [],
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
  const armPlacements = (result.armTiles || []).map((t) => ({
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
    armPlacements,
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
