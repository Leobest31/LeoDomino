/**
 * dominoBitmapCache — bounded cache of pre-painted domino tile bitmaps.
 *
 * Each entry is a canvas-like surface painted once via
 * `DominoBitmapPainter.paintDominoTile` and reused by
 * `CanvasDominoSurface` via `drawImage`. A double-six deck has at most
 * 28 distinct board tiles plus a handful of hand/reserve/drag variants —
 * well under a hundred unique (value, orientation, size, dpr) combos are
 * ever live at once, so a simple capacity-capped map is sufficient; no
 * LRU library or eviction heuristics beyond "drop the oldest" are needed.
 *
 * `createSurface` and `paint` are injectable so this module is testable
 * in plain Node (no real `document`/`CanvasRenderingContext2D` required)
 * — tests supply fakes and assert on cache hit/miss/eviction behavior
 * directly, matching the project's existing "run via `node`, no
 * framework" test convention.
 */
import { paintDominoTile } from "./DominoBitmapPainter.js";

export const DEFAULT_CACHE_CAPACITY = 200;

function defaultCreateSurface(pixelWidth, pixelHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  return canvas;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Stable string key for one (tile, box, device) combination.
 *
 * `cssWidth`/`cssHeight` are rounded to the nearest half CSS pixel and
 * `dpr` to the nearest quarter so ResizeObserver jitter or a
 * borderline devicePixelRatio never fragments the cache with
 * near-duplicate entries that would all paint identical pixels anyway.
 *
 * @param {{
 *   left: number, right: number, faceDown: boolean,
 *   orientation: string, selected: boolean, size: string,
 *   cssWidth: number, cssHeight: number, dpr: number,
 * }} params
 */
export function buildDominoCacheKey(params) {
  const {
    left,
    right,
    faceDown,
    orientation,
    selected,
    size,
    cssWidth,
    cssHeight,
    dpr,
  } = params;

  const w = roundTo(cssWidth, 0.5);
  const h = roundTo(cssHeight, 0.5);
  const d = roundTo(dpr > 0 ? dpr : 1, 0.25);

  return [
    faceDown ? "back" : `${left}-${right}`,
    orientation,
    selected ? "sel" : "flat",
    size,
    w,
    h,
    d,
  ].join("|");
}

/**
 * @param {{
 *   capacity?: number,
 *   createSurface?: (pixelWidth: number, pixelHeight: number) => any,
 *   paint?: (ctx: any, options: object) => void,
 * }} [config]
 */
export function createDominoBitmapCache(config = {}) {
  const {
    capacity = DEFAULT_CACHE_CAPACITY,
    createSurface = defaultCreateSurface,
    paint = paintDominoTile,
  } = config;

  /** @type {Map<string, any>} insertion order doubles as LRU recency order. */
  const entries = new Map();

  function getOrCreate(params) {
    const key = buildDominoCacheKey(params);
    const cached = entries.get(key);
    if (cached) {
      // Touch for LRU: move to the most-recently-used end.
      entries.delete(key);
      entries.set(key, cached);
      return cached;
    }

    const dpr = params.dpr > 0 ? params.dpr : 1;
    const pixelWidth = Math.max(1, Math.round(params.cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(params.cssHeight * dpr));
    const surface = createSurface(pixelWidth, pixelHeight);
    const ctx = surface.getContext("2d");

    ctx.save();
    ctx.scale(dpr, dpr);
    paint(ctx, {
      left: params.left,
      right: params.right,
      faceDown: params.faceDown,
      orientation: params.orientation,
      selected: params.selected,
      size: params.size,
      w: params.cssWidth,
      h: params.cssHeight,
    });
    ctx.restore();

    entries.set(key, surface);
    if (entries.size > capacity) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
    return surface;
  }

  function clear() {
    entries.clear();
  }

  function size() {
    return entries.size;
  }

  function has(params) {
    return entries.has(buildDominoCacheKey(params));
  }

  return { getOrCreate, clear, size, has, buildKey: buildDominoCacheKey };
}

/** Shared singleton used by the app at runtime. */
export const dominoBitmapCache = createDominoBitmapCache();
