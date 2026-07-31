/** Reserved for shared utility helpers. */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
