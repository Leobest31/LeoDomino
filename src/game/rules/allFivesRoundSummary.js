/**
 * All Fives round-end presentation — visual counting of remaining hands.
 * Does not award points. The engine result is calculated once; this module
 * only describes how to show it.
 */

export const ROUND_SUMMARY_TILE_MS = 750;
export const ROUND_SUMMARY_HOLD_MS = 2000;

/**
 * Flatten contributing hands in seat order (skipping the winner).
 * Each tile is counted exactly once.
 *
 * @param {{ hands?: { playerIndex: number, tiles: { id: string, pips: number }[] }[] }} explanation
 * @returns {{ id: string, left: number, right: number, pips: number, playerIndex: number }[]}
 */
export function flattenRoundSummaryTiles(explanation) {
  const hands = Array.isArray(explanation?.hands) ? explanation.hands : [];
  const tiles = [];
  for (const hand of hands) {
    const playerIndex = Number(hand.playerIndex);
    for (const tile of hand.tiles || []) {
      if (!tile?.id) continue;
      tiles.push({
        id: tile.id,
        left: Number(tile.left) || 0,
        right: Number(tile.right) || 0,
        pips: Number(tile.pips) || 0,
        playerIndex,
      });
    }
  }
  return tiles;
}

/**
 * Snapshot of the counting animation at `elapsedMs`.
 *
 * @param {object} explanation
 * @param {number} elapsedMs
 * @param {{ tileMs?: number, holdMs?: number }} [timing]
 */
export function roundSummaryView(explanation, elapsedMs, timing = {}) {
  const tileMs = Math.max(1, Number(timing.tileMs) || ROUND_SUMMARY_TILE_MS);
  const holdMs = Math.max(0, Number(timing.holdMs) || ROUND_SUMMARY_HOLD_MS);
  const sequence = flattenRoundSummaryTiles(explanation);
  const awarded = Number(explanation?.awarded) || 0;
  const rawTotal = Number(explanation?.rawTotal) || 0;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const countEnd = sequence.length * tileMs;

  const base = {
    sequence,
    hands: Array.isArray(explanation?.hands) ? explanation.hands : [],
    awarded,
    rawTotal,
    winnerIndex:
      explanation?.winnerIndex == null ? null : Number(explanation.winnerIndex),
  };

  if (sequence.length === 0) {
    if (elapsed < holdMs) {
      return {
        ...base,
        stage: "final",
        activeIndex: -1,
        activeTileId: null,
        rawVisible: rawTotal,
        showAward: true,
        hudLag: true,
        done: false,
      };
    }
    return {
      ...base,
      stage: "done",
      activeIndex: -1,
      activeTileId: null,
      rawVisible: rawTotal,
      showAward: false,
      hudLag: false,
      done: true,
    };
  }

  if (elapsed < countEnd) {
    const index = Math.min(sequence.length - 1, Math.floor(elapsed / tileMs));
    const rawVisible = sequence
      .slice(0, index + 1)
      .reduce((sum, tile) => sum + tile.pips, 0);
    return {
      ...base,
      stage: "counting",
      activeIndex: index,
      activeTileId: sequence[index].id,
      rawVisible,
      showAward: false,
      hudLag: true,
      done: false,
    };
  }

  if (elapsed < countEnd + holdMs) {
    return {
      ...base,
      stage: "final",
      activeIndex: -1,
      activeTileId: null,
      rawVisible: rawTotal,
      showAward: true,
      hudLag: true,
      done: false,
    };
  }

  return {
    ...base,
    stage: "done",
    activeIndex: -1,
    activeTileId: null,
    rawVisible: rawTotal,
    showAward: false,
    hudLag: false,
    done: true,
  };
}

/**
 * HUD scores while the round-summary hold is showing the previous total.
 *
 * @param {object} options
 * @param {number[]} options.scores
 * @param {number|null} [options.winnerIndex]
 * @param {number} [options.points]
 * @param {boolean} [options.hudLag]
 * @returns {number[]}
 */
export function hudScoresDuringRoundSummary({
  scores,
  winnerIndex = null,
  points = 0,
  hudLag = false,
}) {
  if (!Array.isArray(scores)) return [];
  const pts = Number(points) || 0;
  if (!hudLag || winnerIndex == null || pts <= 0) return scores.slice();
  return scores.map((score, index) =>
    index === winnerIndex ? score - pts : score
  );
}

/**
 * True when this round-over state should run the felt counting presentation.
 *
 * @param {object} [state]
 * @returns {boolean}
 */
export function usesAllFivesRoundSummary(state) {
  return Boolean(state?.roundResult?.summary) && state?.phase === "roundOver";
}
