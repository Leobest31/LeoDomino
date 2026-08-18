/**
 * Drag-target helpers — nearest legal chain endpoint, never a felt drop zone.
 * Pure JS (no React / no DOM).
 */

import { END } from "./constants.js";

/** Invisible padding around a real endpoint AABB (px floor). */
export const DESTINATION_HIT_PADDING_MIN = 40;
/** Extra padding as a fraction of the longer tile side. */
export const DESTINATION_HIT_PADDING_RATIO = 0.55;
/** Finger tap vs drag: stay under this distance to treat pointerup as a tap. */
export const DESTINATION_TAP_SLOP_PX = 20;

const OUTWARD_FACES = new Set(["E", "W", "N", "S"]);

/**
 * Outward exposed face of a destination tile after layout folding.
 * Spinner-hub N/S ports keep their short faces; they must not inherit the
 * spinner's main-chain travelDir.
 *
 * @param {"left"|"right"|"north"|"south"} end
 * @param {unknown} travelDir
 * @param {{ spinnerHub?: boolean }} [options]
 * @returns {"E"|"W"|"N"|"S"|null}
 */
export function resolveDestinationOutward(end, travelDir, options = {}) {
  if (options.spinnerHub && (end === END.NORTH || end === END.SOUTH)) return null;
  if (OUTWARD_FACES.has(travelDir)) return travelDir;
  return null;
}

/**
 * Board tile that visually represents a legal destination.
 *
 * @param {"left"|"right"|"north"|"south"} end
 * @param {object} layout
 * @param {object[]} layout.board
 * @param {string|null} [layout.spinnerId]
 * @param {object[]} [layout.spinnerNorth]
 * @param {object[]} [layout.spinnerSouth]
 * @returns {string|null}
 */
export function destinationTileId(end, layout = {}) {
  const board = Array.isArray(layout.board) ? layout.board : [];
  const north = Array.isArray(layout.spinnerNorth) ? layout.spinnerNorth : [];
  const south = Array.isArray(layout.spinnerSouth) ? layout.spinnerSouth : [];
  const spinnerId = typeof layout.spinnerId === "string" ? layout.spinnerId : null;

  if (end === END.LEFT) return board[0]?.id ?? null;
  if (end === END.RIGHT) return board[board.length - 1]?.id ?? null;
  if (end === END.NORTH) {
    if (north.length) return north[north.length - 1].id;
    return spinnerId;
  }
  if (end === END.SOUTH) {
    if (south.length) return south[south.length - 1].id;
    return spinnerId;
  }
  return null;
}

/**
 * Outer-face anchor of a destination (left/right/top/bottom of that tile).
 *
 * @param {"left"|"right"|"north"|"south"} end
 * @param {{ left: number, top: number, right: number, bottom: number }} rect
 * @returns {{ x: number, y: number }}
 */
export function destinationAnchorPoint(end, rect) {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  if (end === END.LEFT) return { x: rect.left, y: cy };
  if (end === END.RIGHT) return { x: rect.right, y: cy };
  if (end === END.NORTH) return { x: cx, y: rect.top };
  if (end === END.SOUTH) return { x: cx, y: rect.bottom };
  return { x: cx, y: cy };
}

function hitPadding(rect) {
  const w = Math.max(0, rect.right - rect.left);
  const h = Math.max(0, rect.bottom - rect.top);
  return Math.max(DESTINATION_HIT_PADDING_MIN, DESTINATION_HIT_PADDING_RATIO * Math.max(w, h));
}

