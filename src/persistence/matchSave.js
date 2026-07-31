/**
 * Offline match save / resume (localStorage).
 * Does not alter engine rules — only persists GameState snapshots.
 */

import { PHASE } from "../game/rules/constants.js";
import { readStorage, writeStorage, removeStorage } from "../utils/storage.js";

export const MATCH_SAVE_KEY = "leodomino.match";
export const MATCH_SAVE_VERSION = 1;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSavedMatch(value) {
  if (!value || typeof value !== "object") return false;
  const raw = /** @type {Record<string, unknown>} */ (value);
  if (raw.version !== MATCH_SAVE_VERSION) return false;
  const state = raw.state;
  if (!state || typeof state !== "object") return false;
  const s = /** @type {Record<string, unknown>} */ (state);
  if (!Array.isArray(s.players) || s.players.length < 2) return false;
  if (!s.byId || typeof s.byId !== "object") return false;
  if (!Array.isArray(s.board) || !Array.isArray(s.reserve)) return false;
  if (!Array.isArray(s.scores) || s.scores.length !== s.players.length) return false;
  if (typeof s.round !== "number" || !Number.isFinite(s.round) || s.round < 1) return false;
  if (typeof s.targetScore !== "number" || !Number.isFinite(s.targetScore) || s.targetScore < 1) {
    return false;
  }
  if (typeof s.currentPlayer !== "number" || s.currentPlayer < 0 || s.currentPlayer >= s.players.length) {
    return false;
  }
  if (!s.phase || typeof s.phase !== "string") return false;
  const phases = Object.values(PHASE);
  if (!phases.includes(s.phase)) return false;

  for (const player of s.players) {
    if (!player || typeof player !== "object") return false;
    const hand = /** @type {{ hand?: unknown }} */ (player).hand;
    if (!Array.isArray(hand)) return false;
  }

  return true;
}

/**
 * Drop a selected tile id that is no longer in the human hand.
 * @param {object} state
 * @param {string|null} selectedId
 * @returns {string|null}
 */
export function sanitizeSelectedId(state, selectedId) {
  if (!selectedId || typeof selectedId !== "string") return null;
  const hand = state?.players?.[0]?.hand;
  if (!Array.isArray(hand) || !hand.includes(selectedId)) return null;
  return selectedId;
}

/**
 * @param {object} payload
 * @param {object} payload.state
 * @param {string} payload.difficulty
 * @param {string|null} [payload.selectedId]
 */
export function saveMatch(payload) {
  if (!payload?.state) return;
  writeStorage(
    MATCH_SAVE_KEY,
    JSON.stringify({
      version: MATCH_SAVE_VERSION,
      savedAt: Date.now(),
      difficulty: payload.difficulty,
      selectedId: sanitizeSelectedId(payload.state, payload.selectedId ?? null),
      state: payload.state,
    })
  );
}

/**
 * @returns {{ state: object, difficulty: string, selectedId: string|null, savedAt: number }|null}
 */
export function loadMatch() {
  try {
    const raw = readStorage(MATCH_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidSavedMatch(parsed)) {
      clearMatchSave();
      return null;
    }
    return {
      state: parsed.state,
      difficulty: typeof parsed.difficulty === "string" ? parsed.difficulty : "medium",
      selectedId: sanitizeSelectedId(parsed.state, parsed.selectedId),
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    clearMatchSave();
    return null;
  }
}

export function clearMatchSave() {
  removeStorage(MATCH_SAVE_KEY);
}
