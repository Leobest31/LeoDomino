/**
 * dominoBitmapCache verification (Node — no real `document`/canvas).
 * Run: node src/render/dominoBitmapCache.test.js
 *
 * `createSurface` and `paint` are injected fakes throughout, so this
 * suite covers cache-key stability, hit/miss behavior, and capacity
 * eviction without needing a real browser Canvas implementation.
 */
import assert from "node:assert/strict";
import { buildDominoCacheKey, createDominoBitmapCache } from "./dominoBitmapCache.js";

const baseParams = {
  left: 3,
  right: 5,
  faceDown: false,
  orientation: "vertical",
  selected: false,
  size: "md",
  cssWidth: 32,
  cssHeight: 64,
  dpr: 2,
};

// 1. Key stability — identical logical params produce identical keys.
{
  const a = buildDominoCacheKey(baseParams);
  const b = buildDominoCacheKey({ ...baseParams });
  assert.equal(a, b);
}

// 2. Sub-pixel jitter (ResizeObserver noise) must not fragment the key.
{
  const a = buildDominoCacheKey(baseParams);
  const b = buildDominoCacheKey({ ...baseParams, cssWidth: 32.1, cssHeight: 63.92, dpr: 2.03 });
  assert.equal(a, b, "sub-half-pixel/quarter-dpr jitter should round into the same bucket");
}

// 3. Every param that changes the visual output must change the key.
{
  const variants = [
    { ...baseParams, left: 4 },
    { ...baseParams, right: 6 },
    { ...baseParams, faceDown: true },
    { ...baseParams, orientation: "horizontal" },
    { ...baseParams, selected: true },
    { ...baseParams, size: "sm" },
    { ...baseParams, cssWidth: 40 },
    { ...baseParams, cssHeight: 80 },
    { ...baseParams, dpr: 1 },
  ];
  const baseKey = buildDominoCacheKey(baseParams);
  const keys = new Set([baseKey, ...variants.map(buildDominoCacheKey)]);
  assert.equal(keys.size, variants.length + 1, "each distinguishing param must yield a distinct key");
}

/** Fake surface: just enough shape for the cache to treat it as a canvas. */
function makeFakeSurface() {
  const ctx = {
    save() {},
    restore() {},
    scale() {},
  };
  return { getContext: () => ctx };
}

function makeSpyPaint() {
  const calls = [];
  const paint = (ctx, options) => {
    calls.push(options);
  };
  paint.calls = calls;
  return paint;
}

// 4. Cache hit: identical params paint exactly once, return the same surface.
{
  const paint = makeSpyPaint();
  const cache = createDominoBitmapCache({ createSurface: makeFakeSurface, paint });

  const first = cache.getOrCreate(baseParams);
  const second = cache.getOrCreate({ ...baseParams });

  assert.equal(paint.calls.length, 1, "second request with identical params must be a cache hit");
  assert.equal(first, second, "cache hit must return the exact same surface instance");
  assert.equal(cache.size(), 1);
}

// 5. Cache miss: a different tile paints again and is stored separately.
{
  const paint = makeSpyPaint();
  const cache = createDominoBitmapCache({ createSurface: makeFakeSurface, paint });

  cache.getOrCreate(baseParams);
  cache.getOrCreate({ ...baseParams, left: 1, right: 1 });

  assert.equal(paint.calls.length, 2);
  assert.equal(cache.size(), 2);
}

// 6. Capacity eviction: oldest entry is dropped once capacity is exceeded.
{
  const paint = makeSpyPaint();
  const cache = createDominoBitmapCache({ createSurface: makeFakeSurface, paint, capacity: 2 });

  const keyed = (n) => ({ ...baseParams, left: n, right: n });
  cache.getOrCreate(keyed(0));
  cache.getOrCreate(keyed(1));
  assert.equal(cache.size(), 2);

  cache.getOrCreate(keyed(2));
  assert.equal(cache.size(), 2, "cache must never grow past its configured capacity");
  assert.equal(cache.has(keyed(0)), false, "oldest entry should have been evicted");
  assert.equal(cache.has(keyed(1)), true);
  assert.equal(cache.has(keyed(2)), true);

  // Re-requesting the evicted entry is a fresh paint (miss), not reused.
  cache.getOrCreate(keyed(0));
  assert.equal(paint.calls.length, 4, "re-requesting an evicted key must repaint");
}

// 7. Pixel dimensions passed to createSurface honor cssWidth/cssHeight * dpr.
{
  const seen = [];
  const createSurface = (pw, ph) => {
    seen.push([pw, ph]);
    return makeFakeSurface();
  };
  const cache = createDominoBitmapCache({ createSurface, paint: makeSpyPaint() });
  cache.getOrCreate({ ...baseParams, cssWidth: 30, cssHeight: 60, dpr: 3 });
  assert.deepEqual(seen[0], [90, 180]);
}

console.log("dominoBitmapCache: all checks passed");
