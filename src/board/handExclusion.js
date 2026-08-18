/**
 * Player-hand exclusion zone — layout-only safety net.
 *
 * Live GamePage keeps Player 1's tray in a dedicated dock *below* the felt,
 * so the overlap is 0. If a dock still overlaps the board stage (tests,
 * older shells), played tiles stay above that overlay.
 */

/** Extra gap so a board bone cannot visually kiss the hand tiles. */
export const HAND_EXCLUSION_GAP_PX = 12;

/**
 * Overlap of the hand/action dock on the board stage, plus clearance.
 * @param {{ bottom: number } | null | undefined} stageRect
 * @param {{ top: number } | null | undefined} dockRect
 * @returns {number} pixels to subtract from the playable felt bottom
 */
export function measureHandExclusionPx(stageRect, dockRect) {
  if (!stageRect || !dockRect) return 0;
  const overlap = Number(stageRect.bottom) - Number(dockRect.top);
  if (!Number.isFinite(overlap) || overlap <= 0) return 0;
  return overlap + HAND_EXCLUSION_GAP_PX;
}
