/**
 * Gameplay orientation — portrait is first-class V1 play.
 * Landscape is optional; never block the player behind a rotate prompt.
 */

/**
 * @param {{ width: number, height: number, coarsePointer?: boolean }} viewport
 * @returns {boolean} always false — V1 plays in portrait without rotation.
 */
export function shouldPromptLandscape(viewport) {
  void viewport;
  return false;
}

/**
 * Estimated leftover height for the green felt after chrome and the
 * Player 1 hand/control dock. Used by layout tests — keep in sync with gameplayLayout.
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
 * Player tray + Pase/New Match occupy a real hand dock, so they subtract
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
