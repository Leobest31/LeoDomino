/**
 * Gameplay orientation — portrait devices should rotate to landscape.
 * Pure helpers so match state is never tied to viewport math.
 */

/**
 * @param {{ width: number, height: number, coarsePointer?: boolean }} viewport
 * @returns {boolean} true when a phone/tablet is in portrait and should
 *   see the rotate prompt instead of a squeezed board.
 */
export function shouldPromptLandscape(viewport) {
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  if (width < 1 || height < 1) return false;
  const portrait = height > width;
  if (!portrait) return false;
  // Desktop mouse/keyboard windows may be tall; never block them.
  if (viewport?.coarsePointer === false) return false;
  if (viewport?.coarsePointer === true) return true;
  // Unknown pointer: still prompt on compact portrait frames (phones/tablets).
  return width <= 1200;
}

/**
 * Estimated leftover height for the green felt after chrome and the bottom
 * hand/control dock. Used by layout tests — keep in sync with gameplayLayout.
 */
export function estimateFeltHeight(viewportHeight, chrome) {
  const h = Number(viewportHeight) || 0;
  const used =
    (Number(chrome?.padding) || 0) +
    (Number(chrome?.header) || 0) +
    (Number(chrome?.player) || 0) +
    (Number(chrome?.bottom) || 0);
  return Math.max(0, h - used);
}

/** Representative tablet-landscape chrome before the exclusive-felt stack. */
export const TABLET_LANDSCAPE_CHROME_BEFORE = {
  padding: 8,
  header: 132,
  player: 96,
  bottom: 118,
};

/**
 * Representative tablet-landscape chrome after the exclusive felt stack.
 * Player tray + Pase/New Match occupy a real bottom dock, so they subtract
 * from felt height instead of overlaying the green table.
 */
export const TABLET_LANDSCAPE_CHROME_AFTER = {
  padding: 8,
  header: 132,
  player: 0,
  bottom: 78,
};

/** Playable felt height on the previous overlay layout pass. */
export const TABLET_LANDSCAPE_FELT_HEIGHT_PREV_PX = 522;
