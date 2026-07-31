/**
 * Lightweight localStorage helpers for offline-first preferences.
 */

/**
 * @param {string} key
 * @param {string|null} [fallback=null]
 * @returns {string|null}
 */
export function readStorage(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota / private-mode failures — app still works in-session.
  }
}

/**
 * @param {string} key
 */
export function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}
