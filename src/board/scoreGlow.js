/**
 * Map logical scoring sides (tile.left / tile.right) onto painted halves.
 * Does not recalculate scores — only which visual half to glow.
 *
 * @param {{ swapped?: boolean }|null|undefined} display
 * @param {string[]|undefined} scoringSides
 * @returns {{ first: boolean, second: boolean }}
 */
export function displayGlowHalves(display, scoringSides) {
  const sides = new Set(Array.isArray(scoringSides) ? scoringSides : []);
  if (sides.has("both")) return { first: true, second: true };
  const wantLeft = sides.has("left");
  const wantRight = sides.has("right");
  if (display?.swapped) return { first: wantRight, second: wantLeft };
  return { first: wantLeft, second: wantRight };
}

/**
 * Merge highlight records by tile so a lone spinner can glow both halves.
 *
 * @param {object[]} highlights
 * @returns {Map<string, { scoringSides: string[], contribution: number }>}
 */
export function mergeScoreHighlights(highlights) {
  const byId = new Map();
  for (const item of highlights || []) {
    if (!item?.sourceTileId) continue;
    const prev = byId.get(item.sourceTileId) || {
      scoringSides: [],
      contribution: 0,
    };
    const nextSides = new Set(prev.scoringSides);
    for (const side of item.scoringSides || []) nextSides.add(side);
    if (item.scoringSide === "both") {
      nextSides.add("left");
      nextSides.add("right");
    } else if (item.scoringSide) {
      nextSides.add(item.scoringSide);
    }
    byId.set(item.sourceTileId, {
      scoringSides: [...nextSides],
      contribution: prev.contribution + (Number(item.contribution) || 0),
    });
  }
  return byId;
}
