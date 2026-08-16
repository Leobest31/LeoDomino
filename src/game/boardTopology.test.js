/**
 * Authoritative board topology — destination pipeline + pre-spinner invariants.
 * Run: node src/game/boardTopology.test.js
 */

import assert from "node:assert/strict";
import {
  BRANCH,
  SPINNER_NODE,
  annotateMoveDestination,
  assertBoardTopology,
  buildBoardTopology,
  coercePlayEnd,
  destinationFromEnd,
  orientationForBranch,
} from "./boardTopology.js";
import { END } from "./constants.js";
import { applyPlace, createMatch } from "./match.js";
import { getLegalMoves } from "./moves.js";

function section(title) {
  console.log(`\n• ${title}`);
}

function forceHand(match, tileIds) {
  return {
    ...match,
    players: [{ ...match.players[0], hand: tileIds }, match.players[1]],
  };
}

section("destination mapping is stable");
assert.equal(destinationFromEnd(END.LEFT), BRANCH.MAIN_LEFT);
assert.equal(destinationFromEnd(END.RIGHT), BRANCH.MAIN_RIGHT);
assert.equal(destinationFromEnd(END.NORTH), BRANCH.SPINNER_TOP);
assert.equal(destinationFromEnd(END.SOUTH), BRANCH.SPINNER_BOTTOM);
assert.equal(coercePlayEnd(BRANCH.MAIN_RIGHT), END.RIGHT);
assert.equal(coercePlayEnd(BRANCH.SPINNER_TOP), END.NORTH);
assert.equal(
  annotateMoveDestination({ tileId: "6-3", end: END.LEFT }).destination,
  BRANCH.MAIN_LEFT
);

section("legal moves carry destination and never invent TOP/BOTTOM before spinner");
{
  const match = forceHand(createMatch({ seed: 1, playerCount: 2 }), ["3-6", "2-3"]);
  const opening = getLegalMoves(match.players[0].hand, match.board, match.byId);
  assert.ok(opening.every((move) => move.destination === BRANCH.MAIN_RIGHT));
  assert.ok(opening.every((move) => move.end === END.RIGHT));
}

