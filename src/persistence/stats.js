/**
 * Offline career statistics.
 */

import { readStorage, writeStorage } from "../utils/storage.js";

export const STATS_STORAGE_KEY = "leodomino.stats";

export const DEFAULT_STATS = Object.freeze({
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  highestScore: 0,
  currentStreak: 0,
  bestStreak: 0,
  totalRoundPoints: 0,
  roundsPlayed: 0,
  lastFingerprint: "",
});

/**
 * @param {unknown} value
 * @returns {typeof DEFAULT_STATS}
 */
export function normalizeStats(value) {
  const raw = value && typeof value === "object" ? value : {};
  const num = (key, fallback = 0) => {
    const n = Number(raw[key]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    matchesPlayed: num("matchesPlayed"),
    wins: num("wins"),
    losses: num("losses"),
    highestScore: num("highestScore"),
    currentStreak: num("currentStreak"),
    bestStreak: num("bestStreak"),
    totalRoundPoints: num("totalRoundPoints"),
    roundsPlayed: num("roundsPlayed"),
    lastFingerprint: typeof raw.lastFingerprint === "string" ? raw.lastFingerprint : "",
  };
}

export function loadStats() {
  try {
    const raw = readStorage(STATS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATS };
    return normalizeStats(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATS };
  }
}

/**
 * @param {ReturnType<typeof normalizeStats>} stats
 */
export function saveStats(stats) {
  writeStorage(STATS_STORAGE_KEY, JSON.stringify(normalizeStats(stats)));
}

export function resetStats() {
  const next = { ...DEFAULT_STATS };
  saveStats(next);
  return next;
}

/**
 * @param {ReturnType<typeof normalizeStats>} stats
 * @returns {number}
 */
export function winPercentage(stats) {
  if (!stats.matchesPlayed) return 0;
  return Math.round((stats.wins / stats.matchesPlayed) * 1000) / 10;
}

/**
 * @param {ReturnType<typeof normalizeStats>} stats
 * @returns {number}
 */
export function averageRoundScore(stats) {
  if (!stats.roundsPlayed) return 0;
  return Math.round((stats.totalRoundPoints / stats.roundsPlayed) * 10) / 10;
}

/**
 * Record a finished round (points scored by the human this round).
 * @param {number} humanPoints
 * @param {string} fingerprint
 */
export function recordRound(humanPoints, fingerprint) {
  const stats = loadStats();
  const key = `round:${fingerprint}`;
  if (stats.lastFingerprint === key) return stats;
  const points = Math.max(0, Math.floor(Number(humanPoints) || 0));
  const next = {
    ...stats,
    totalRoundPoints: stats.totalRoundPoints + points,
    roundsPlayed: stats.roundsPlayed + 1,
    lastFingerprint: key,
  };
  saveStats(next);
  return next;
}

/**
 * Record a finished match.
 * @param {{ won: boolean, humanScore: number, fingerprint: string }} result
 */
export function recordMatch(result) {
  const stats = loadStats();
  const key = `match:${result.fingerprint}`;
  if (stats.lastFingerprint === key) return stats;

  const humanScore = Math.max(0, Math.floor(Number(result.humanScore) || 0));
  const won = Boolean(result.won);
  const currentStreak = won ? stats.currentStreak + 1 : 0;
  const next = {
    ...stats,
    matchesPlayed: stats.matchesPlayed + 1,
    wins: stats.wins + (won ? 1 : 0),
    losses: stats.losses + (won ? 0 : 1),
    highestScore: Math.max(stats.highestScore, humanScore),
    currentStreak,
    bestStreak: Math.max(stats.bestStreak, currentStreak),
    lastFingerprint: key,
  };
  saveStats(next);
  return next;
}
