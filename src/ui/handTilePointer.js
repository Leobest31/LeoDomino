/**
 * Hand-rack pointer helpers: horizontal swipe scrolls, vertical move drags.
 * Pure UI — does not change legal-move / scoring rules.
 */

export const HAND_GESTURE_DECIDE_PX = 10;

/**
 * @param {number} dx
 * @param {number} dy
 * @param {number} [threshold]
 * @returns {"undecided" | "scroll" | "drag"}
 */
export function classifyHandPointerGesture(dx, dy, threshold = HAND_GESTURE_DECIDE_PX) {
  const ax = Math.abs(Number(dx) || 0);
  const ay = Math.abs(Number(dy) || 0);
  const limit = Number.isFinite(Number(threshold)) ? Number(threshold) : HAND_GESTURE_DECIDE_PX;
  if (ax < limit && ay < limit) return "undecided";
  return ax >= ay ? "scroll" : "drag";
}

/**
 * @param {Element | null | undefined} fromEl
 */
export function handTrayCanScroll(fromEl) {
  const tray =
    fromEl?.closest?.("[data-hand-scroll]") ?? fromEl?.closest?.(".player-panel__tray");
  if (!tray) return false;
  return tray.scrollWidth > tray.clientWidth + 1;
}

/**
 * @param {PointerEvent} event
 */
export function shouldDeferHandDrag(event) {
  return event?.pointerType === "touch" && handTrayCanScroll(event.currentTarget);
}

/**
 * Wait until a touch gesture is clearly vertical before starting drag-to-play,
 * so the overflowing rack can use native horizontal pan.
 *
 * @param {PointerEvent} event
 * @param {{ onDrag: (payload: object) => void, threshold?: number }} options
 */
export function watchHandScrollOrDrag(event, options) {
  const onDrag = options?.onDrag;
  const threshold = options?.threshold ?? HAND_GESTURE_DECIDE_PX;
  const originX = event.clientX;
  const originY = event.clientY;
  const pointerId = event.pointerId;
  const target = event.currentTarget;
  let settled = false;

  const finish = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
  };

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId || settled) return;
    const kind = classifyHandPointerGesture(
      moveEvent.clientX - originX,
      moveEvent.clientY - originY,
      threshold
    );
    if (kind === "undecided") return;
    settled = true;
    finish();
    if (kind === "drag" && typeof onDrag === "function") {
      onDrag({
        pointerId,
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
        originX,
        originY,
        currentTarget: target,
        button: 0,
        preventDefault() {},
      });
    }
  };

  const onEnd = (endEvent) => {
    if (endEvent.pointerId !== pointerId) return;
    settled = true;
    finish();
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  return finish;
}