function contains(rect, x, y, pad) {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Distance from the pointer to the physical face of a destination.
 *
 * A vertical spinner is taller than it is wide. Measuring to face edges
 * (not the four corner-ish anchors) keeps LEFT/RIGHT on the long sides
 * and TOP/BOTTOM on the short sides, so a drop on the spinner body is a
 * main-chain play — not an accidental spinner branch.
 *
 * After a snake fold, `outward` (layout travelDir) is the exposed face.
 * Logical LEFT is still LEFT even when that face is visually east/south.
 *
 * @param {"left"|"right"|"north"|"south"} end
 * @param {{ left: number, top: number, right: number, bottom: number }} rect
 * @param {number} x
 * @param {number} y
 * @param {"E"|"W"|"N"|"S"|null} [outward]
 * @returns {number}
 */
export function destinationFaceDistance(end, rect, x, y, outward = null) {
  const face =
    outward === "W" || outward === "E" || outward === "N" || outward === "S"
      ? outward
      : end === END.LEFT
        ? "W"
        : end === END.RIGHT
          ? "E"
          : end === END.NORTH
            ? "N"
            : end === END.SOUTH
              ? "S"
              : null;
  if (face === "W") {
    const qy = clamp(y, rect.top, rect.bottom);
    return Math.hypot(x - rect.left, y - qy);
  }
  if (face === "E") {
    const qy = clamp(y, rect.top, rect.bottom);
    return Math.hypot(x - rect.right, y - qy);
  }
  if (face === "N") {
    const qx = clamp(x, rect.left, rect.right);
    return Math.hypot(x - qx, y - rect.top);
  }
  if (face === "S") {
    const qx = clamp(x, rect.left, rect.right);
    return Math.hypot(x - qx, y - rect.bottom);
  }
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  return Math.hypot(x - cx, y - cy);
}

function portPriority(end) {
  if (end === END.LEFT || end === END.RIGHT) return 0;
  if (end === END.NORTH || end === END.SOUTH) return 1;
  return 2;
}

function isMainEnd(end) {
  return end === END.LEFT || end === END.RIGHT;
}

function isSpinnerArmEnd(end) {
  return end === END.NORTH || end === END.SOUTH;
}

function rectKey(rect) {
  return `${rect.left},${rect.top},${rect.right},${rect.bottom}`;
}

function isInsideRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Nearest legal destination under the pointer. Returns null when the pointer
 * is not close enough to any legal endpoint — never a fallback end.
 *
 * LEFT/RIGHT are the main-chain faces; TOP/BOTTOM are spinner branches.
 * When several ends share one spinner rectangle, a drop *inside* the body
 * is always a main-chain play. TOP/BOTTOM win only when the pointer is
 * outside the short faces (explicit spinner-arm aim). The engine does not
 * start the main chain on NORTH/SOUTH just because the pip matches.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ end: string, rect: { left: number, top: number, right: number, bottom: number } }[]} targets
 * @returns {string|null}
 */
export function pickTargetDestination(clientX, clientY, targets) {
  if (!Array.isArray(targets) || !targets.length) return null;

  /** Ends that share one spinner AABB: interior = main chain, caps = arms. */
  const byRect = new Map();
  for (const target of targets) {
    if (!target?.rect || !target.end) continue;
    const key = rectKey(target.rect);
    if (!byRect.has(key)) byRect.set(key, []);
    byRect.get(key).push(target);
  }

  let bestEnd = null;
  let bestDist = Infinity;
  let bestPriority = 99;
  for (const target of targets) {
    if (!target?.rect || !target.end) continue;
    const pad = hitPadding(target.rect);
    if (!contains(target.rect, clientX, clientY, pad)) continue;

    const group = byRect.get(rectKey(target.rect)) || [];
    const sharedHasMain = group.some((entry) => isMainEnd(entry.end));
    if (
      sharedHasMain &&
      isSpinnerArmEnd(target.end) &&
      isInsideRect(target.rect, clientX, clientY)
    ) {
      continue;
    }

    const dist = destinationFaceDistance(
      target.end,
      target.rect,
      clientX,
      clientY,
      target.outward ?? null
    );
    const priority = portPriority(target.end);
    if (
      dist < bestDist - 0.5 ||
      (Math.abs(dist - bestDist) <= 0.5 && priority < bestPriority)
    ) {
      bestDist = dist;
      bestPriority = priority;
      bestEnd = target.end;
    }
  }
  return bestEnd;
}

/**
 * Map legal ends to highlight tile ids (one id per end; spinner N/S may share).
 *
 * @param {string[]} legalEnds
 * @param {object} layout
 * @returns {Record<string, string>}
 */
export function destinationHighlightMap(legalEnds, layout) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const end of legalEnds || []) {
    const id = destinationTileId(end, layout);
    if (id) map[end] = id;
  }
  return map;
}
