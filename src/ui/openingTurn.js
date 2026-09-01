/**
 * Forced-opening HUD / hand UX. Display only — does not change engine legality.
 */

/**
 * Required opener for the current player, or null when the lock is inactive.
 * @param {{ isTurn?: boolean, mustPlayTileId?: string|null }} [opts]
 * @returns {string|null}
 */
export function forcedOpeningTileId({ isTurn = false, mustPlayTileId = null } = {}) {
  if (!isTurn) return null;
  return typeof mustPlayTileId === "string" && mustPlayTileId ? mustPlayTileId : null;
}

/**
 * Whether a hand tile should look and receive pointer handlers.
 * When mustPlayTileId is set, only that tile is interactable.
 * After it clears, this helper does not restrict (existing later-turn UX).
 *
 * @param {{
 *   isTurn?: boolean,
 *   mustPlayTileId?: string|null,
 *   tileId?: string|null,
 *   legalMoves?: Array<{ tileId?: string }>|null,
 * }} [opts]
 */
export function handTileIsInteractable({
  isTurn = false,
  mustPlayTileId = null,
  tileId = null,
  legalMoves = null,
} = {}) {
  if (!isTurn || !tileId) return false;
  const must = forcedOpeningTileId({ isTurn: true, mustPlayTileId });
  if (!must) return true;
  if (tileId !== must) return false;
  if (Array.isArray(legalMoves) && legalMoves.length > 0) {
    return legalMoves.some((move) => move?.tileId === must);
  }
  return true;
}

/**
 * Localized "Play 2-2 to open the round." or null when the lock is inactive.
 * @param {(key: string, vars?: Record<string, string>) => string} t
 * @param {{ isTurn?: boolean, mustPlayTileId?: string|null }} [opts]
 * @returns {string|null}
 */
export function openingTurnStatus(t, { isTurn = false, mustPlayTileId = null } = {}) {
  const tile = forcedOpeningTileId({ isTurn, mustPlayTileId });
  if (!tile || typeof t !== "function") return null;
  return t("game.playToOpenRound", { tile });
}
