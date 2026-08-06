import { useLayoutEffect, useRef } from "react";
import { dominoBitmapCache } from "../render/dominoBitmapCache.js";
import "./CanvasDominoSurface.css";

/**
 * A `<canvas>`'s own backing buffer never has more real pixels than
 * `cssSize * window.devicePixelRatio` — no amount of *pre*-downscaling
 * into it (e.g. painting an offscreen bitmap bigger and `drawImage`-ing
 * it down before storing the result) can add detail the final buffer
 * doesn't have room for. On a low-DPI environment (`devicePixelRatio`
 * as low as 1), that buffer is so small at hand-tile scale that a pip
 * is only ~2-3 real pixels across, and *any* rasterizer — canvas arcs
 * or otherwise — quantizes a circle that tiny into a visible square/
 * diamond blob. CSS's `border-radius: 50%` circles don't hit this
 * because the browser re-rasterizes vector DOM content fresh at
 * whatever resolution it's actually displayed/composited at; a canvas
 * bitmap is a fixed raster baked once at paint time.
 *
 * The fix mirrors it: give the *on-screen* canvas element's own buffer
 * more real pixels than the environment's raw DPR would ("retina
 * canvas" pattern), while its CSS size stays exactly what the layout
 * needs. The browser's own GPU compositor then downscales that
 * higher-resolution buffer down to the smaller CSS box using proper
 * texture-minification filtering when painting the page — a different,
 * higher-quality path than a software `drawImage` resize, and one that
 * works even when the device itself is genuinely low-DPI.
 */
const MIN_RENDER_DPR = 2;

/**
 * Canvas 2D replacement for `.domino__face` (Domino.css) — the ivory
 * plate, grain, sheen, halves, pips, divider, and gold pin. Everything
 * else about the tile (the outer button/div, its aria attributes, the
 * `.domino__base` thickness band, hover/selected/dragging transitions)
 * lives in the parent (`DominoTileClassic`) exactly as it did before
 * this component existed.
 *
 * Purely decorative: always `aria-hidden`, never a click/focus target,
 * never holds game state. Paints once per prop change via a cached
 * bitmap — there is no render loop.
 */
function CanvasDominoSurface({
  left = 0,
  right = 0,
  faceDown = false,
  orientation = "vertical",
  selected = false,
  size = "md",
}) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const repaint = () => {
      const rect = canvas.getBoundingClientRect();
      const cssWidth = rect.width;
      const cssHeight = rect.height;
      if (cssWidth < 1 || cssHeight < 1) return;

      const dpr = Math.max(window.devicePixelRatio || 1, MIN_RENDER_DPR);
      const surface = dominoBitmapCache.getOrCreate({
        left,
        right,
        faceDown,
        orientation,
        selected,
        size,
        cssWidth,
        cssHeight,
        dpr,
      });

      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
      // The cached bitmap is deliberately painted larger than this
      // (`BITMAP_SUPERSAMPLE` in dominoBitmapCache.js) so small detail —
      // pips only a couple of device px across at hand-tile scale —
      // gets real anti-aliasing headroom. That only pays off if this
      // downscale actually uses a real filter: Chromium's default
      // `imageSmoothingQuality` is "low", which is close to nearest-
      // neighbor and would throw the supersampling away.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(surface, 0, 0, pixelWidth, pixelHeight);
    };

    repaint();

    const ro = new ResizeObserver(repaint);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [left, right, faceDown, orientation, selected, size]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-domino-surface"
      width={1}
      height={1}
      aria-hidden="true"
    />
  );
}

export default CanvasDominoSurface;