section("pre-spinner: two non-doubles stay MAIN_LEFT/MAIN_RIGHT, TOP/BOTTOM empty");
{
  let match = forceHand(createMatch({ seed: 2, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
    "1-2",
    "0-1",
  ]);
  match = applyPlace(match, 0, "3-6", BRANCH.MAIN_RIGHT);
  assert.equal(match.spinnerId, null);
  assert.equal(match.board[0].destination, BRANCH.MAIN_RIGHT);
  match = applyPlace(match, 0, "2-3", BRANCH.MAIN_LEFT);
  const topology = buildBoardTopology(match);
  assertBoardTopology(topology);
  assert.equal(topology.firstDouble, null);
  assert.equal(topology.branches.SPINNER_TOP.length, 0);
  assert.equal(topology.branches.SPINNER_BOTTOM.length, 0);
  for (const tile of match.board) {
    const branch = topology.membership[tile.id];
    assert.ok(
      branch === BRANCH.MAIN_LEFT || branch === BRANCH.MAIN_RIGHT,
      `${tile.id} illegal branch ${branch}`
    );
    assert.notEqual(branch, BRANCH.SPINNER_TOP);
    assert.notEqual(branch, BRANCH.SPINNER_BOTTOM);
  }
  assert.equal(match.spinnerNorth.length, 0);
  assert.equal(match.spinnerSouth.length, 0);
}

section("pre-spinner leftover north/south arrays are discarded");
{
  const topology = buildBoardTopology({
    board: [
      { id: "6-3", left: 6, right: 3, destination: BRANCH.MAIN_RIGHT },
      { id: "3-2", left: 3, right: 2, destination: BRANCH.MAIN_RIGHT },
    ],
    spinnerId: null,
    spinnerNorth: [{ id: "ghost", left: 6, right: 1 }],
    spinnerSouth: [{ id: "ghost2", left: 6, right: 0 }],
  });
  assertBoardTopology(topology);
  assert.equal(topology.branches.SPINNER_TOP.length, 0);
  assert.equal(topology.branches.SPINNER_BOTTOM.length, 0);
  assert.equal(topology.membership.ghost, undefined);
}

section("pre-spinner four non-doubles");
{
  let match = forceHand(createMatch({ seed: 3, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
    "1-2",
    "0-1",
  ]);
  match = applyPlace(match, 0, "3-6", END.RIGHT);
  match = applyPlace(match, 0, "2-3", END.LEFT);
  match = applyPlace(match, 0, "1-2", END.LEFT);
  match = applyPlace(match, 0, "0-1", END.LEFT);
  const topology = buildBoardTopology(match);
  assertBoardTopology(topology);
  assert.equal(topology.firstDouble, null);
  assert.equal(topology.branches.SPINNER_TOP.length, 0);
  assert.equal(topology.branches.SPINNER_BOTTOM.length, 0);
  assert.equal(match.board.length, 4);
  assert.ok(match.board.every((tile) =>
    tile.destination === BRANCH.MAIN_RIGHT || tile.destination === BRANCH.MAIN_LEFT
  ));
}

section("first-double transition 6-3 — 3-2 — 2-2");
{
  let match = forceHand(createMatch({ seed: 4, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
    "2-2",
    "2-5",
  ]);
  match = applyPlace(match, 0, "3-6", BRANCH.MAIN_RIGHT);
  match = applyPlace(match, 0, "2-3", BRANCH.MAIN_LEFT);
  const before = buildBoardTopology(match);
  assert.equal(before.firstDouble, null);
  assert.equal(before.branches.SPINNER_TOP.length, 0);

  match = applyPlace(match, 0, "2-2", BRANCH.MAIN_LEFT);
  const after = buildBoardTopology(match);
  assertBoardTopology(after);
  assert.equal(after.firstDouble, "2-2");
  assert.equal(after.membership["2-2"], SPINNER_NODE);
  assert.equal(after.membership["3-6"], BRANCH.MAIN_RIGHT);
  assert.equal(after.membership["2-3"], BRANCH.MAIN_RIGHT);
  assert.equal(after.branches.SPINNER_TOP.length, 0);
  assert.equal(after.branches.SPINNER_BOTTOM.length, 0);
  assert.equal(match.board.find((t) => t.id === "3-6").destination, BRANCH.MAIN_RIGHT);
  assert.notEqual(after.membership["3-6"], BRANCH.SPINNER_TOP);
  assert.notEqual(after.membership["2-3"], BRANCH.SPINNER_BOTTOM);
}

section("MAIN_RIGHT cannot be applied as SPINNER_TOP before a spinner");
{
  let match = forceHand(createMatch({ seed: 5, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
  ]);
  match = applyPlace(match, 0, "3-6", BRANCH.MAIN_RIGHT);
  assert.throws(
    () => applyPlace(match, 0, "2-3", BRANCH.SPINNER_TOP),
    /before first double|Illegal placement/
  );
}

section("orientation helper: pre-spinner ordinary tiles are horizontal");
{
  const tile = { id: "6-3", left: 6, right: 3 };
  assert.equal(
    orientationForBranch(tile, BRANCH.MAIN_RIGHT, "E", false),
    "horizontal"
  );
  assert.equal(
    orientationForBranch(tile, BRANCH.MAIN_LEFT, "W", false),
    "horizontal"
  );
}

section("every spinner pip 0-0…6-6 is the same topology");
{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const leftId = `${(pip + 1) % 7}-${pip}`;
    const topology = buildBoardTopology({
      board: [
        { id: leftId, left: (pip + 1) % 7, right: pip, destination: BRANCH.MAIN_LEFT },
        { id, left: pip, right: pip, destination: BRANCH.MAIN_RIGHT },
      ],
      spinnerId: id,
      spinnerNorth: [],
      spinnerSouth: [],
    });
    assertBoardTopology(topology);
    assert.equal(topology.firstDouble, id);
    assert.equal(topology.membership[id], SPINNER_NODE);
    assert.equal(topology.membership[leftId], BRANCH.MAIN_LEFT);
    assert.equal(topology.branches.SPINNER_TOP.length, 0);
    assert.equal(topology.branches.SPINNER_BOTTOM.length, 0);
  }
}

console.log("\nBoard topology tests passed.");
