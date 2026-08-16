/**
 * Offline match save / resume (localStorage).
 * Does not alter engine rules — only persists GameState snapshots.
 */

import { PHASE } from "../game/rules/constants.js";
import { MAX_PLAYER_COUNT, MIN_PLAYER_COUNT } from "../game/players.js";
import {
  DEFAULT_RULESET_ID,
  coerceRulesetId,
  isKnownRulesetId,
} from "../game/rulesets/index.js";
import { readStorage, writeStorage, removeStorage } from "../utils/storage.js";

export const MATCH_SAVE_KEY = "leodomino.match";
export const MATCH_SAVE_VERSION = 1;

/**
 * Clear orphan / invalid mustPlayTileId so draw/pass cannot softlock.
 * @param {object} state
 * @returns {object}
 */
export function sanitizeMatchState(state) {
  if (!state || typeof state !== "object") return state;
  const must = /** @type {{ mustPlayTileId?: unknown }} */ (state).mustPlayTileId;
  if (must == null) return state;

  const currentPlayer = /** @type {{ currentPlayer?: unknown }} */ (state).currentPlayer;
  const players = /** @type {{ players?: unknown }} */ (state).players;
  if (typeof currentPlayer !== "number" || !Array.isArray(players)) {
    return { ...state, mustPlayTileId: null };
  }

  const hand = players[currentPlayer]?.hand;
  if (typeof must === "string" && Array.isArray(hand) && hand.includes(must)) {
    return state;
  }

  return { ...state, mustPlayTileId: null };
}

/**
 * Claim a tile id into a unique partition; rejects duplicates / ghosts.
 * @param {unknown} id
 * @param {Record<string, unknown>} byId
 * @param {Set<string>} seen
 * @returns {boolean}
 */
function claimTileId(id, byId, seen) {
  if (typeof id !== "string" || !id) return false;
  if (!Object.prototype.hasOwnProperty.call(byId, id)) return false;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

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

  if (!Array.isArray(s.players)) return false;
  if (s.players.length < MIN_PLAYER_COUNT || s.players.length > MAX_PLAYER_COUNT) {
    return false;
  }

  if (!s.byId || typeof s.byId !== "object" || Array.isArray(s.byId)) return false;
  const byId = /** @type {Record<string, unknown>} */ (s.byId);

  if (!Array.isArray(s.board) || !Array.isArray(s.reserve)) return false;
  if (!Array.isArray(s.scores) || s.scores.length !== s.players.length) return false;

  for (const score of s.scores) {
    if (typeof score !== "number" || !Number.isFinite(score)) return false;
  }

  if (typeof s.round !== "number" || !Number.isFinite(s.round) || s.round < 1) return false;
  if (typeof s.targetScore !== "number" || !Number.isFinite(s.targetScore) || s.targetScore < 1) {
    return false;
  }
  if (typeof s.currentPlayer !== "number" || !Number.isInteger(s.currentPlayer)) return false;
  if (s.currentPlayer < 0 || s.currentPlayer >= s.players.length) return false;

  if (!s.phase || typeof s.phase !== "string") return false;
  const phases = Object.values(PHASE);
  if (!phases.includes(s.phase)) return false;

  /** @type {Set<string>} */
  const seen = new Set();

  for (const player of s.players) {
    if (!player || typeof player !== "object") return false;
    const hand = /** @type {{ hand?: unknown }} */ (player).hand;
    if (!Array.isArray(hand)) return false;
    for (const id of hand) {
      if (!claimTileId(id, byId, seen)) return false;
    }
  }

  for (const entry of s.board) {
    if (!entry || typeof entry !== "object") return false;
    const id = /** @type {{ id?: unknown }} */ (entry).id;
    if (!claimTileId(id, byId, seen)) return false;
  }

  for (const arm of [s.spinnerNorth, s.spinnerSouth]) {
    if (arm == null) continue;
    if (!Array.isArray(arm)) return false;
    for (const entry of arm) {
      if (!entry || typeof entry !== "object") return false;
      const id = /** @type {{ id?: unknown }} */ (entry).id;
      if (!claimTileId(id, byId, seen)) return false;
    }
  }

  for (const id of s.reserve) {
    if (!claimTileId(id, byId, seen)) return false;
  }

  // mustPlayTileId: null/undefined, or a tile still in the current player's hand
  if (s.mustPlayTileId != null) {
    if (typeof s.mustPlayTileId !== "string") return false;
    const hand = /** @type {{ hand: unknown[] }} */ (s.players[s.currentPlayer]).hand;
    if (!hand.includes(s.mustPlayTileId)) return false;
  }

  // rulesetId: missing is ok (migrate to legacy). Unknown id fails safely.
  if (s.rulesetId != null && !isKnownRulesetId(s.rulesetId)) return false;

  return true;
}

