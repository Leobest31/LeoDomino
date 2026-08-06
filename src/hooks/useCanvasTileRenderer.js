import { useEffect, useState } from "react";
import {
  isCanvasTileRendererEnabled,
  TILE_RENDERER_CHANGE_EVENT,
} from "../render/tileRendererFlag.js";

/**
 * Reactive read of the dev-only Canvas 2D tile renderer flag. Re-renders
 * every mounted tile when the flag changes (devtools console, or the
 * `storage` event from another tab) without requiring a page reload.
 *
 * Returns `false` by default — the CSS renderer stays the shipping
 * default for every player unless a developer explicitly opts in via
 * `?tileRenderer=canvas` or `setCanvasTileRendererEnabled(true)`.
 */
export function useCanvasTileRenderer() {
  const [enabled, setEnabled] = useState(() => isCanvasTileRendererEnabled());

  useEffect(() => {
    const sync = () => setEnabled(isCanvasTileRendererEnabled());
    window.addEventListener(TILE_RENDERER_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TILE_RENDERER_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return enabled;
}

export default useCanvasTileRenderer;
