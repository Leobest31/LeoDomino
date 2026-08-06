/**
 * DominoBitmapPainter verification (Node — no real Canvas 2D available).
 * Run: node src/render/DominoBitmapPainter.test.js
 *
 * Exercises the painter against a lightweight fake context that records
 * every method call instead of rendering real pixels. That's enough to
 * prove the two properties a bitmap cache actually depends on:
 *   1. it never throws for any tile/orientation/state combination, and
 *   2. it is deterministic — identical options always produce the
 *      identical sequence of draw calls, so "same cache key" really
 *      does mean "same pixels".
 */
import assert from "node:assert/strict";
import { paintDominoTile, PIP_LAYOUT } from "./DominoBitmapPainter.js";

/**
 * A gradient handle that holds only plain data (no per-instance function
 * closures). `addColorStop` lives on the shared class prototype, so two
 * separately-constructed fakes with the same `stops` content compare
 * equal under `assert.deepEqual` — required for the determinism check
 * below, since a gradient object can end up embedded inside a recorded
 * `set:fillStyle` call.
 */
class FakeGradient {
  constructor() {
    this.stops = [];
  }

  addColorStop(offset, color) {
    this.stops.push([offset, color]);
  }
}

/** Records every call made on it; every other member is a permissive no-op/stub. */
function createFakeCtx() {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, args]);
    return undefined;
  };

  const ctx = { calls };
  const methods = [
    "save", "restore", "clearRect", "fillRect", "clip",
    "beginPath", "moveTo", "lineTo", "arcTo", "arc", "closePath",
    "fill", "stroke", "scale", "translate", "rotate",
  ];
  for (const name of methods) ctx[name] = record(name);
  ctx.createLinearGradient = (...args) => {
    calls.push(["createLinearGradient", args]);
    return new FakeGradient();
  };
  ctx.createRadialGradient = (...args) => {
    calls.push(["createRadialGradient", args]);
    return new FakeGradient();
  };

  // Plain settable properties (fillStyle, strokeStyle, lineWidth, …) —
  // a getter/setter pair keeps assignment working without special-casing
  // every property name individually.
  const props = {};
  for (const name of [
    "fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "globalCompositeOperation",
  ]) {
    Object.defineProperty(ctx, name, {
      get() {
        return props[name];
      },
      set(v) {
        props[name] = v;
        calls.push([`set:${name}`, [v]]);
      },
    });
  }

  return ctx;
}

const baseOptions = { left: 3, right: 5, w: 40, h: 76 };

// 1. Never throws across the full value/orientation/state matrix.
for (let left = 0; left <= 6; left += 1) {
  for (let right = 0; right <= 6; right += 1) {
    for (const orientation of ["vertical", "horizontal"]) {
      for (const faceDown of [false, true]) {
        for (const selected of [false, true]) {
          for (const size of ["sm", "md"]) {
            const ctx = createFakeCtx();
            assert.doesNotThrow(() => {
              paintDominoTile(ctx, { left, right, orientation, faceDown, selected, size, w: 40, h: 76 });
            }, `paintDominoTile threw for ${JSON.stringify({ left, right, orientation, faceDown, selected, size })}`);
          }
        }
      }
    }
  }
}

// 2. Determinism — identical options -> identical call sequence.
{
  const ctxA = createFakeCtx();
  const ctxB = createFakeCtx();
  paintDominoTile(ctxA, baseOptions);
  paintDominoTile(ctxB, baseOptions);
  assert.deepEqual(ctxA.calls, ctxB.calls, "identical options must produce identical draw calls");
}

// 3. Different options -> different call sequence (sanity: painter isn't a no-op).
{
  const ctxA = createFakeCtx();
  const ctxB = createFakeCtx();
  paintDominoTile(ctxA, { ...baseOptions, left: 0, right: 0 });
  paintDominoTile(ctxB, { ...baseOptions, left: 6, right: 6 });
  assert.notDeepEqual(ctxA.calls, ctxB.calls, "different pip values must produce different draw calls");
}

// 4. Degenerate box (zero/negative size) is a safe no-op, not a crash.
{
  const ctx = createFakeCtx();
  assert.doesNotThrow(() => paintDominoTile(ctx, { ...baseOptions, w: 0, h: 0 }));
  assert.doesNotThrow(() => paintDominoTile(ctx, { ...baseOptions, w: -5, h: 40 }));
}

// 4b. Tiny/asymmetric boxes never compute a negative radius passed to
// `ctx.arc` (regression: a real browser's CanvasRenderingContext2D
// throws IndexSizeError on a negative radius; the fake ctx above does
// not, so this instead asserts on the geometry directly).
{
  const originalArc = createFakeCtx().arc;
  for (const [w, h] of [[1, 1], [1, 90], [2, 3], [3, 76], [0.5, 40], [40, 0.5]]) {
    const ctx = createFakeCtx();
    ctx.arc = (cx, cy, r, ...rest) => {
      assert.ok(r >= 0, `ctx.arc received a negative radius (${r}) for box ${w}x${h}`);
      return originalArc.call(ctx, cx, cy, r, ...rest);
    };
    assert.doesNotThrow(() => {
      paintDominoTile(ctx, { left: 6, right: 6, orientation: "vertical", faceDown: false, w, h });
    }, `paintDominoTile threw for tiny box ${w}x${h}`);
  }
}

// 5. Pip layout data itself — independent of any canvas mocking.
assert.deepEqual(PIP_LAYOUT[0], []);
assert.equal(PIP_LAYOUT[1].length, 1);
assert.equal(PIP_LAYOUT[6].length, 6);
for (let value = 0; value <= 6; value += 1) {
  assert.equal(PIP_LAYOUT[value].length, value, `value ${value} should light exactly ${value} pips`);
  for (const index of PIP_LAYOUT[value]) {
    assert.ok(index >= 0 && index <= 8, `pip index ${index} must be within the 3x3 grid`);
  }
}

// 6. Face-down draws no pips regardless of left/right (back pattern only).
{
  const faceUp = createFakeCtx();
  const faceDown = createFakeCtx();
  paintDominoTile(faceUp, { left: 6, right: 6, orientation: "vertical", faceDown: false, w: 40, h: 76 });
  paintDominoTile(faceDown, { left: 6, right: 6, orientation: "vertical", faceDown: true, w: 40, h: 76 });
  const arcCount = (ctx) => ctx.calls.filter(([name]) => name === "arc").length;
  assert.ok(arcCount(faceUp) > arcCount(faceDown), "face-up 6-6 must draw more circular pips than its face-down back");
}

console.log("DominoBitmapPainter: all checks passed");
