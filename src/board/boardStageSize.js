/**
 * Stabilize the live board stage size so Classic tiles do not shrink for a
 * few seconds and then jump back (URL bar, 0×0 RO flash, 120px floor).
 *
 * Width changes (orientation) apply immediately. Height-only collapses that
 * look like a mobile chrome / flex glitch keep the last good size.
 */

/** Below this, a measurement is not a real phone/tablet felt. */
export const MIN_BOARD_STAGE_PX = 160;

/** Height-only drop treated as URL-bar / transient chrome, not a real resize. */
export const TRANSIENT_HEIGHT_DROP_PX = 120;

export function measureBoardStageBox(stage) {
  const w = Math.max(0, Number(stage?.clientWidth) || 0);
  const h = Math.max(0, Number(stage?.clientHeight) || 0);
  return { w, h };
}

export function isUsableBoardStageSize(box) {
  const w = Number(box?.w) || 0;
  const h = Number(box?.h) || 0;
  return w >= MIN_BOARD_STAGE_PX && h >= MIN_BOARD_STAGE_PX;
}

export function isTransientBoardStageCollapse(previous, measured) {
  if (!isUsableBoardStageSize(previous)) return false;
  const w = Number(measured?.w) || 0;
  const h = Number(measured?.h) || 0;
  if (w < MIN_BOARD_STAGE_PX || h < MIN_BOARD_STAGE_PX) return true;
  const widthStable = Math.abs(w - previous.w) <= 40;
  if (!widthStable) return false;
  if (h >= previous.h - 8) return false;
  return previous.h - h <= TRANSIENT_HEIGHT_DROP_PX;
}

export function stabilizeBoardStageSize(previous, measured) {
  const next = {
    w: Math.max(0, Number(measured?.w) || 0),
    h: Math.max(0, Number(measured?.h) || 0),
  };
  if (!isUsableBoardStageSize(next)) {
    return isUsableBoardStageSize(previous) ? previous : null;
  }
  if (isTransientBoardStageCollapse(previous, next)) {
    return previous;
  }
  return next;
}

export function stabilizeHandExclusionPx(previous, measured) {
  const next = Math.max(0, Number(measured) || 0);
  const prev = Math.max(0, Number(previous) || 0);
  // Live dock sits below the felt. A sudden large overlap is a flex glitch.
  if (prev <= 0 && next > 24) return 0;
  return next;
}
