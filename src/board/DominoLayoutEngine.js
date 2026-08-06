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
 * Screen mapping: auto-scale + center into the viewport.
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
export const MIN_TILE_SCALE = 0.45;
export const MIN_SCALE = MIN_TILE_SCALE;
export const TURN_EVERY = 6;
/** Soft upper bound on a horizontal run before folding — a small bump over
 * TURN_EVERY so a wide table gets used a bit more before the first fold,
 * without destabilizing the dual-bridge rhythm the strict layout gate
 * looks for at deeper attempts. */
export const RUN_CEILING = TURN_EVERY + 2;
export const CHAIN_GAP_PX = CHAIN_GAP;
export const SEGMENT_TILES = TURN_EVERY;
export const SAFETY_MARGIN_PX = MARGIN;
export const MIN_BOARD_ZOOM = MIN_TILE_SCALE;
export const MAX_GLOBAL_ZOOM = MIN_TILE_SCALE;
/** Extra collision halo around spinner (double) boxes — not added to face gap. */
export const SPINNER_RESERVE = 3;
/** Extra collision halo around turn/corner tiles (direction changes). */
export const CORNER_RESERVE = 2.25;
/** Extra collision halo around vertical-bridge tiles (keeps branches apart). */
export const BRIDGE_RESERVE = 1.75;
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
 * Collision gate: fixed AABB (spinner halo included); non-neighbors need ≥ minClear.
 * Vertical branches vs horizontal rails are rejected on any AABB hit.
 */
