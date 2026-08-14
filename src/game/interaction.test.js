/**
 * Interaction helpers verification.
 * Run: node src/game/interaction.test.js
 */

import assert from "node:assert/strict";
import {
  movesForTile,
  legalEndsForTile,
  isAmbiguousPlacement,
  isAutoPlaceable,
  resolvePlayChoice,
  resolveDragDestination,
} from "./interaction.js";
import { END } from "./constants.js";

const moves = [
  { tileId: "2-5", end: END.LEFT, left: 5, right: 2, orientation: "horizontal" },
  { tileId: "2-5", end: END.RIGHT, left: 2, right: 5, orientation: "horizontal" },
  { tileId: "3-3", end: END.LEFT, left: 3, right: 3, orientation: "vertical" },
  { tileId: "0-1", end: END.RIGHT, left: 0, right: 1, orientation: "horizontal" },
];

assert.equal(movesForTile(moves, "2-5").length, 2);
assert.deepEqual(legalEndsForTile(moves, "2-5"), [END.LEFT, END.RIGHT]);
assert.equal(isAmbiguousPlacement(moves, "2-5"), true);
assert.equal(isAutoPlaceable(moves, "2-5"), false);

assert.deepEqual(legalEndsForTile(moves, "3-3"), [END.LEFT]);
assert.equal(isAutoPlaceable(moves, "3-3"), true);
assert.equal(isAmbiguousPlacement(moves, "3-3"), false);

assert.equal(resolvePlayChoice(moves, "2-5"), null);
assert.equal(resolvePlayChoice(moves, "2-5", END.LEFT)?.end, END.LEFT);
assert.equal(resolvePlayChoice(moves, "2-5", END.RIGHT)?.end, END.RIGHT);
assert.equal(resolvePlayChoice(moves, "3-3")?.tileId, "3-3");
assert.equal(resolvePlayChoice(moves, "missing"), null);

assert.equal(resolveDragDestination(moves, "3-3", null).ok, true);
assert.equal(resolveDragDestination(moves, "2-5", null).ok, false);
assert.equal(resolveDragDestination(moves, "2-5", END.LEFT).ok, true);
assert.equal(resolveDragDestination(moves, "2-5", "north").reason, "mismatch");
assert.equal(resolveDragDestination(moves, "nope", null).reason, "none");

console.log("Interaction helpers tests passed.");
