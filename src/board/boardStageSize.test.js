/**
 * Board stage measurement must not collapse to a 120px / URL-bar size.
 * Run: node src/board/boardStageSize.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_BOARD_STAGE_PX,
  isTransientBoardStageCollapse,
  measureBoardStageBox,
  stabilizeBoardStageSize,
  stabilizeHandExclusionPx,
} from "./boardStageSize.js";

const here = dirname(fileURLToPath(import.meta.url));
const boardJsx = readFileSync(join(here, "BoardContainer.jsx"), "utf8");

{
  const good = { w: 390, h: 520 };
  assert.equal(stabilizeBoardStageSize(null, { w: 0, h: 0 }), null);
  assert.equal(stabilizeBoardStageSize(null, { w: 120, h: 120 }), null);
  assert.deepEqual(stabilizeBoardStageSize(null, good), good);
  assert.deepEqual(
    stabilizeBoardStageSize(good, { w: 0, h: 0 }),
    good,
    "0×0 ResizeObserver flash keeps the last good felt"
  );
  assert.deepEqual(
    stabilizeBoardStageSize(good, { w: 120, h: 120 }),
    good,
    "120px floor is not treated as a real phone felt"
  );
  assert.deepEqual(
    stabilizeBoardStageSize(good, { w: 390, h: 460 }),
    good,
    "URL-bar height drop does not shrink the board stage"
  );
  assert.deepEqual(
    stabilizeBoardStageSize(good, { w: 844, h: 390 }),
    { w: 844, h: 390 },
    "orientation / width change applies immediately"
  );
  assert.deepEqual(
    stabilizeBoardStageSize(good, { w: 390, h: 360 }),
    { w: 390, h: 360 },
    "a large persistent height resize is accepted"
  );
  assert.ok(isTransientBoardStageCollapse(good, { w: 390, h: 470 }));
  assert.equal(isTransientBoardStageCollapse(good, { w: 844, h: 390 }), false);
  assert.equal(MIN_BOARD_STAGE_PX, 160);
  assert.equal(measureBoardStageBox({ clientWidth: 12, clientHeight: 0 }).h, 0);
}

{
  assert.equal(stabilizeHandExclusionPx(0, 80), 0, "sudden dock overlap is a flex glitch");
  assert.equal(stabilizeHandExclusionPx(0, 8), 8);
  assert.equal(stabilizeHandExclusionPx(12, 12), 12);
}

{
  assert.match(boardJsx, /stabilizeBoardStageSize/);
  assert.match(boardJsx, /measureBoardStageBox/);
  assert.doesNotMatch(
    boardJsx,
    /Math\.max\(120,\s*stage\.clientWidth\)/,
    "BoardContainer does not adopt the 120px emergency floor as a live size"
  );
  assert.doesNotMatch(
    boardJsx,
    /\}, \[tiles\.length\]\);/,
    "ResizeObserver must not rebind on every tile, which re-samples mid-layout"
  );
}

console.log("  ✓ board stage size stays stable across transient measurements");
