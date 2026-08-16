/**
 * Score-end glow mapping — visual only, no scoring math.
 * Run: node src/board/scoreGlow.test.js
 */

import assert from "node:assert/strict";
import { displayGlowHalves, mergeScoreHighlights } from "./scoreGlow.js";

function section(title) {
  console.log(`✓ ${title}`);
}

{
  assert.deepEqual(displayGlowHalves({ swapped: false }, ["left"]), {
    first: true,
    second: false,
  });
  assert.deepEqual(displayGlowHalves({ swapped: true }, ["left"]), {
    first: false,
    second: true,
  });
  assert.deepEqual(displayGlowHalves({ swapped: false }, ["left", "right"]), {
    first: true,
    second: true,
  });
  assert.deepEqual(displayGlowHalves({ swapped: false }, ["both"]), {
    first: true,
    second: true,
  });
  section("displayGlowHalves maps logical sides onto painted halves");
}

{
  const merged = mergeScoreHighlights([
    {
      sourceTileId: "5-5",
      scoringSide: "left",
      scoringSides: ["left"],
      contribution: 5,
    },
    {
      sourceTileId: "5-5",
      scoringSide: "right",
      scoringSides: ["right"],
      contribution: 5,
    },
  ]);
  const glow = merged.get("5-5");
  assert.ok(glow);
  assert.equal(glow.contribution, 10);
  assert.equal(glow.scoringSides.includes("left"), true);
  assert.equal(glow.scoringSides.includes("right"), true);
  const halves = displayGlowHalves({ swapped: false }, glow.scoringSides);
  assert.deepEqual(halves, { first: true, second: true });
  section("lone spinner merges both scoring faces onto one tile");
}

{
  const merged = mergeScoreHighlights([
    {
      sourceTileId: "4-4",
      scoringSide: "both",
      scoringSides: ["left", "right"],
      contribution: 8,
    },
  ]);
  const glow = merged.get("4-4");
  assert.deepEqual(displayGlowHalves({ swapped: true }, glow.scoringSides), {
    first: true,
    second: true,
  });
  assert.equal(mergeScoreHighlights([]).size, 0);
  section("terminal double glows both halves; empty highlights glow nothing");
}

console.log("\nScore-glow mapping tests passed.");
