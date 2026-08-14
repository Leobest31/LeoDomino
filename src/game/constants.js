/**
 * LeoDomino engine constants.
 * Pure data — no UI dependencies.
 */

/** Highest pip value on a double-six set. */
export const PIP_MAX = 6;

/** Total tiles in a double-six set: (n+1)(n+2)/2 = 28. */
export const TILE_COUNT = ((PIP_MAX + 1) * (PIP_MAX + 2)) / 2;

/** Tiles dealt to each player at the start of a round. */
export const HAND_SIZE = 7;

/** Default number of players for a standard match setup. */
export const DEFAULT_PLAYER_COUNT = 2;

/** Board ends used when attaching a tile to the chain (American adds N/S). */
export const END = Object.freeze({
  LEFT: "left",
  RIGHT: "right",
  NORTH: "north",
  SOUTH: "south",
});

/** Tile orientation on the table chain. */
export const ORIENTATION = Object.freeze({
  HORIZONTAL: "horizontal",
  VERTICAL: "vertical",
});
