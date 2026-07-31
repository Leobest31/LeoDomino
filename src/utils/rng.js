/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Keeps deals reproducible for tests, replay, and future online sync.
 */

/**
 * @param {number} seed
 * @returns {() => number} Function returning floats in [0, 1)
 */
export function createRng(seed = Date.now()) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle. Returns a new array; does not mutate the input.
 *
 * @template T
 * @param {T[]} items
 * @param {() => number} [rng] - values in [0, 1)
 * @returns {T[]}
 */
export function shuffle(items, rng = Math.random) {
  const result = items.slice();

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }

  return result;
}
