/**
 * Human-player avatar ids persisted on the local account.
 * Artwork lives in avatars.media.js so Node auth tests do not import PNGs.
 * LeoBest's lion is a system avatar and must never appear here.
 */
export const PLAYER_AVATAR_IDS = Object.freeze([
  "marcus",
  "rafael",
  "andre",
  "noah",
  "jamal",
  "diego",
  "kenji",
  "theo",
  "luca",
  "owen",
  "amina",
  "sofia",
  "priya",
  "elena",
  "nia",
  "yara",
  "mei",
  "isla",
  "zara",
  "carmen",
]);

export const DEFAULT_AVATAR_ID = PLAYER_AVATAR_IDS[0];
export const LEOBEST_AVATAR_ID = "leobest-lion";

export function isPlayerAvatarId(id) {
  return PLAYER_AVATAR_IDS.includes(id);
}

export function normalizeAvatarId(id) {
  return isPlayerAvatarId(id) ? id : DEFAULT_AVATAR_ID;
}
