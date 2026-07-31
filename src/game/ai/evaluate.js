/**
 * Score candidate plays for the AI.
 */

import { getOpenEnds } from "../board.js";
import { handPipTotal } from "../rules/scoring.js";
import { playTile } from "../rules/drawDominoes.js";
import { getDifficultyConfig } from "./difficulties.js";
import { opponentMatchProbability } from "./memory.js";

/**
 * @param {object} state
 * @param {{ tileId: string, end: string }} move
 * @param {number} aiIndex
 * @param {string} difficulty
 * @param {object} memory
 * @returns {number} Higher is better for the AI
 */
export function scoreMove(state, move, aiIndex, difficulty, memory) {
  const cfg = getDifficultyConfig(difficulty);
  const tile = state.byId[move.tileId];
  if (!tile) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const pips = tile.a + tile.b;
  const handSize = state.players[aiIndex].hand.length;
  const oppSize = memory.opponentHandSize;
  const isOpening = !state.board.length;

  // Free opener (round 2+): slight preference for stronger tiles / doubles.
  if (isOpening && !state.mustPlayTileId) {
    if (tile.isDouble) score += 12 + tile.a * 2;
    else score += tile.b * 1.2 + tile.a * 0.4;
  }

  // --- Always useful: dump exposure (heavier when hand is large) ---
  score += pips * (0.55 + Math.min(handSize, 7) * 0.08);

  // Prefer emptying the hand
  if (handSize === 1) score += 500;

  // Simulate resulting ends / hand pips when safe
  let next = null;
  try {
    next = playTile(state, move.tileId, move.end);
  } catch {
    return Number.NEGATIVE_INFINITY;
  }

  const nextHand = next.players[aiIndex].hand;
  const remainingPips = handPipTotal(nextHand, state.byId);
  score -= remainingPips * 0.35;

  const ends = getOpenEnds(next.board);

  // --- Medium+: don't gift hot pips ---
  if (cfg.trackTiles) {
    const leftHeat = memory.pipRemaining[ends.left] ?? 0;
    const rightHeat = memory.pipRemaining[ends.right] ?? 0;
    score -= (leftHeat + rightHeat) * 0.45;

    // Playing a double: valuable control — soft bonus if it matches a scarce pip
    if (tile.isDouble) {
      const control = memory.matchingTileCounts[tile.a] ?? 0;
      if (cfg.preserveDoubles && handSize > 3 && control >= 2) {
        score -= 6; // keep powerful doubles early
      } else {
        score += 2;
      }
    }
  }

  // --- Hard/Expert: probabilities + blocking ---
  if (cfg.useProbabilities) {
    const pLeft = opponentMatchProbability(ends.left, memory);
    const pRight = opponentMatchProbability(ends.right, memory);
    // Prefer ends the opponent is less likely to answer
    score -= (pLeft + pRight) * 14;

    if (cfg.blockAggressively && oppSize <= 3) {
      score -= Math.max(pLeft, pRight) * 22;
      // Bonus for leaving a pip with zero unknown matches
      if ((memory.matchingTileCounts[ends.left] ?? 0) === 0) score += 18;
      if ((memory.matchingTileCounts[ends.right] ?? 0) === 0) score += 18;
    }

    // Late game: dump more aggressively
    if (handSize <= 3) score += pips * 0.9;

    // Preserve spinner-like doubles when we still hold several of that suit
    if (cfg.preserveDoubles && tile.isDouble) {
      const suitLeftInHand = nextHand.filter((id) => {
        const t = state.byId[id];
        return t && (t.a === tile.a || t.b === tile.a);
      }).length;
      if (suitLeftInHand >= 2 && handSize > 2) score -= 10;
    }
  }

  // Slight preference to play on the end that reduces our future options less
  // (keep diversity of pips in hand)
  const pipDiversity = new Set();
  for (const id of nextHand) {
    const t = state.byId[id];
    if (!t) continue;
    pipDiversity.add(t.a);
    pipDiversity.add(t.b);
  }
  score += pipDiversity.size * 0.8;

  // Tiny deterministic tie spice from tile id (not random)
  score += tieBreak(move.tileId, move.end) * 0.001;

  return score;
}

function tieBreak(tileId, end) {
  let h = 0;
  const s = `${tileId}:${end}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 1000;
}
