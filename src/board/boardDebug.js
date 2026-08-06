/**
 * Board layout debug helpers — collision logging + debug-mode detection.
 * Temporary instrumentation for placement-engine diagnosis.
 */

import { collisionBox } from "./DominoLayoutEngine.js";

export const BOARD_DEBUG_STORAGE_KEY = "leodomino.boardDebug";

/** @type {boolean} */
let forceDebug = false;

export function setBoardDebug(enabled) {
  forceDebug = Boolean(enabled);
  if (typeof localStorage !== "undefined") {
    try {
      if (enabled) localStorage.setItem(BOARD_DEBUG_STORAGE_KEY, "1");
      else localStorage.removeItem(BOARD_DEBUG_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function isBoardDebugEnabled() {
  if (forceDebug) return true;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("boardDebug") === "1") {
      return true;
    }
    if (localStorage.getItem(BOARD_DEBUG_STORAGE_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * @param {{
 *   id: string,
 *   x: number,
 *   y: number,
 *   w: number,
 *   h: number,
 *   rotation?: number,
 *   orientation?: string,
 *   travelDir?: string,
 * }} candidate
 * @param {{
 *   id: string,
 *   x: number,
 *   y: number,
 *   w: number,
 *   h: number,
 * }} other
 * @param {string} reason
 */
export function logCollision(candidate, other, reason) {
  const payload = {
    dominoId: candidate.id,
    coordinates: { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h },
    rotation: candidate.rotation ?? (candidate.orientation === "horizontal" ? 0 : 90),
    travelDir: candidate.travelDir,
    collidingDominoId: other.id,
    collidingBox: { x: other.x, y: other.y, w: other.w, h: other.h },
    reason,
  };
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[LeoDomino][layout-collision]", payload);
  }
  return payload;
}

/**
 * Signed edge clearance. Negative ⇒ AABB intersection.
 */
export function edgeClearance(a, b) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  const xGap =
    a.x + a.w <= b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const yGap =
    a.y + a.h <= b.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  if (xOv && yOv) return -Math.min(Math.abs(xGap), Math.abs(yGap)) || -1;
  if (xOv) return yGap;
  if (yOv) return xGap;
  return Math.min(xGap, yGap);
}

/**
 * Build debug overlay descriptors from placements (chain order).
 */
export function buildLayoutDebugInfo(placements, tiles = []) {
  const byId = new Map(placements.map((p) => [p.id, p]));
  const ordered = tiles.length
    ? tiles.map((t) => byId.get(t.id)).filter(Boolean)
    : placements;

  const path = ordered.map((p) => ({
    id: p.id,
    x: p.x + p.w / 2,
    y: p.y + p.h / 2,
  }));

  const turnPoints = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (a.travelDir && b.travelDir && a.travelDir !== b.travelDir) {
      turnPoints.push({
        index: i,
        id: b.id,
        x: b.x + b.w / 2,
        y: b.y + b.h / 2,
        from: a.travelDir,
        to: b.travelDir,
      });
    }
  }

  const boxes = ordered.map((p, index) => {
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
      rotation: p.rotation ?? (p.orientation === "horizontal" ? 0 : 90),
      travelDir: p.travelDir,
      branch: p.branch,
      double: !!p.double,
      collision: { x: col.x, y: col.y, w: col.w, h: col.h },
    };
  });

  return { boxes, path, turnPoints };
}
