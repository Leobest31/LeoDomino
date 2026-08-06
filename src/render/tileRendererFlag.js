/**
 * Developer-only toggle between the CSS domino renderer (default,
 * shipping to every player today) and the new Canvas 2D cached-bitmap
 * renderer (Phase 1 — dev-only, not exposed in any player-facing UI).
 *
 * Mirrors `boardDebug.js`'s existing pattern exactly: a URL param for a
 * quick one-off check, `localStorage` for a sticky per-device override,
 * and an in-memory override for programmatic/test control within a
 * session. A `window` event lets already-mounted tiles react live when
 * the flag is flipped from devtools, without a full reload.
 */

export const TILE_RENDERER_STORAGE_KEY = "leodomino.tileRenderer";
export const TILE_RENDERER_CHANGE_EVENT = "leodomino:tile-renderer-change";

/** @type {boolean|null} null = no override, defer to URL param / localStorage. */
let memoryOverride = null;

export function setCanvasTileRendererEnabled(enabled) {
  memoryOverride = Boolean(enabled);
  if (typeof localStorage !== "undefined") {
    try {
      if (enabled) localStorage.setItem(TILE_RENDERER_STORAGE_KEY, "canvas");
      else localStorage.removeItem(TILE_RENDERER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== "undefined" && window.dispatchEvent) {
    window.dispatchEvent(new Event(TILE_RENDERER_CHANGE_EVENT));
  }
}

/** Drop any in-memory override and defer back to URL param / localStorage. */
export function resetCanvasTileRendererOverride() {
  memoryOverride = null;
  if (typeof window !== "undefined" && window.dispatchEvent) {
    window.dispatchEvent(new Event(TILE_RENDERER_CHANGE_EVENT));
  }
}

export function isCanvasTileRendererEnabled() {
  if (memoryOverride !== null) return memoryOverride;
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("tileRenderer") === "canvas") {
      return true;
    }
    if (localStorage.getItem(TILE_RENDERER_STORAGE_KEY) === "canvas") return true;
  } catch {
    /* ignore */
  }
  return false;
}
