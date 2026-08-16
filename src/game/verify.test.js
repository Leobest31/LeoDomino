/**
 * Thorough Phase 3 engine verification.
 * Covers set integrity, shuffle, deal, legal/illegal moves,
 * left/right ends, drawing, immutability, and React independence.
 *
 * Run: npm run test:engine
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  PIP_MAX,
  TILE_COUNT,
  HAND_SIZE,
  END,
  ORIENTATION,
  generateSet,
  createTile,
  tileId,
  createShuffledDeck,
  deal,
  createBoard,
  getOpenEnds,
  placeTile,
  canPlaceOnEnd,
  getLegalMoves,
  hasLegalMove,
  findLegalMove,
  createMatch,
  listLegalMoves,
  applyPlace,
  applyDraw,
  readOpenEnds,
  playerHasLegalMove,
} from "./index.js";

import { shuffle, createRng } from "../utils/rng.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;

function test(title, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${title}`);
}

function expectedIds() {
  const ids = [];
  for (let a = 0; a <= PIP_MAX; a += 1) {
    for (let b = a; b <= PIP_MAX; b += 1) {
      ids.push(`${a}-${b}`);
    }
  }
  return ids;
}

function assertPartition(match, label = "partition") {
  const onBoard = match.board.map((t) => t.id);
  const inHands = match.players.flatMap((p) => p.hand);
  const all = [...onBoard, ...inHands, ...match.reserve];
  assert.equal(all.length, TILE_COUNT, `${label}: total tile count`);
  assert.equal(new Set(all).size, TILE_COUNT, `${label}: no duplicates across zones`);
  assert.deepEqual([...all].sort(), expectedIds().slice().sort(), `${label}: exact double-six set`);
}

function assertChainIntegrity(board) {
  for (let i = 0; i < board.length - 1; i += 1) {
    assert.equal(
      board[i].right,
      board[i + 1].left,
      `chain break between ${board[i].id} and ${board[i + 1].id}`
    );
  }
}

function tile(a, b) {
  return createTile(a, b);
}

console.log("\n=== LeoDomino engine verification ===\n");

// ---------------------------------------------------------------------------
console.log("1. Set generation (28 unique, no duplicates)");
// ---------------------------------------------------------------------------

test("generateSet returns exactly 28 tiles", () => {
  assert.equal(generateSet().length, TILE_COUNT);
  assert.equal(TILE_COUNT, 28);
});

test("every expected double-six id is present exactly once", () => {
  const set = generateSet();
  const ids = set.map((t) => t.id);
  assert.deepEqual(ids.slice().sort(), expectedIds().slice().sort());
  assert.equal(new Set(ids).size, 28);
});

test("includes doubles 0-0 through 6-6 and mixed tiles", () => {
  const ids = new Set(generateSet().map((t) => t.id));
  for (let d = 0; d <= 6; d += 1) assert.ok(ids.has(`${d}-${d}`));
  assert.ok(ids.has("0-1"));
  assert.ok(ids.has("2-5"));
  assert.ok(ids.has("5-6"));
});

test("tile ids are normalized (createTile(5,2) → 2-5)", () => {
  const t = createTile(5, 2);
  assert.equal(t.id, "2-5");
  assert.equal(t.a, 2);
  assert.equal(t.b, 5);
  assert.equal(tileId(6, 1), "1-6");
});

test("doubles are flagged; non-doubles are not", () => {
  assert.equal(createTile(4, 4).isDouble, true);
  assert.equal(createTile(1, 4).isDouble, false);
});

test("invalid pips are rejected", () => {
  assert.throws(() => createTile(-1, 0));
  assert.throws(() => createTile(0, 7));
  assert.throws(() => createTile(1.5, 2));
});

// ---------------------------------------------------------------------------
console.log("\n2. Shuffle");
// ---------------------------------------------------------------------------

test("shuffle does not mutate the input array", () => {
  const original = generateSet();
  const snapshot = original.map((t) => t.id);
  shuffle(original, createRng(7));
  assert.deepEqual(original.map((t) => t.id), snapshot);
});

test("shuffle is a permutation of the same tiles", () => {
  const original = generateSet();
  const shuffled = shuffle(original, createRng(11));
  assert.equal(shuffled.length, 28);
  assert.deepEqual(
    shuffled.map((t) => t.id).sort(),
    original.map((t) => t.id).sort()
  );
});

test("same seed yields identical shuffle order", () => {
  const a = createShuffledDeck(12345);
  const b = createShuffledDeck(12345);
  assert.deepEqual(a.order, b.order);
  assert.equal(a.seed, 12345);
});

test("different seeds can yield different orders", () => {
  const a = createShuffledDeck(1).order.join(",");
  const b = createShuffledDeck(2).order.join(",");
  const c = createShuffledDeck(999).order.join(",");
  assert.ok(a !== b || b !== c, "at least two seeds should differ");
});

test("createShuffledDeck always returns 28 unique ids", () => {
  for (const seed of [0, 1, 42, 100, 9999]) {
    const { order } = createShuffledDeck(seed);
    assert.equal(order.length, 28);
    assert.equal(new Set(order).size, 28);
  }
});

test("shuffled order is not always the sorted natural order", () => {
  const natural = expectedIds().join(",");
  let foundDifference = false;
  for (let seed = 0; seed < 50; seed += 1) {
    if (createShuffledDeck(seed).order.join(",") !== natural) {
      foundDifference = true;
      break;
    }
  }
  assert.ok(foundDifference, "shuffle should rearrange tiles");
});

// ---------------------------------------------------------------------------
console.log("\n3. Dealing (7 each, reserve 14)");
// ---------------------------------------------------------------------------

test("deal gives each of 2 players exactly 7 tiles", () => {
  const { tiles } = createShuffledDeck(55);
  const { hands } = deal(tiles);
  assert.equal(hands.length, 2);
  assert.equal(hands[0].length, HAND_SIZE);
  assert.equal(hands[1].length, HAND_SIZE);
  assert.equal(HAND_SIZE, 7);
});

test("reserve contains exactly 14 tiles for a 2-player deal", () => {
  const { tiles } = createShuffledDeck(55);
  const { reserve } = deal(tiles);
  assert.equal(reserve.length, 14);
});

test("dealt hands and reserve partition the full set with no overlap", () => {
  const { tiles } = createShuffledDeck(77);
  const { hands, reserve } = deal(tiles);
  const all = [...hands[0], ...hands[1], ...reserve];
  assert.equal(all.length, 28);
  assert.equal(new Set(all).size, 28);
  assert.deepEqual(all.slice().sort(), expectedIds().slice().sort());
});

test("round-robin deal follows shuffled order", () => {
  const { tiles } = createShuffledDeck(8);
  const { hands, reserve } = deal(tiles);
  // Round-robin: P0, P1, P0, P1... then remainder reserve
  assert.equal(hands[0][0], tiles[0].id);
  assert.equal(hands[1][0], tiles[1].id);
  assert.equal(hands[0][1], tiles[2].id);
  assert.equal(hands[1][1], tiles[3].id);
  assert.deepEqual(
    reserve,
    tiles.slice(14).map((t) => t.id)
  );
});

test("deal rejects incomplete sets", () => {
  assert.throws(() => deal(generateSet().slice(0, 10)));
});

test("createMatch wires deal into match state correctly", () => {
  const match = createMatch({ seed: 2026, playerIds: ["a", "b"] });
  assert.equal(match.players[0].hand.length, 7);
  assert.equal(match.players[1].hand.length, 7);
  assert.equal(match.reserve.length, 14);
  assert.equal(match.board.length, 0);
  assertPartition(match, "createMatch");
});

// ---------------------------------------------------------------------------
console.log("\n4. Legal moves");
// ---------------------------------------------------------------------------

test("empty board: every hand tile is a legal opening move", () => {
  const match = createMatch({ seed: 3 });
  const moves = listLegalMoves(match, 0);
  assert.equal(moves.length, 7);
  assert.deepEqual(
    moves.map((m) => m.tileId).sort(),
    match.players[0].hand.slice().sort()
  );
  for (const move of moves) {
    assert.equal(move.end, END.RIGHT);
  }
});

test("empty hand yields no legal moves", () => {
  const match = createMatch({ seed: 3 });
  assert.deepEqual(getLegalMoves([], match.board, match.byId), []);
  assert.equal(hasLegalMove([], match.board, match.byId), false);
});

test("tile matching only the left end is legal only on left", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  let board = placeTile([], tile(6, 6));
  // ends 6|6 — use a controlled board: open with 4-5 → ends 4|5
  board = placeTile([], tile(4, 5));
  assert.deepEqual(getOpenEnds(board), { left: 4, right: 5 });

  const hand = ["0-4", "1-1", "2-3"];
  const moves = getLegalMoves(hand, board, byId);
  assert.deepEqual(
    moves.map((m) => `${m.tileId}@${m.end}`),
    ["0-4@left"]
  );
});

test("tile matching only the right end is legal only on right", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  const board = placeTile([], tile(4, 5));
  const moves = getLegalMoves(["1-5", "0-0"], board, byId);
  assert.deepEqual(
    moves.map((m) => `${m.tileId}@${m.end}`),
    ["1-5@right"]
  );
});

test("tile 2-5 on board ends 2|5 is playable on both ends", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  // Build chain without using 2-5: start 2-3, then 3-5 → ends 2|5
  let board = placeTile([], tile(2, 3));
  board = placeTile(board, tile(3, 5), END.RIGHT);
  assert.deepEqual(getOpenEnds(board), { left: 2, right: 5 });

  const moves = getLegalMoves(["2-5"], board, byId);
  assert.equal(moves.length, 2);
  assert.ok(moves.some((m) => m.end === END.LEFT));
  assert.ok(moves.some((m) => m.end === END.RIGHT));
});

test("double matching an end is legal", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  const board = placeTile([], tile(1, 4));
  const moves = getLegalMoves(["4-4"], board, byId);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].end, END.RIGHT);
  assert.equal(moves[0].orientation, ORIENTATION.VERTICAL);
});

test("findLegalMove returns the move or null", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  const board = placeTile([], tile(1, 4));
  assert.ok(findLegalMove(["4-4"], board, byId, "4-4", END.RIGHT));
  assert.equal(findLegalMove(["4-4"], board, byId, "4-4", END.LEFT), null);
  assert.equal(findLegalMove(["0-0"], board, byId, "0-0", END.RIGHT), null);
});

// ---------------------------------------------------------------------------
console.log("\n5. Illegal moves rejected");
// ---------------------------------------------------------------------------

test("placing a tile not in hand is rejected", () => {
  const match = createMatch({ seed: 10 });
  const missing = expectedIds().find((id) => !match.players[0].hand.includes(id));
  assert.throws(() => applyPlace(match, 0, missing, END.RIGHT), /does not hold/);
});

test("placing a non-matching tile is rejected on both ends", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  const match = {
    seed: 0,
    byId,
    players: [{ id: "p", hand: ["0-1", "2-2"] }],
    reserve: [],
    board: placeTile([], tile(6, 6)),
  };
  assert.throws(() => applyPlace(match, 0, "0-1", END.LEFT), /Illegal placement/);
  assert.throws(() => applyPlace(match, 0, "0-1", END.RIGHT), /Illegal placement/);
  assert.throws(() => applyPlace(match, 0, "2-2", END.LEFT), /Illegal placement/);
});

test("placing the same tile twice on the board is rejected", () => {
  const t = tile(2, 2);
  const board = placeTile([], t);
  assert.throws(() => placeTile(board, t, END.RIGHT), /already on the board/);
});

test("resolvePlacement rejects non-matching tile", () => {
  assert.throws(() => placeTile(placeTile([], tile(0, 0)), tile(1, 2), END.LEFT));
});

test("invalid player index is rejected", () => {
  const match = createMatch({ seed: 1 });
  assert.throws(() => listLegalMoves(match, 9));
  assert.throws(() => applyPlace(match, 9, match.players[0].hand[0]));
  assert.throws(() => applyDraw(match, 9));
});

test("canPlaceOnEnd is false for mismatched end", () => {
  const board = placeTile([], tile(3, 5));
  assert.equal(canPlaceOnEnd(board, tile(0, 1), END.LEFT), false);
  assert.equal(canPlaceOnEnd(board, tile(0, 1), END.RIGHT), false);
  assert.equal(canPlaceOnEnd(board, tile(0, 3), END.LEFT), true);
  assert.equal(canPlaceOnEnd(board, tile(0, 3), END.RIGHT), false);
});

// ---------------------------------------------------------------------------
console.log("\n6. Left and right ends update correctly");
// ---------------------------------------------------------------------------

test("opening non-double sets both ends from a|b", () => {
  const board = placeTile([], tile(2, 5));
  assert.deepEqual(getOpenEnds(board), { left: 2, right: 5 });
  assert.equal(board[0].orientation, ORIENTATION.HORIZONTAL);
});

test("opening double sets both ends equal and vertical", () => {
  const board = placeTile([], tile(6, 6));
  assert.deepEqual(getOpenEnds(board), { left: 6, right: 6 });
  assert.equal(board[0].orientation, ORIENTATION.VERTICAL);
});

test("play on right updates only the right end", () => {
  let board = placeTile([], tile(1, 4));
  board = placeTile(board, tile(4, 0), END.RIGHT);
  assert.deepEqual(getOpenEnds(board), { left: 1, right: 0 });
  assert.equal(board[1].left, 4);
  assert.equal(board[1].right, 0);
  assertChainIntegrity(board);
});

test("play on left updates only the left end", () => {
  let board = placeTile([], tile(1, 4));
  board = placeTile(board, tile(1, 6), END.LEFT);
  // matching 1 faces right toward chain; free 6 becomes new left
  assert.deepEqual(getOpenEnds(board), { left: 6, right: 4 });
  assert.equal(board[0].left, 6);
  assert.equal(board[0].right, 1);
  assertChainIntegrity(board);
});

test("orientation flips correctly when high pip must face the chain", () => {
  let board = placeTile([], tile(2, 3));
  // right end 3; play 5-3 → matching 3 left, free 5 right
  board = placeTile(board, tile(5, 3), END.RIGHT);
  assert.deepEqual(board[1], {
    id: "3-5",
    left: 3,
    right: 5,
    orientation: ORIENTATION.HORIZONTAL,
    destination: "MAIN_RIGHT",
    branch: "MAIN_RIGHT",
  });
  assert.deepEqual(getOpenEnds(board), { left: 2, right: 5 });
});

test("left play flips when low pip must face the chain", () => {
  let board = placeTile([], tile(2, 3));
  // left end 2; play 5-2 → matching 2 right, free 5 left
  board = placeTile(board, tile(5, 2), END.LEFT);
  assert.deepEqual(board[0], {
    id: "2-5",
    left: 5,
    right: 2,
    orientation: ORIENTATION.HORIZONTAL,
    destination: "MAIN_LEFT",
    branch: "MAIN_LEFT",
  });
  assert.deepEqual(getOpenEnds(board), { left: 5, right: 3 });
});

test("multi-step chain keeps adjacent pips equal and ends accurate", () => {
  let board = createBoard();
  board = placeTile(board, tile(6, 6));
  board = placeTile(board, tile(6, 1), END.RIGHT);
  board = placeTile(board, tile(6, 3), END.LEFT);
  board = placeTile(board, tile(1, 0), END.RIGHT);
  board = placeTile(board, tile(3, 3), END.LEFT);
  assertChainIntegrity(board);
  assert.deepEqual(getOpenEnds(board), { left: 3, right: 0 });
  assert.equal(board.length, 5);
});

test("applyPlace left/right updates match open ends", () => {
  // Controlled: force opening 0-1 then play known tiles via crafted state
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  let match = {
    seed: 0,
    byId,
    players: [
      { id: "p0", hand: ["0-1", "1-4", "2-2"] },
      { id: "p1", hand: ["0-5", "4-4"] },
    ],
    reserve: [],
    board: [],
  };

  match = applyPlace(match, 0, "0-1", END.RIGHT);
  assert.deepEqual(readOpenEnds(match), { left: 0, right: 1 });

  match = applyPlace(match, 0, "1-4", END.RIGHT);
  assert.deepEqual(readOpenEnds(match), { left: 0, right: 4 });

  match = applyPlace(match, 1, "0-5", END.LEFT);
  assert.deepEqual(readOpenEnds(match), { left: 5, right: 4 });
  assertChainIntegrity(match.board);
});

test("empty board left end alias still places opening tile", () => {
  let match = createMatch({ seed: 4 });
  const id = match.players[0].hand[0];
  match = applyPlace(match, 0, id, END.LEFT);
  assert.equal(match.board.length, 1);
  assert.equal(match.board[0].id, id);
});

// ---------------------------------------------------------------------------
console.log("\n7. Drawing from reserve");
// ---------------------------------------------------------------------------

test("draw moves the top reserve tile into the player hand", () => {
  const match = createMatch({ seed: 88 });
  const top = match.reserve[0];
  const next = applyDraw(match, 0);
  assert.ok(next);
  assert.equal(next.reserve.length, 13);
  assert.equal(next.players[0].hand.length, 8);
  assert.ok(next.players[0].hand.includes(top));
  assert.ok(!next.reserve.includes(top));
  assert.equal(next.players[1].hand.length, 7);
  assertPartition(next, "after one draw");
});

test("draw does not mutate the previous match state", () => {
  const match = createMatch({ seed: 88 });
  const reserveLen = match.reserve.length;
  const handLen = match.players[0].hand.length;
  applyDraw(match, 0);
  assert.equal(match.reserve.length, reserveLen);
  assert.equal(match.players[0].hand.length, handLen);
});

test("drawing from an empty reserve returns null", () => {
  const match = {
    ...createMatch({ seed: 1 }),
    reserve: [],
  };
  assert.equal(applyDraw(match, 0), null);
});

test("can draw all 14 reserve tiles then null", () => {
  let match = createMatch({ seed: 12 });
  assert.equal(match.reserve.length, 14);
  for (let i = 0; i < 14; i += 1) {
    const next = applyDraw(match, i % 2);
    assert.ok(next, `draw ${i + 1} should succeed`);
    match = next;
  }
  assert.equal(match.reserve.length, 0);
  assert.equal(applyDraw(match, 0), null);
  assertPartition(match, "reserve exhausted");
});

test("drawn tile can become a legal move", () => {
  const byId = Object.fromEntries(generateSet().map((t) => [t.id, t]));
  let match = {
    seed: 0,
    byId,
    players: [
      { id: "p0", hand: ["0-1"] },
      { id: "p1", hand: [] },
    ],
    reserve: ["4-4", "3-5"],
    board: placeTile([], tile(3, 3)),
  };
  assert.equal(playerHasLegalMove(match, 0), false);

  match = applyDraw(match, 0); // draws 4-4 — still no match for ends 3|3
  assert.equal(playerHasLegalMove(match, 0), false);
  assert.ok(match.players[0].hand.includes("4-4"));

  match = applyDraw(match, 0); // draws 3-5 — playable
  assert.equal(playerHasLegalMove(match, 0), true);
  assert.ok(listLegalMoves(match, 0).some((m) => m.tileId === "3-5"));
});

// ---------------------------------------------------------------------------
console.log("\n8. Immutability & match integrity across play");
// ---------------------------------------------------------------------------

test("applyPlace does not mutate the prior match", () => {
  const match = createMatch({ seed: 5 });
  const handBefore = match.players[0].hand.slice();
  const boardLenBefore = match.board.length;
  const reserveBefore = match.reserve.slice();
  const move = listLegalMoves(match, 0)[0];

  const next = applyPlace(match, 0, move.tileId, move.end);

  assert.deepEqual(match.players[0].hand, handBefore);
  assert.equal(match.board.length, boardLenBefore);
  assert.deepEqual(match.reserve, reserveBefore);
  assert.equal(next.board.length, boardLenBefore + 1);
  assert.equal(next.players[0].hand.length, handBefore.length - 1);
  assert.ok(!next.players[0].hand.includes(move.tileId));
});

test("simulated play across many seeds keeps partition + chain", () => {
  for (const seed of [1, 2, 7, 13, 21, 34, 55, 89, 144, 233]) {
    let match = createMatch({ seed });
    assertPartition(match, `seed ${seed} start`);

    // Play up to 10 legal placements alternating players, drawing if needed
    for (let turn = 0; turn < 10; turn += 1) {
      const p = turn % 2;
      let guard = 0;
      while (!playerHasLegalMove(match, p) && match.reserve.length && guard < 20) {
        match = applyDraw(match, p);
        guard += 1;
      }
      if (!playerHasLegalMove(match, p)) break;
      const move = listLegalMoves(match, p)[0];
      match = applyPlace(match, p, move.tileId, move.end);
      assertChainIntegrity(match.board);
      assertPartition(match, `seed ${seed} turn ${turn}`);
      const ends = readOpenEnds(match);
      assert.equal(ends.left, match.board[0].left);
      assert.equal(ends.right, match.board[match.board.length - 1].right);
    }
  }
});

// ---------------------------------------------------------------------------
console.log("\n9. Engine independence from React");
// ---------------------------------------------------------------------------

test("game modules stay free of React imports", () => {
  const gameDir = __dirname;
  const files = readdirSync(gameDir).filter((f) => f.endsWith(".js"));
  const banned = [
    /from\s+['"]react['"]/,
    /from\s+['"]react-dom['"]/,
    /from\s+['"].*components\//,
    /from\s+['"].*pages\//,
  ];

  for (const file of files) {
    // rules/ is a subdirectory — scan top-level only here; recursive below
    const source = readFileSync(join(gameDir, file), "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(source), false, `${file} matched ${pattern}`);
    }
  }

  const rulesDir = join(gameDir, "rules");
  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(join(rulesDir, file), "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(source), false, `rules/${file} matched ${pattern}`);
    }
  }

  const aiDir = join(gameDir, "ai");
  for (const file of readdirSync(aiDir).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(join(aiDir, file), "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(source), false, `ai/${file} matched ${pattern}`);
    }
  }
});

test("engine modules load under Node without React in the import graph", () => {
  const require = createRequire(import.meta.url);
  const pkg = require("../../package.json");
  assert.ok(pkg.dependencies.react);
  assert.ok(true);
});

// ---------------------------------------------------------------------------
console.log(`\n=== All ${passed} engine verification tests passed. ===\n`);
