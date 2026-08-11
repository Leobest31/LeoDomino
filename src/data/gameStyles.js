/**
 * UI game-style catalog — single import path for Setup / Game Style screens.
 * Source of truth remains `game/rulesets`
 * (classic→legacy, haitian→haitian, american→american, allFives→allFives,
 *  dominican→dominican, puertorican→puertorican).
 * Add future regional variants in the registry only; Configuration stays a single row.
 */

export {
  GAME_STYLES,
  DEFAULT_GAME_STYLE_ID,
  DEFAULT_RULESET_ID,
  RULESET_STORAGE_KEY,
  getGameStyle,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
  isGameStyleCompatibleWithPlayerCount,
  listAvailableGameStyles,
  listGameStyles,
  normalizeGameStyleId,
  normalizeRulesetId,
} from "../game/rulesets/index.js";

/**
 * Offline SVG flags keyed by ISO 3166-1 alpha-2.
 * Used so platforms that render regional-indicator emoji as letters (e.g. "HT")
 * still show a real flag glyph next to the style name.
 */
const COUNTRY_FLAG_SVG = Object.freeze({
  HT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="12" fill="#00209F"/><rect y="12" width="36" height="12" fill="#D21034"/><rect x="13" y="7" width="10" height="10" fill="#fff"/></svg>`,
  US: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#B22234"/><rect y="1.85" width="36" height="1.85" fill="#fff"/><rect y="5.54" width="36" height="1.85" fill="#fff"/><rect y="9.23" width="36" height="1.85" fill="#fff"/><rect y="12.92" width="36" height="1.85" fill="#fff"/><rect y="16.62" width="36" height="1.85" fill="#fff"/><rect y="20.31" width="36" height="1.85" fill="#fff"/><rect width="14.4" height="12.92" fill="#3C3B6E"/></svg>`,
  DO: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#fff"/><rect width="14.4" height="9.6" fill="#002D62"/><rect x="21.6" width="14.4" height="9.6" fill="#CE1126"/><rect y="14.4" width="14.4" height="9.6" fill="#CE1126"/><rect x="21.6" y="14.4" width="14.4" height="9.6" fill="#002D62"/><circle cx="18" cy="12" r="3.2" fill="#fff"/><circle cx="18" cy="12" r="2.2" fill="#006300"/></svg>`,
  PR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24"><rect width="36" height="24" fill="#EDE016"/><rect width="36" height="4.8" fill="#ED0000"/><rect y="9.6" width="36" height="4.8" fill="#ED0000"/><rect y="19.2" width="36" height="4.8" fill="#ED0000"/><polygon points="0,0 14.4,12 0,24" fill="#0050F0"/><polygon points="4.8,12 6.6,17.2 2.1,14 7.5,14 3,17.2" fill="#fff"/></svg>`,
});

/**
 * ISO 3166-1 alpha-2 → regional-indicator flag emoji (e.g. HT → 🇭🇹).
 * @param {string|null|undefined} countryCode
 * @returns {string}
 */
export function flagEmojiFromCountryCode(countryCode) {
  if (typeof countryCode !== "string" || countryCode.length !== 2) return "";
  const cc = countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + cc.charCodeAt(0) - 65,
    base + cc.charCodeAt(1) - 65
  );
}

/**
 * @param {{ countryCode?: string|null }|null|undefined} style
 * @returns {string}
 */
export function gameStyleFlagEmoji(style) {
  return flagEmojiFromCountryCode(style?.countryCode);
}

/**
 * Data-URI SVG for platforms that cannot render emoji flags as images.
 * @param {{ countryCode?: string|null }|null|undefined} style
 * @returns {string}
 */
export function gameStyleFlagDataUrl(style) {
  const cc =
    typeof style?.countryCode === "string" ? style.countryCode.toUpperCase() : "";
  if (!cc || !COUNTRY_FLAG_SVG[cc]) return "";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(COUNTRY_FLAG_SVG[cc])}`;
}
