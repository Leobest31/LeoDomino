/**
 * Connection fidelity — logical chain + rendered facing halves must agree.
 */
import assert from "node:assert/strict";
import { layoutBoard } from "./layoutEngine.js";
import {
  assertLogicalConnections,
  assertVisualConnections,
  resolveTileDisplay,
  facingToward,
  facingHalf,
  pipOnHalf,
  pipOnEdge,
  validateBoardPresentation,
} from "./connectionDisplay.js";

const size = { w: 40, h: 76 };

function tile(id, left, right) {
  return { id, left, right };
}

// --- Logical chain ---
{
  const board = [tile("a", 6, 6), tile("b", 6, 3), tile("c", 3, 0)];
  assert.equal(assertLogicalConnections(board).ok, true);
}

{
  const bad = [tile("a", 6, 6), tile("b", 5, 3)];
  const result = assertLogicalConnections(bad);
  assert.equal(result.ok, false);
  assert.equal(result.expected, 6);
  assert.equal(result.actual, 5);
}

// --- Display swap when chain-left neighbor is east (reverse ribbon) ---
{
  const logical = tile("t", 2, 5);
  const pos = { id: "t", x: 100, y: 50, w: 76, h: 40, orientation: "horizontal" };
  const leftNeighbor = { id: "n", x: 200, y: 50, w: 76, h: 40 }; // east = reverse
  const display = resolveTileDisplay(logical, pos, null, leftNeighbor);
  assert.equal(display.swapped, true);
  assert.equal(display.left, 5);
  assert.equal(display.right, 2);
  assert.equal(facingHalf(pos, leftNeighbor, "horizontal"), "right");
  assert.equal(pipOnHalf(display, "right"), 2); // logical left on east after swap? 
  // swap: left=5 (logical right), right=2 (logical left)
  // half toward left neighbor (east) is "right" half → shows 2 = logical left ✓
  assert.equal(pipOnHalf(display, "right"), 2);
}

{
  const logical = tile("t", 2, 5);
  const pos = { id: "t", x: 50, y: 100, w: 40, h: 76, orientation: "vertical" };
  const rightNeighbor = { id: "n", x: 50, y: 10, w: 40, h: 76 }; // north
  const display = resolveTileDisplay(logical, pos, rightNeighbor, null);
  assert.equal(display.swapped, true);
  assert.equal(pipOnEdge(display, "N"), 5);
}

{
  const logical = tile("t", 3, 3);
  const pos = { id: "t", x: 100, y: 50, w: 40, h: 76, orientation: "vertical" };
  const rightNeighbor = { id: "n", x: 10, y: 80, w: 76, h: 40 };
  const display = resolveTileDisplay(logical, pos, rightNeighbor, null);
  assert.equal(display.orientation, "vertical");
  assert.equal(display.swapped, false);
}

{
  const logical = tile("t", 2, 5);
  const pos = { id: "t", x: 10, y: 50, w: 76, h: 40, orientation: "horizontal" };
  const rightNeighbor = { id: "n", x: 100, y: 50, w: 76, h: 40 };
  const display = resolveTileDisplay(logical, pos, rightNeighbor, null);
  assert.equal(display.swapped, false);
  assert.equal(display.left, 2);
  assert.equal(display.right, 5);
  assert.equal(facingToward(pos, rightNeighbor), "E");
}

// --- validateBoardPresentation ---
{
  const board = [tile("c", 6, 6), tile("r1", 6, 2), tile("r2", 2, 0)];
  const result = validateBoardPresentation(board, {
    layoutFn: layoutBoard,
    centerIndex: 0,
    viewport: { width: 700, height: 360 },
    tileSize: size,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

// --- Full serpentine ---
{
  const board = [tile("c", 6, 6)];
  let open = 6;
  for (let i = 1; i <= 10; i += 1) {
    const next = (open + 1) % 7;
    board.push(tile(`r${i}`, open, next));
    open = next;
  }
  assert.equal(assertLogicalConnections(board).ok, true);
  const { placements } = layoutBoard(board, 0, { width: 720, height: 360 }, size);
  assert.equal(assertVisualConnections(board, placements).ok, true);
}

{
  const left = [];
  let openL = 4;
  for (let i = 5; i >= 1; i -= 1) {
    const next = (openL + 2) % 7;
    left.unshift(tile(`l${i}`, next, openL));
    openL = next;
  }
  const center = tile("c", 4, 4);
  const right = [];
  let openR = 4;
  for (let i = 1; i <= 8; i += 1) {
    const next = (openR + 1) % 7;
    right.push(tile(`r${i}`, openR, next));
    openR = next;
  }
  const board = [...left, center, ...right];
  const centerIndex = left.length;
  const result = validateBoardPresentation(board, {
    layoutFn: layoutBoard,
    centerIndex,
    viewport: { width: 800, height: 400 },
    tileSize: size,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

{
  const board = [tile("c", 6, 6)];
  let open = 6;
  for (let i = 1; i <= 12; i += 1) {
    const next = i % 7;
    board.push(tile(`r${i}`, open, next));
    open = next;
  }
  const result = validateBoardPresentation(board, {
    layoutFn: layoutBoard,
    centerIndex: 0,
    viewport: { width: 360, height: 280 },
    tileSize: size,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

// Corner off a double: non-double must not paint a long-side mismatch
{
  const board = [
    tile("1-1", 1, 1),
    tile("1-4", 1, 4),
    tile("4-6", 4, 6),
    tile("1-6", 6, 1),
    tile("1-2", 1, 2),
    tile("2-5", 2, 5),
    tile("5-5", 5, 5),
    tile("3-5", 5, 3),
    tile("3-6", 3, 6),
  ];
  for (const viewport of [
    { width: 360, height: 280 },
    { width: 768, height: 420 },
    { width: 1100, height: 520 },
  ]) {
    const result = validateBoardPresentation(board, {
      layoutFn: layoutBoard,
      centerIndex: 6,
      viewport,
      tileSize: size,
    });
    assert.equal(result.ok, true, `${viewport.width}: ${JSON.stringify(result)}`);
  }
}

console.log("Connection fidelity tests passed.");
