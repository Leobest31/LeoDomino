/**
 * Local, account-ready Home profile — not a payment or online League system.
 * Values can later be replaced by a signed-in account without changing the UI.
 */

import { loadStats } from "./stats.js";
import { readStorage, writeStorage } from "../utils/storage.js";

export const HOME_PROFILE_KEY = "leodomino.homeProfile";

export const DEFAULT_HOME_PROFILE = Object.freeze({
  leoCoins: 250,
  lpMax: 100,
});

/**
 * @returns {{
 *   leoCoins: number,
 *   level: number,
 *   lp: number,
 *   lpMax: number,
 * }}
 */
export function loadHomeProfile() {
  const stats = loadStats();
  let stored = null;
  const raw = readStorage(HOME_PROFILE_KEY, null);
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const rawCoins = stored && typeof stored === "object" ? Number(stored.leoCoins) : NaN;
  const leoCoins = Number.isFinite(rawCoins)
    ? Math.max(0, Math.floor(rawCoins))
    : DEFAULT_HOME_PROFILE.leoCoins;
  const matches = Number(stats.matchesPlayed) || 0;
  const wins = Number(stats.wins) || 0;
  return {
    leoCoins,
    level: 1 + Math.floor(matches / 5),
    lp: Math.min(DEFAULT_HOME_PROFILE.lpMax, wins * 10),
    lpMax: DEFAULT_HOME_PROFILE.lpMax,
  };
}

/**
 * Persist only local virtual-currency demo state (never cash).
 * @param {Partial<{ leoCoins: number }>} patch
 */
export function saveHomeProfile(patch) {
  const current = loadHomeProfile();
  const next = {
    leoCoins:
      patch?.leoCoins != null && Number.isFinite(Number(patch.leoCoins))
        ? Math.max(0, Math.floor(Number(patch.leoCoins)))
        : current.leoCoins,
  };
  writeStorage(HOME_PROFILE_KEY, JSON.stringify(next));
  return loadHomeProfile();
}
