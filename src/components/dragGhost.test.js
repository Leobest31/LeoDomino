/**
 * Drag-ghost sizing contract — measured hand pixels, never auto/zero.
 * Run: node src/components/dragGhost.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dragGhostSizeStyle } from "./dragGhostSize.js";
import { attachCapturedPointerTracking } from "../ui/handTilePointer.js";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "DragGhost.css"), "utf8");
const jsx = readFileSync(join(here, "DragGhost.jsx"), "utf8");
const onlinePage = readFileSync(join(here, "../pages/OnlineGamePage.jsx"), "utf8");
const gamePage = readFileSync(join(here, "../pages/GamePage.jsx"), "utf8");
const dest = readFileSync(join(here, "../game/destinationTarget.js"), "utf8");

{
  const sized = dragGhostSizeStyle(39.6, 72);
  assert.ok(sized, "measured size produces a style object");
  assert.equal(sized.width, "39.6px");
  assert.equal(sized.height, "72px");
  assert.equal(sized["--domino-w"], "39.6px");
  assert.equal(sized["--domino-h"], "72px");
  const w = Number.parseFloat(sized.width);
  const h = Number.parseFloat(sized.height);
  assert.ok(w > 1 && h > 1, "ghost box is non-zero");
}

assert.equal(dragGhostSizeStyle(0, 72), null);
assert.equal(dragGhostSizeStyle(40, 0), null);
assert.equal(dragGhostSizeStyle(undefined, undefined), null);
assert.equal(dragGhostSizeStyle(-8, 40), null);

assert.match(jsx, /dragGhostSizeStyle\(width, height\)/, "A. ghost applies measured width/height");
assert.match(jsx, /boardTileId="drag-ghost"/, "ghost is flattened (no Premium 3D collapse)");
assert.doesNotMatch(jsx, /draggable=\{true\}/);
assert.doesNotMatch(jsx, /onDragStart/);

assert.match(css, /\.drag-ghost \{[\s\S]*?width:\s*var\(--domino-w\)/);
assert.match(css, /\.drag-ghost \{[\s\S]*?height:\s*var\(--domino-h\)/);
assert.doesNotMatch(
  css.replace(/\/\*[\s\S]*?\*\//g, ""),
  /\.drag-ghost \.domino[\s\S]*?width:\s*auto/,
  "Classic ghost must not collapse via width:auto"
);
assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /height:\s*auto/);

assert.match(onlinePage, /width=\{drag\.w\}/);
assert.match(onlinePage, /height=\{drag\.h\}/);
assert.match(gamePage, /width=\{drag\.w\}/);
assert.match(gamePage, /height=\{drag\.h\}/);

{
  const finish = onlinePage.slice(
    onlinePage.indexOf("const finishDrag"),
    onlinePage.indexOf("const dragging")
  );
  assert.match(
    finish,
    /pickTargetDestination\(\s*clientX,\s*clientY/,
    "online drop still uses pointer client coordinates, not ghost box"
  );
}

assert.match(
  dest,
  /export function pickTargetDestination\(clientX, clientY, targets\)/,
  "destination picker remains client-coordinate based"
);

assert.match(onlinePage, /attachCapturedPointerTracking/, "B. online drag uses capture-safe path");
assert.match(gamePage, /attachCapturedPointerTracking/, "B. offline drag uses capture-safe path");
assert.doesNotMatch(
  onlinePage,
  /window\.addEventListener\("pointermove"/,
  "online drag ghost must not rely only on window pointermove"
);
assert.doesNotMatch(
  gamePage,
  /window\.addEventListener\("pointermove"/,
  "offline drag ghost must not rely only on window pointermove"
);

{
  function fakeTarget() {
    const listeners = {};
    return {
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] || []).filter((row) => row !== fn);
      },
      dispatch(type, event) {
        for (const fn of listeners[type] || []) fn(event);
      },
    };
  }

  const target = fakeTarget();
  let ghost = { x: 10, y: 20 };
  const stop = attachCapturedPointerTracking(target, {
    onMove: (event) => {
      ghost = { x: event.clientX, y: event.clientY };
    },
    onUp() {},
    onCancel() {},
  });
  target.dispatch("pointermove", { clientX: 80, clientY: 90, pointerId: 7 });
  assert.equal(ghost.x, 80, "B. captured pointermove updates ghost x");
  assert.equal(ghost.y, 90, "B. captured pointermove updates ghost y");
  stop();
}

console.log("  ✓ drag ghost sizing + captured pointer contract");