function findCollision(box, occupied, gap, attachId = null, minClear = gap + SNAP_CLEARANCE) {
  // Local routing keeps its proven geometry (spinner halo only); the
  // corner/bridge reserve is enforced later as a stricter final-gate check
  // so it never makes the tuned serpentine routing infeasible.
  const probe = essentialCollisionBox(box);
  for (const other of occupied) {
    if (other.id === box.id) continue;
    const hull = essentialCollisionBox(other);
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

/** Temporarily widen soft bounds so a started vertical bridge can finish. */
function expandSoft(soft, size, bridges = BRIDGE_LEN) {
  const pad = Math.max(size.w, size.h) * bridges + CHAIN_GAP * 3;
  return {
    minX: soft.minX - pad,
    maxX: soft.maxX + pad,
    minY: soft.minY - pad,
    maxY: soft.maxY + pad,
  };
}

/**
 * Place `tile` against `prev` traveling `dir`.
 * Face gap is always `gap` (0–2 px). Spinner reserve is collision-only (see collisionBox).
 * Turns use edge geometry from the previous tile's fixed AABB — never visual guesses.
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

  const bridgeToRail =
    turning && prevVert && !prevDouble && ew && fp.orientation === "horizontal";

  if (!turning || prevDouble) {
    ({ x, y } = edge());
  } else if (bridgeToRail) {
    if (fromDir === "S" && dir === "E") {
      x = prev.x + prev.w + gap;
      y = prev.y + prev.h - fp.h;
    } else if (fromDir === "S" && dir === "W") {
      x = prev.x - gap - fp.w;
      y = prev.y + prev.h - fp.h;
    } else if (fromDir === "N" && dir === "E") {
      x = prev.x + prev.w + gap;
      y = prev.y;
    } else if (fromDir === "N" && dir === "W") {
      x = prev.x - gap - fp.w;
      y = prev.y;
    } else {
      ({ x, y } = edge());
    }
  } else if (fromDir === "E" && dir === "S") {
    x = prev.x + prev.w - fp.w;
    y = prev.y + prev.h + gap;
  } else if (fromDir === "E" && dir === "N") {
    x = prev.x + prev.w - fp.w;
    y = prev.y - gap - fp.h;
  } else if (fromDir === "W" && dir === "S") {
    x = prev.x;
    y = prev.y + prev.h + gap;
  } else if (fromDir === "W" && dir === "N") {
    x = prev.x;
    y = prev.y - gap - fp.h;
  } else if (fromDir === "S" && dir === "E") {
    x = prev.x + prev.w + gap;
    y = prev.y + prev.h - fp.h;
  } else if (fromDir === "S" && dir === "W") {
    x = prev.x - gap - fp.w;
    y = prev.y + prev.h - fp.h;
  } else if (fromDir === "N" && dir === "E") {
    x = prev.x + prev.w + gap;
    y = prev.y;
  } else if (fromDir === "N" && dir === "W") {
    x = prev.x - gap - fp.w;
    y = prev.y;
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

function tryPlace(prev, tile, dir, fromDir, size, gap, soft, occupied) {
  if (!isLegalStep(prev, tile, dir, size)) return null;
  const box = placeAgainst(prev, tile, dir, size, gap, fromDir);
  if (!fitsSoft(box, soft)) return null;
  if (findCollision(box, occupied, gap, prev.id)) return null;
  return box;
}

/**
 * Grow one arm as a margin-driven serpentine ribbon.
 * Horizontal: never turn early — only at soft bound / collision.
 * Vertical: short bridge then reverse (professional snake).
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
  bridgeTarget
) {
  let prev = start;
  let dir = startDir;
  let lastH = startDir === "E" || startDir === "W" ? startDir : "E";
  let vertRun = 0;
  let exitAfterPivot = false;
  let run = 0;

  for (let i = from; i !== to; i += step) {
    const tile = tiles[i];
    const occupied = [...out.values()];
    const onVertical = dir === "N" || dir === "S";
    const tileIsDouble = isDouble(tile);

    const attempt = (d) => tryPlace(prev, tile, d, dir, size, gap, soft, occupied);

    let wantTurn = exitAfterPivot;
    if (!wantTurn) {
      const straight = attempt(dir);
      if (!straight) {
        wantTurn = true;
      } else if (onVertical && vertRun >= Math.max(1, bridgeTarget)) {
        if ([OPP[lastH], lastH, foldDir, OPP[foldDir]].some((d) => attempt(d))) {
          wantTurn = true;
        }
      } else if (!onVertical) {
        // Soft horizontal run limit derived from soft bounds (never arbitrary mid-rail,
        // never clamped below what the table actually has room for — a fixed small cap
        // here is what left large stretches of a wide table unused).
        const long = Math.max(size.w, size.h);
        const spaceDrivenRun = Math.floor((soft.maxX - soft.minX) / 2 / (long + gap)) - 1;
        const maxRun = Math.max(3, Math.min(RUN_CEILING, spaceDrivenRun));
        // Doubles are the natural pivot points in a hand-played game — if one
        // falls within reach just past the run limit, keep going a little
        // further so the fold lands on it instead of on an arbitrary tile.
        // Purely content-driven (deck order), so this stays deterministic.
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

    // Prefer finishing bridgeTarget vertical tiles; soft overflow allowed.
    // If the bridge cannot continue, fall through to a normal turn.
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
          expandSoft(soft, size, bridgeTarget),
          occupied
        );
      if (chosen) chosenDir = dir;
    } else if (!wantTurn) {
      chosen = attempt(dir);
      chosenDir = dir;
    }

    if (!chosen) {
      const primary = onVertical
        ? [OPP[lastH], lastH, foldDir, OPP[foldDir], dir]
        : [foldDir, OPP[foldDir], OPP[lastH], lastH, dir];
      const seen = new Set();
      for (const d of primary) {
        if (seen.has(d)) continue;
        seen.add(d);
        const box = attempt(d);
        if (box) {
          chosen = box;
          chosenDir = d;
          break;
        }
      }
      if (!chosen) {
        for (const d of ["E", "W", "N", "S"]) {
          if (seen.has(d)) continue;
          const box = attempt(d);
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

function placeGraph(tiles, centerIndex, size, gap, soft, bridgeTarget, foldRight, foldLeft, swapArms) {
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
        bridgeLen
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
        bridgeLen
      );

    const first = swapArms ? growLeft() : growRight();
    if (!first) continue;
    const second = swapArms ? growRight() : growLeft();
    if (!second) continue;

    const list = [...map.values()];
    if (map.size === tiles.length && chainCollisionFree(list, gap, tiles)) {
      return { map, ok: true };
    }
  }
  return { map: new Map([[opener.id, origin]]), ok: false };
}

/**
 * Map local layout → screen top-left with auto-fit scale + centering.
 * Prefers pinning the opener to the viewport center when the chain still fits.
 * Final positions stay inside the playable felt (HUD insets applied).
 */
function toScreen(
  placements,
  viewport,
  padding = PADDING,
  openerId = null,
  margin = MARGIN,
  hudRight = null
) {
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const play = computePlayBounds({ width, height }, margin, hudRight);
  const viewW = Math.max(80, play.maxX - play.minX);
  const viewH = Math.max(80, play.maxY - play.minY);
  // Visual table center (felt) — opener pins here when the chain still fits.
  const midX = width / 2;
  const midY = height / 2;

  if (!placements.length) {
    return {
      tiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: midX, y: midY },
    };
  }

  const bb = bboxOf(placements);
  const contentW = Math.max(1, bb.maxX - bb.minX);
  const contentH = Math.max(1, bb.maxY - bb.minY);

  let cx = (bb.minX + bb.maxX) / 2;
  let cy = (bb.minY + bb.maxY) / 2;
  // Only down-scale when content is genuinely near the playable bounds.
  // Light fit padding keeps early-match tiles at full size while free space remains.
  const fitPad = Math.min(padding, 12);
  let scale = Math.min(
    1,
    viewW / (contentW + fitPad * 2),
    viewH / (contentH + fitPad * 2)
  );

  if (openerId) {
    const opener = placements.find((p) => p.id === openerId);
    if (opener) {
      const ox = opener.x + opener.w / 2;
      const oy = opener.y + opener.h / 2;
      const shiftedMinX = (bb.minX - ox) * scale + midX;
      const shiftedMaxX = (bb.maxX - ox) * scale + midX;
      const shiftedMinY = (bb.minY - oy) * scale + midY;
      const shiftedMaxY = (bb.maxY - oy) * scale + midY;
      const fitsPinned =
        shiftedMinX >= play.minX - 0.5 &&
        shiftedMaxX <= play.maxX + 0.5 &&
        shiftedMinY >= play.minY - 0.5 &&
        shiftedMaxY <= play.maxY + 0.5;
      if (fitsPinned) {
        cx = ox;
        cy = oy;
      }
    }
  }

  const tiles = placements.map((p, zIndex) => {
    const lx = p.x + p.w / 2;
    const ly = p.y + p.h / 2;
    const sx = (lx - cx) * scale + midX;
    const sy = (ly - cy) * scale + midY;
    const w = p.w * scale;
    const h = p.h * scale;
    // Fine snap at small scales so half-pixel rounding cannot eat the gap.
    const quantize = scale < 0.25 ? (n) => Math.round(n * 10) / 10 : snap;
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

  if (!tiles.length) {
    return {
      tiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: width / 2, y: height / 2 },
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
  const margin = options.margin ?? MARGIN;
  const requestedGap = options.gap ?? CHAIN_GAP;
  // Optional, measured-live reserve for HUD chrome (scoreboard / reserve
  // counter) pinned over the top-right / bottom-right of the felt — see
  // BoardContainer's `hudReserve` prop. Falls back to the built-in estimate
  // in computePlayBounds when not supplied, so existing callers/tests are
  // unaffected.
  const hudRight = options.hudRight ?? null;
  const play = computePlayBounds({ width, height }, margin, hudRight);

  // Soft play bounds in LOCAL space — inset so the snake turns before the HUD/edge.
  const softW = Math.max(200, play.maxX - play.minX - PADDING);
  const softH = Math.max(160, play.maxY - play.minY - PADDING);

  let unitScale = 1;
  let result = null;
  let looseFallback = null;
  let fallback = null;
  let essentialFallback = null;
  /** Best collision-free layout by tile scale — prefer full-size early match. */
  let bestByScale = null;

  const preferFullSize = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    if (b.scale > a.scale + 0.01) return b;
    if (a.scale > b.scale + 0.01) return a;
    return a;
  };

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const size = { w: baseW * unitScale, h: baseH * unitScale };
    const gap = effectiveGap(size.w, size.h, requestedGap);
    // Expand soft bounds on later attempts so dense chains can snake more.
    const grow = Math.min(4, 1 + attempt * 0.12);
    const bounds = {
      minX: (-softW / 2) * grow,
      maxX: (softW / 2) * grow,
      minY: (-softH / 2) * grow,
      maxY: (softH / 2) * grow,
    };

    // Prefer dual-tile vertical bridges (professional snake). Single-tile only late.
    const bridgeTarget = attempt < 56 ? BRIDGE_LEN : attempt % 2 === 0 ? BRIDGE_LEN : 1;
    const foldRight = attempt % 2 === 0 ? "S" : "N";
    const foldLeft = foldRight === "S" ? "N" : "S";
    const swapArms = Math.floor(attempt / 2) % 2 === 1;

    const { map, ok } = placeGraph(
      tiles,
      centerIndex,
      size,
      gap,
      bounds,
      bridgeTarget,
      foldRight,
      foldLeft,
      swapArms
    );

    if (ok && map.size === tiles.length) {
      const list = tiles.map((t) => map.get(t.id)).filter(Boolean);
      if (list.length === tiles.length && chainCollisionFree(list, gap, tiles)) {
        const screen = toScreen(
          list,
          { width, height },
          options.padding ?? PADDING,
          tiles[centerIndex].id,
          margin,
          hudRight
        );
        // Hard floor: the on-screen safety gap must never shrink toward 0 at
        // normal scale. At emergency-tiny scales the floor eases down too,
        // so a very long chain on a small viewport can still find a layout.
        const tileSpan = Math.max(screen.tiles[0]?.w || 0, screen.tiles[0]?.h || 0);
        const safeFloor = tileSpan >= 20 ? MIN_SAFE_GAP_PX : Math.min(MIN_SAFE_GAP_PX, tileSpan * 0.05);
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
        // Screen pass: hard AABB + play-bounds (local pass already enforced gap).
        const inPlay = screenPlacements.every(
          (p) =>
            p.x >= play.minX - 0.75 &&
            p.y >= play.minY - 0.75 &&
            p.x + p.w <= play.maxX + 0.75 &&
            p.y + p.h <= play.maxY + 0.75
        );
        let screenClear = true;
        for (let i = 0; i < screenPlacements.length && screenClear; i += 1) {
          for (let j = i + 1; j < screenPlacements.length; j += 1) {
            if (overlaps(screenPlacements[i], screenPlacements[j])) {
              screenClear = false;
              break;
            }
          }
        }
        if (inPlay && screenClear) {
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
          // Strict gate: full reserve (doubles + corners + bridges) at the
          // floored minimum gap — the target for realistic board lengths.
          const axisOk = screenAxisOk(screenPlacements, tiles, screenGap);
          if (axisOk) {
            bestByScale = preferFullSize(bestByScale, candidate);
          }
          // Accept full-size dual layouts immediately. Keep a smaller dual
          // match as the answer, but do not shrink further once we have one.
          if (axisOk && mostlyDual) {
            result = preferFullSize(result, candidate);
            if (candidate.scale >= 0.97) break;
          }
          // Loose gate: still has at least one real dual-tile bridge (not the
          // majority-preference of the strict gate) — a legitimate, fully
          // valid layout that shouldn't be discarded for a stricter match
          // found many scale-shrinks later.
          if (axisOk && (bridges.length === 0 || dualCount >= 1)) {
            looseFallback = preferFullSize(looseFallback, candidate);
          }
          if (axisOk) fallback = preferFullSize(fallback, candidate);
          // Essential gate: doubles-only reserve, unfloored gap — guarantees
          // a collision-free (if tighter) layout even at emergency density
          // where the strict gate can never be satisfied.
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

    // Scaling policy: keep maximum tile size while free table space remains.
    // Soft-bound growth runs first; shrink only when the chain is near the
    // real playable edges (or a dense/tight viewport still has no layout).
    const matchLen = tiles.length;
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
    const cramped =
      overcrowded ||
      baseW * 1.15 > playW * 0.42 ||
      baseH * 1.15 > playH * 0.55 ||
      playW < 260;
    // Soft bounds reach max grow (~4×) around attempt 25; don't shrink
    // spacious early-match boards before that for a fold that hasn't clicked.
    const softGrowExhausted = attempt >= 28;
    const needEmergencyFit = noLayoutYet && (cramped || softGrowExhausted);
    const shrinkEvery = needEmergencyFit
      ? matchLen >= 200
        ? 3
        : 6
      : matchLen >= 200
        ? 4
        : matchLen >= 28
          ? 10
          : matchLen >= 16
            ? 14
            : 18;
    // Never down-scale after a dual-bridge layout is already in hand — only
    // keep hunting at the current size for a fuller-scale dual match.
    if (result && attempt >= 48) break;
    const allowShrink =
      !result &&
      (needEmergencyFit ||
        matchLen > 24 ||
        attempt >= 56 ||
        (matchLen > 16 && attempt >= 44));
    if (attempt % shrinkEvery === shrinkEvery - 1) {
      if (allowShrink && unitScale > EMERGENCY_MIN_SCALE + 0.001) {
        const step = needEmergencyFit
          ? matchLen >= 200
            ? 0.75
            : 0.82
          : matchLen >= 200
            ? 0.85
            : matchLen >= 28
              ? 0.92
              : 0.94;
        unitScale = Math.max(EMERGENCY_MIN_SCALE, unitScale * step);
      } else if (
        !result &&
        attempt > 85 &&
        unitScale <= EMERGENCY_MIN_SCALE + 0.001
      ) {
        break;
      }
    }
  }

  // Prefer dual-bridge layouts. Promote a larger loose match only when it is
  // materially bigger. Early on a roomy table, keep premium full size instead
  // of a heavily shrunk dual-only match.
  if (result && looseFallback && looseFallback.scale > result.scale * 1.1) {
    result = looseFallback;
  }
  if (
    bestByScale &&
    tiles.length <= 18 &&
    bestByScale.scale >= 0.95 &&
    (!result || result.scale < bestByScale.scale * 0.92)
  ) {
    result = bestByScale;
  }
  if (!result) result = bestByScale;
  if (!result) result = looseFallback;
  if (!result) result = fallback;
  if (!result) result = essentialFallback;

  if (!result) {
    return {
      tiles: [],
      scale: unitScale,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: width / 2, y: height / 2 },
      gap: requestedGap,
    };
  }

  return result;
}

/* ---------- Compatibility shims for legacy layoutBoard callers ---------- */

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
  // width below a sane floor — the scale-shrink loop in calculateBoardLayout
  // still has to have room to search for a valid, non-overlapping layout.
  // Empirically, usable widths under ~200px on phone felt (with a mid-game
  // 12-tile chain + real HUD) cause every attempt to fail the screen
  // in-play gate and return an empty board. Keep at least 220px usable.
  const MIN_PLAYABLE_WIDTH = 220;
  const maxHudRight = Math.max(estimate, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  const hudRight =
    hudRightOverride != null && Number.isFinite(hudRightOverride)
      ? Math.min(Math.max(hudRightOverride, estimate), maxHudRight)
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

export function computeStableFitScale(viewport, tileSize, margin, tileCount) {
  const planned = Math.max(tileCount, 28);
  const metrics = computeLayoutMetrics(viewport, tileSize, margin, planned);
  const step = metrics.long + CHAIN_GAP;
  // Each arm only owns half the soft width before a boundary turn.
  const tilesPerRow = Math.max(
    3,
    Math.min(TURN_EVERY, Math.floor(metrics.usableW / 2 / step) - 1)
  );
  const perArm = Math.ceil(planned / 2);
  const folds = Math.max(0, Math.ceil(perArm / tilesPerRow) - 1);
  const bridgeH =
    BRIDGE_LEN * metrics.long + (BRIDGE_LEN + 1) * CHAIN_GAP + metrics.short * 0.25;
  const contentH = (folds + 1) * metrics.short + folds * bridgeH;
  const contentW = tilesPerRow * step + metrics.short * 0.5 + PADDING;
  const sx = metrics.usableW / Math.max(1, contentW);
  const sy = metrics.usableH / Math.max(1, contentH);
  return Math.max(EMERGENCY_MIN_SCALE, Math.min(1, Math.min(sx, sy)));
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
    content: {
      width: viewport.width,
      height: viewport.height,
    },
    center: result.origin,
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
