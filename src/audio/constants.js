/** Audio preference keys & sound catalog. */

export const AUDIO_STORAGE_KEY = "leodomino.audio";

export const DEFAULT_AUDIO_PREFS = Object.freeze({
  volume: 0.55,
  muted: false,
  ambient: false,
});

/** @typedef {typeof SOUND_IDS[number]} SoundId */

export const SOUND_IDS = Object.freeze([
  "place",
  "pickup",
  "draw",
  "button",
  "menuOpen",
  "menuClose",
  "aiMove",
  "turn",
  "roundWin",
  "matchWin",
  "defeat",
  "error",
  "ambient",
]);

/**
 * @param {unknown} value
 * @returns {typeof DEFAULT_AUDIO_PREFS}
 */
export function normalizeAudioPrefs(value) {
  const raw = value && typeof value === "object" ? value : {};
  const volume = Number(raw.volume);
  return {
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_AUDIO_PREFS.volume,
    muted: Boolean(raw.muted),
    ambient: Boolean(raw.ambient),
  };
}
