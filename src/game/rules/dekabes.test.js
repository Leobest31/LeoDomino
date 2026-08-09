/**
 * Dekabès detection unit tests.
 * Run: node src/game/rules/dekabes.test.js
 */

import assert from "node:assert/strict";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { isDekabes } from "./dekabes.js";

function section(title) {
  console.log(`✓ ${title}`);
}

const byId = indexTiles([
  createTile(3, 5),
  createTile(3, 3),
  createTile(5, 5),
  createTile(2, 4),
  createTile(3, 6),
  createTile(0, 1),
  createTile(1, 2),
  createTile(4, 6),
]);

function boardWithEnds(leftPip, rightPip) {
  // Build a tiny chain whose open ends are leftPip / rightPip.
  // Place leftPip-leftPip as opener, then attach rightPip if different.
  let board = createBoard();
  const openDouble = createTile(leftPip, leftPip);
  byId[openDouble.id] = openDouble;
  board = placeTile(board, openDouble, END.RIGHT);
  if (leftPip !== rightPip) {
    const bridge = createTile(leftPip, rightPip);
    byId[bridge.id] = bridge;
    board = placeTile(board, bridge, END.RIGHT);
  }
  return board;
}

{
  const board = boardWithEnds(3, 5);
  assert.equal(
    isDekabes({ tileId: "3-5", hand: ["3-5"], board, byId }),
    true
  );
  section("Dekabès: final non-double matching both ends");
}

{
  const board = boardWithEnds(3, 5);
  assert.equal(
    isDekabes({ tileId: "3-5", hand: ["3-5", "0-1"], board, byId }),
    false
  );
  section("Dekabès requires final tile");
}

{
  const board = boardWithEnds(3, 3);
  assert.equal(
    isDekabes({ tileId: "3-3", hand: ["3-3"], board, byId }),
    false
  );
  section("Dekabès rejects doubles");
}

{
  const board = boardWithEnds(3, 5);
  assert.equal(
    isDekabes({ tileId: "3-6", hand: ["3-6"], board, byId }),
    false
  );
  section("Dekabès requires both open ends (only left matches)");
}

{
  const board = boardWithEnds(3, 5);
  assert.equal(
    isDekabes({ tileId: "2-4", hand: ["2-4"], board, byId }),
    false
  );
  section("Dekabès rejects tile matching neither end");
}

{
  assert.equal(
    isDekabes({ tileId: "3-5", hand: ["3-5"], board: [], byId }),
    false
  );
  section("Dekabès false on empty board");
}

{
  const board = boardWithEnds(3, 5);
  assert.equal(
    isDekabes({ tileId: "3-5", hand: ["2-4"], board, byId }),
    false
  );
  section("Dekabès requires the played tile to be the sole hand tile");
}

console.log("\nDekabès helper tests passed.");
