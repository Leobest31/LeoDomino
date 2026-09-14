/**
 * Authenticated / preview Home LVL strip subtitle.
 * Requires LEOPIPS_COPY.maxLevel + winsToNextLevel contract (no silent omit).
 */
export function leoPipsHomeLevelSubText({
  maxed,
  rank,
  winsInLevel,
  nextLevel,
  copy,
}) {
  const wins = Math.max(0, Math.floor(Number(winsInLevel) || 0));
  const rankLabel = rank == null || rank === "" ? "" : String(rank);
  if (typeof copy?.maxLevel !== "string" || !copy.maxLevel) {
    throw new TypeError("LEOPIPS_COPY.maxLevel must be a non-empty string");
  }
  if (typeof copy?.winsToNextLevel !== "function") {
    throw new TypeError("LEOPIPS_COPY.winsToNextLevel must be a function");
  }
  if (maxed) {
    return `${rankLabel ? `${rankLabel} · ` : ""}${copy.maxLevel}`;
  }
  if (rankLabel) {
    return `${rankLabel} · ${wins}/10`;
  }
  const nextRaw = nextLevel == null || nextLevel === "" ? 1 : Number(nextLevel);
  const next = Number.isFinite(nextRaw) && nextRaw > 0 ? Math.floor(nextRaw) : 1;
  return copy.winsToNextLevel(wins, next);
}
