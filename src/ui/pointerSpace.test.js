/**
 * Pointer client-space + ghost mapping.
 * Run: node src/ui/pointerSpace.test.js
 */
import assert from "node:assert/strict";
import { ghostPositionInRoot, pointerClientPoint, sameClientSpace } from "./pointerSpace.js";

const event = { clientX: 120, clientY: 340, pageX: 9000, pageY: 9000 };
assert.deepEqual(pointerClientPoint(event), { x: 120, y: 340 });
assert.equal(sameClientSpace(event, { left: 10, top: 20 }), true);

const root = {
  getBoundingClientRect() {
    return { left: 8, top: 24, right: 400, bottom: 800 };
  },
};
assert.deepEqual(ghostPositionInRoot(120, 340, root), { x: 112, y: 316 });
assert.deepEqual(ghostPositionInRoot(120, 340, null), { x: 120, y: 340 });

console.log("  ✓ pointer client space (no pageX mix)");