/**
 * Ensure state carries a known rulesetId. Missing → legacy. Unknown → null.
 * @param {object} state
 * @returns {object|null}
 */
export function normalizeStateRuleset(state) {
  if (!state || typeof state !== "object") return null;
  const coerced = coerceRulesetId(/** @type {{ rulesetId?: unknown }} */ (state).rulesetId);
  if (coerced == null) return null;
  if (/** @type {{ rulesetId?: unknown }} */ (state).rulesetId === coerced) return state;
  return { ...state, rulesetId: coerced };
}

/**
 * Drop a selected tile id that is no longer in the active seat's hand.
 * @param {object} state
 * @param {string|null} selectedId
 * @returns {string|null}
 */
export function sanitizeSelectedId(state, selectedId) {
  if (!selectedId || typeof selectedId !== "string") return null;
  const seat =
    typeof state?.currentPlayer === "number" ? state.currentPlayer : 0;
  const hand = state?.players?.[seat]?.hand;
  if (!Array.isArray(hand) || !hand.includes(selectedId)) return null;
  return selectedId;
}

/**
 * @param {object} payload
 * @param {object} payload.state
 * @param {string} payload.difficulty
 * @param {string|null} [payload.selectedId]
 * @param {number} [payload.matchStartedAt]
 */
export function saveMatch(payload) {
  if (!payload?.state) return;
  const state = normalizeStateRuleset(payload.state);
  if (!state) return;
  const rulesetId =
    typeof state.rulesetId === "string" && state.rulesetId
      ? state.rulesetId
      : DEFAULT_RULESET_ID;
  writeStorage(
    MATCH_SAVE_KEY,
    JSON.stringify({
      version: MATCH_SAVE_VERSION,
      savedAt: Date.now(),
      matchStartedAt:
        typeof payload.matchStartedAt === "number" && Number.isFinite(payload.matchStartedAt)
          ? payload.matchStartedAt
          : Date.now(),
      difficulty: payload.difficulty,
      rulesetId,
      selectedId: sanitizeSelectedId(state, payload.selectedId ?? null),
      state,
    })
  );
}

/**
 * @returns {{ state: object, difficulty: string, selectedId: string|null, savedAt: number, matchStartedAt: number, rulesetId: string }|null}
 */
export function loadMatch() {
  try {
    const raw = readStorage(MATCH_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state || typeof parsed.state !== "object") {
      clearMatchSave();
      return null;
    }

    // Softlock recovery before validation: clear orphan mustPlayTileId.
    parsed.state = sanitizeMatchState(parsed.state);

    // Old saves without rulesetId → legacy. Unknown id fails (rejected below).
    const normalized = normalizeStateRuleset(parsed.state);
    if (!normalized) {
      clearMatchSave();
      return null;
    }
    parsed.state = normalized;

    if (!isValidSavedMatch(parsed)) {
      clearMatchSave();
      return null;
    }

    const rulesetId =
      typeof parsed.state.rulesetId === "string" && parsed.state.rulesetId
        ? parsed.state.rulesetId
        : DEFAULT_RULESET_ID;

    return {
      state: parsed.state,
      difficulty: typeof parsed.difficulty === "string" ? parsed.difficulty : "medium",
      selectedId: sanitizeSelectedId(parsed.state, parsed.selectedId),
      savedAt: Number(parsed.savedAt) || 0,
      matchStartedAt:
        typeof parsed.matchStartedAt === "number" && Number.isFinite(parsed.matchStartedAt)
          ? parsed.matchStartedAt
          : Number(parsed.savedAt) || Date.now(),
      rulesetId,
    };
  } catch {
    clearMatchSave();
    return null;
  }
}

export function clearMatchSave() {
  removeStorage(MATCH_SAVE_KEY);
}
