/**
 * Motion timing helpers (offline, no dependencies).
 */

export const MOTION = Object.freeze({
  tileFlightMs: 480,
  drawFlightMs: 440,
  snapMs: 200,
  handFlipMs: 280,
  scoreMs: 420,
  bannerMs: 1400,
  celebrationMs: 1800,
  /** Soft table-slide lift (px) — keep low for a natural slide. */
  playArcLiftPx: 10,
  drawArcLiftPx: 6,
});

/**
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * @returns {Promise<void>}
 */
export function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Read a DOMRect for a tile marker in the document.
 * @param {string} selector
 * @returns {DOMRect|null}
 */
export function measure(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getBoundingClientRect();
}

/**
 * Build CSS transform that maps a tile from `from` rect to `to` rect
 * relative to a fixed full-viewport layer origin (0,0).
 *
 * @param {DOMRect} rect
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function rectToLayer(rect) {
  return {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
  };
}

/**
 * Ease-out cubic for score ticks (JS rAF).
 * @param {number} t 0..1
 */
export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}
