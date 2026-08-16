/**
 * Motion timing helpers (offline, no dependencies).
 */

export const MOTION = Object.freeze({
  /** Play / AI place flight — 200–250ms premium slide. */
  tileFlightMs: 230,
  drawFlightMs: 220,
  snapMs: 200,
  handFlipMs: 220,
  scoreMs: 300,
  bannerMs: 1000,
  celebrationMs: 1200,
  /** Minimal lift — no exaggerated arc. */
  playArcLiftPx: 2,
  drawArcLiftPx: 2,
  /** All Fives table +N hold before the HUD scoreboard ticks. */
  playScoreHoldMs: 2000,
  /** All Fives round-end: one remaining tile counted at a time. */
  roundSummaryTileMs: 750,
  /** All Fives round-end: hold final ROUND POINTS before HUD ticks. */
  roundSummaryHoldMs: 2000,
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
