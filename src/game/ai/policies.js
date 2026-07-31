/**
 * Difficulty-specific move selection policies.
 */

import { createRng } from "../../utils/rng.js";
import { getAvailableActions } from "../rules/drawDominoes.js";
import { getDifficultyConfig, normalizeDifficulty } from "./difficulties.js";
import { scoreMove } from "./evaluate.js";
import { boardFingerprint, buildMemory } from "./memory.js";

/**
 * @typedef {{ type: "play"|"draw"|"pass", tileId?: string, end?: string }} AiAction
 */

/**
 * Pick an action that is always legal for the current player.
 *
 * @param {object} state
 * @param {object} [options]
 * @param {string} [options.difficulty]
 * @param {number} [options.aiIndex]
 * @param {number} [options.seed] - Overrides state.seed for determinism tests
 * @returns {AiAction|null}
 */
export function chooseAiAction(state, options = {}) {
  const difficulty = normalizeDifficulty(options.difficulty);
  const aiIndex = options.aiIndex ?? state.currentPlayer;
  const actions = getAvailableActions(state);

  if (actions.canDraw && !actions.canPlay) return { type: "draw" };
  if (actions.canPass && !actions.canPlay) return { type: "pass" };
  if (!actions.canPlay) return null;

  const memory = buildMemory(state, aiIndex);
  const cfg = getDifficultyConfig(difficulty);
  const rng = createRng(deriveSeed(state, options.seed, difficulty));

  const scored = actions.legalMoves.map((move) => ({
    move,
    score: scoreMove(state, move, aiIndex, difficulty, memory),
  }));

  scored.sort((a, b) => b.score - a.score);

  const picked = pickByDifficulty(scored, cfg, rng, difficulty);
  return {
    type: "play",
    tileId: picked.move.tileId,
    end: picked.move.end,
  };
}

/**
 * @param {Array<{ move: object, score: number }>} scored
 * @param {object} cfg
 * @param {() => number} rng
 * @param {string} difficulty
 */
function pickByDifficulty(scored, cfg, rng, difficulty) {
  if (!scored.length) {
    throw new Error("No scored moves");
  }

  // Beginner: often ignore ranking entirely
  if (difficulty === "beginner") {
    if (rng() < cfg.mistakeRate) {
      return scored[Math.floor(rng() * scored.length)];
    }
    // Otherwise still noisy among bottom-biased set
    const worstHalf = scored.slice(Math.floor(scored.length / 2));
    const pool = worstHalf.length ? worstHalf : scored;
    return pool[Math.floor(rng() * pool.length)];
  }

  // Easy: soft preference for better scores
  if (difficulty === "easy") {
    if (rng() < cfg.mistakeRate) {
      return scored[Math.floor(rng() * scored.length)];
    }
    const top = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.5)));
    return weightedPick(top, cfg.noise, rng);
  }

  // Medium+: usually best, rare mistakes, light noise among near-ties
  if (rng() < cfg.mistakeRate) {
    const index = Math.min(scored.length - 1, 1 + Math.floor(rng() * Math.min(3, scored.length - 1)));
    return scored[index];
  }

  const best = scored[0].score;
  const near = scored.filter((entry) => best - entry.score <= 2.5 + cfg.noise * 4);
  return weightedPick(near.length ? near : [scored[0]], cfg.noise, rng);
}

/**
 * @param {Array<{ move: object, score: number }>} pool
 * @param {number} noise
 * @param {() => number} rng
 */
function weightedPick(pool, noise, rng) {
  if (pool.length === 1) return pool[0];
  const weights = pool.map((entry) => {
    const jitter = (rng() - 0.5) * noise * 2;
    return Math.exp(entry.score * 0.15 + jitter);
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Deterministic seed mix from match + public board fingerprint + difficulty.
 * @param {object} state
 * @param {number} [override]
 * @param {string} difficulty
 */
function deriveSeed(state, override, difficulty) {
  const base = override ?? state.seed ?? 1;
  const fp = boardFingerprint(state);
  let mix = base >>> 0;
  for (let i = 0; i < fp.length; i += 1) {
    mix = (Math.imul(mix ^ fp.charCodeAt(i), 0x01000193) >>> 0);
  }
  for (let i = 0; i < difficulty.length; i += 1) {
    mix = (Math.imul(mix ^ difficulty.charCodeAt(i), 0x01000193) >>> 0);
  }
  return mix >>> 0;
}

/**
 * Natural thinking delay (ms), deterministic for a given state + difficulty + seed.
 * Clamped to commercial range 500–1500ms.
 *
 * @param {object} state
 * @param {string} difficulty
 * @param {number} [seed]
 * @returns {number}
 */
export function chooseThinkTimeMs(state, difficulty, seed) {
  const cfg = getDifficultyConfig(difficulty);
  const rng = createRng(deriveSeed(state, seed, `${difficulty}:think`));
  const span = Math.max(0, cfg.thinkMaxMs - cfg.thinkMinMs);
  const ms = cfg.thinkMinMs + Math.floor(rng() * (span + 1));
  return Math.min(1500, Math.max(500, ms));
}
