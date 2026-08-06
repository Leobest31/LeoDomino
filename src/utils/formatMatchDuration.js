/**
 * Format elapsed match time as MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMatchDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
