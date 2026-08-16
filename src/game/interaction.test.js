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

{
  const spinnerMoves = [
    { tileId: "3-2", end: "north", left: 3, right: 2, orientation: "vertical" },
    { tileId: "3-2", end: "south", left: 3, right: 2, orientation: "vertical" },
  ];
  assert.equal(isAutoPlaceable(spinnerMoves, "3-2"), false);
  assert.equal(resolvePlayChoice(spinnerMoves, "3-2"), null);
  assert.equal(resolvePlayChoice(spinnerMoves, "3-2", "north")?.end, "north");
  assert.equal(resolvePlayChoice(spinnerMoves, "3-2", "south")?.end, "south");
  assert.equal(resolvePlayChoice(spinnerMoves, "3-2", "left"), null);
}

{
  const oneSpinner = [
    { tileId: "3-0", end: "north", left: 3, right: 0, orientation: "vertical" },
  ];
  assert.equal(isAutoPlaceable(oneSpinner, "3-0"), true);
  assert.equal(resolvePlayChoice(oneSpinner, "3-0")?.end, "north");
}

{
  const threeWays = [
    { tileId: "3-0", end: END.LEFT, left: 3, right: 0, orientation: "horizontal" },
    { tileId: "3-0", end: END.RIGHT, left: 0, right: 3, orientation: "horizontal" },
    { tileId: "3-0", end: "north", left: 3, right: 0, orientation: "vertical" },
  ];
  assert.equal(isAutoPlaceable(threeWays, "3-0"), false);
  assert.equal(resolvePlayChoice(threeWays, "3-0"), null);
  assert.equal(resolvePlayChoice(threeWays, "3-0", END.LEFT)?.end, END.LEFT);
  assert.equal(resolvePlayChoice(threeWays, "3-0", "north")?.end, "north");
}

{
  // Unique MAIN end auto-places even when TOP/BOTTOM are also legal.
  const mainPlusArms = [
    { tileId: "5-6", end: END.LEFT, left: 5, right: 6, orientation: "horizontal" },
    { tileId: "5-6", end: "north", left: 6, right: 5, orientation: "vertical" },
    { tileId: "5-6", end: "south", left: 6, right: 5, orientation: "vertical" },
  ];
  assert.equal(isAutoPlaceable(mainPlusArms, "5-6"), true);
  assert.equal(isAmbiguousPlacement(mainPlusArms, "5-6"), false);
  assert.equal(resolvePlayChoice(mainPlusArms, "5-6")?.end, END.LEFT);
  assert.equal(resolvePlayChoice(mainPlusArms, "5-6", "north")?.end, "north");
}

console.log("Interaction helpers tests passed.");
