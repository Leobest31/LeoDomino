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
        buttons: moveEvent.buttons,
        pointerType: moveEvent.pointerType || event.pointerType,
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

export function captureTileDragPointer(target, pointerId) {
  if (!target || pointerId == null) return false;
  try {
    target.setPointerCapture?.(pointerId);
    return true;
  } catch {
    return false;
  }
}

export function releaseTileDragPointer(target, pointerId) {
  if (!target || pointerId == null) return;
  try {
    if (typeof target.hasPointerCapture === "function" && !target.hasPointerCapture(pointerId)) {
      return;
    }
    target.releasePointerCapture?.(pointerId);
  } catch {
    /* already released */
  }
}

/**
 * Pointer still down enough to start a tile drag. A deferred-drag callback
 * after lift must not create a stuck ghost with no later pointerup.
 */
export function pointerStillDown(event) {
  if (!event) return false;
  const buttons = Number(event.buttons);
  if (Number.isFinite(buttons) && buttons === 0 && event.pointerType !== "touch") {
    return false;
  }
  return true;
}

/**
 * After setPointerCapture, iOS Safari delivers pointermove to the captured
 * element (and document in capture phase), not window.
 * Bind from the drag-start path (not only a later React effect) so a fast
 * pointerup cannot miss the listener and lock the hand.
 * @param {EventTarget | null | undefined} target
 * @param {{ onMove?: Function, onUp?: Function, onCancel?: Function }} handlers
 */
export function attachCapturedPointerTracking(target, handlers) {
  const onMove = handlers?.onMove;
  const onUp = handlers?.onUp;
  const onCancel = handlers?.onCancel;
  const moveOpts = { capture: true, passive: false };
  const endOpts = { capture: true };
  const hosts = [];
  if (target && typeof target.addEventListener === "function") hosts.push(target);
  if (typeof document !== "undefined" && document !== target) hosts.push(document);

  let ended = false;
  const onceUp = onUp
    ? (event) => {
        if (ended) return;
        ended = true;
        onUp(event);
      }
    : null;
  const onceCancel = onCancel
    ? (event) => {
        if (ended) return;
        ended = true;
        onCancel(event);
      }
    : null;

  for (const host of hosts) {
    if (onMove) host.addEventListener("pointermove", onMove, moveOpts);
    if (onceUp) host.addEventListener("pointerup", onceUp, endOpts);
    if (onceCancel) {
      host.addEventListener("pointercancel", onceCancel, endOpts);
      host.addEventListener("lostpointercapture", onceCancel, endOpts);
    }
  }

  return () => {
    for (const host of hosts) {
      if (onMove) host.removeEventListener("pointermove", onMove, moveOpts);
      if (onceUp) host.removeEventListener("pointerup", onceUp, endOpts);
      if (onceCancel) {
        host.removeEventListener("pointercancel", onceCancel, endOpts);
        host.removeEventListener("lostpointercapture", onceCancel, endOpts);
      }
    }
  };
}
