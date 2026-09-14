/**
 * DOM measurement of already-legal logical endpoints.
 * Geometry answers "which legal end is the pointer on?" — never legality.
 */
import { destinationTileId, resolveDestinationOutward } from "../game/destinationTarget.js";
import { usesAmericanBoardLayout } from "../board/index.js";

/**
 * @param {string[]} legalEnds
 * @param {object} layout
 * @returns {{ end: string, tileId: string, rect: DOMRect, outward: string|null }[]}
 */
export function collectDestinationTargets(legalEnds, layout) {
  if (!legalEnds?.length) return [];
  const american = usesAmericanBoardLayout(layout?.rulesetId);
  const targets = [];
  for (const end of legalEnds) {
    const tileId = destinationTileId(end, layout);
    if (!tileId) continue;
    const el = document.querySelector(`[data-board-tile="${tileId}"]`);
    if (!el) continue;
    const travelDir = el.getAttribute("data-travel-dir");
    const spinnerHub = Boolean(layout?.spinnerId && tileId === layout.spinnerId);
    targets.push({
      end,
      tileId,
      rect: el.getBoundingClientRect(),
      outward: resolveDestinationOutward(end, travelDir, { spinnerHub, american }),
    });
  }
  return targets;
}

export function highlightTileIdsForEnds(legalEnds, layout) {
  const ids = [];
  for (const end of legalEnds || []) {
    const id = destinationTileId(end, layout);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
