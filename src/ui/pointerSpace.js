/**
 * Shared pointer coordinate space for drag/drop.
 * Always clientX/clientY + getBoundingClientRect — never pageX/pageY.
 * Ghost position is converted into the game-page local box so iOS Safari
 * visualViewport chrome cannot desync a position:fixed overlay from tiles.
 */

export function pointerClientPoint(event) {
  return {
    x: Number(event?.clientX) || 0,
    y: Number(event?.clientY) || 0,
  };
}

/**
 * Map a viewport client point into an element's border box.
 * @param {number} clientX
 * @param {number} clientY
 * @param {Element | null | undefined} rootEl
 */
export function ghostPositionInRoot(clientX, clientY, rootEl) {
  const x = Number(clientX) || 0;
  const y = Number(clientY) || 0;
  if (!rootEl || typeof rootEl.getBoundingClientRect !== "function") {
    return { x, y };
  }
  const r = rootEl.getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}

/**
 * True when two client-space measurements share the same origin (viewport).
 * Defensive: callers must not mix pageX with getBoundingClientRect.
 */
export function sameClientSpace(event, rect) {
  if (!event || !rect) return false;
  return Number.isFinite(event.clientX) && Number.isFinite(rect.left);
}
