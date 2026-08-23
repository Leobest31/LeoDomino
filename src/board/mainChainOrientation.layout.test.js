/**
 * American / All Fives main-chain orientation.
 * Spinner is a horizontal hub; MAIN_LEFT / MAIN_RIGHT stay on one E–W rail.
 * SPINNER_TOP / SPINNER_BOTTOM are explicit arms only.
 *
 * Run: node src/board/mainChainOrientation.layout.test.js
 */

import assert from "node:assert/strict";
import {
  calculateBoardLayout,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
} from "./layoutEngine.js";
import { buildBoardDisplays } from "./connectionDisplay.js";
import {
  BRANCH,
  SPINNER_NODE,
  assertBoardTopology,
  buildBoardTopology,
} from "../game/boardTopology.js";
import {
  applyPlace,
  createMatch,
  END,
  isAutoPlaceable,
  listLegalMoves,
  resolvePlayChoice,
} from "../game/index.js";
import { pickTargetDestination } from "../game/destinationTarget.js";

const TILE = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};
const VIEW = { width: 1280, height: 720 };

function forceHand(match, tileIds) {
  return {
    ...match,
    players: [{ ...match.players[0], hand: tileIds }, ...match.players.slice(1)],
  };
}

function layoutFromMatch(match) {
  const topology = buildBoardTopology(match);
  assertBoardTopology(topology);
  return calculateBoardLayout(match.board, VIEW, {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    hudLeft: 0,
    spinnerId: topology.spinnerId,
    spinnerNorth: topology.branches.SPINNER_TOP,
    spinnerSouth: topology.branches.SPINNER_BOTTOM,
    topology,
    rulesetId: match.rulesetId,
  });
}

function centerOf(p) {
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

function byId(layout) {
  return Object.fromEntries(
    [...layout.tiles, ...(layout.armTiles || [])].map((t) => [t.tileId, t])
  );
}

function displaysFor(board, layout) {
  return buildBoardDisplays(
    board,
    layout.tiles.map((t) => ({
      id: t.tileId,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      orientation: t.orientation,
      branch: t.branch,
      travelDir: t.travelDir,
    }))
  );
}

function assertHorizontalMain(layout, board, spinnerId, label) {
  const map = byId(layout);
  const spin = map[spinnerId];
  assert.ok(spin, `${label}: missing spinner ${spinnerId}`);
  assert.equal(spin.branch, SPINNER_NODE, `${label}: spinner branch`);
  assert.equal(spin.orientation, "horizontal", `${label}: spinner must be horizontal`);
  assert.ok(spin.w > spin.h + 0.5, `${label}: spinner footprint ${spin.w}x${spin.h}`);

  const spinY = centerOf(spin).y;
  for (const tile of board) {
    if (tile.id === spinnerId) continue;
    const p = map[tile.id];
    assert.ok(p, `${label}: missing ${tile.id}`);
    assert.ok(
      p.branch === BRANCH.MAIN_LEFT || p.branch === BRANCH.MAIN_RIGHT,
      `${label}: ${tile.id} branch ${p.branch} is not MAIN_*`
    );
    assert.notEqual(p.branch, BRANCH.SPINNER_TOP, `${label}: ${tile.id} became TOP`);
    assert.notEqual(p.branch, BRANCH.SPINNER_BOTTOM, `${label}: ${tile.id} became BOTTOM`);
    if (Number(tile.left) === Number(tile.right)) continue;
    assert.equal(p.orientation, "horizontal", `${label}: ${tile.id} orientation`);
    assert.ok(p.w > p.h + 0.5, `${label}: ${tile.id} stacked ${p.w}x${p.h}`);
    assert.ok(
      Math.abs(centerOf(p).y - spinY) <= 6,
      `${label}: ${tile.id} left the horizontal rail`
    );
  }
  assert.equal(layout.armTiles.length, 0, `${label}: invented TOP/BOTTOM`);
}

{
  // A) 6-6 Spinner + 6-5 on the main line.
  let match = forceHand(createMatch({ seed: 21, playerCount: 2, rulesetId: "allFives" }), [
    "6-6",
    "5-6",
    "0-1",
  ]);
  match = applyPlace(match, 0, "6-6", END.RIGHT);
  const moves = listLegalMoves(match, 0);
  assert.equal(isAutoPlaceable(moves, "5-6"), false, "A: both MAIN sides still open");
  assert.equal(resolvePlayChoice(moves, "5-6")?.end, undefined);
  const spinner = { left: 400, top: 200, right: 472, bottom: 336 };
  const body = pickTargetDestination(436, 268, [
    { end: END.LEFT, rect: spinner },
    { end: END.RIGHT, rect: spinner },
    { end: END.NORTH, rect: spinner },
    { end: END.SOUTH, rect: spinner },
  ]);
  assert.ok(body === END.LEFT || body === END.RIGHT, `A: body drop ${body}`);
  match = applyPlace(match, 0, "5-6", body);
  const layout = layoutFromMatch(match);
  assertHorizontalMain(layout, match.board, "6-6", "A");
  const painted = displaysFor(match.board, layout);
  const six = painted.find((e) => e.tile.id === "6-6");
  const five = painted.find((e) => e.tile.id === "5-6");
  assert.equal(six.display.orientation, "horizontal");
  assert.equal(five.display.orientation, "horizontal");
  console.log("✓ A. 6-6 spinner + 6-5 is a horizontal main chain");
}

{
  // B) 3-3 Spinner + 3-4
  let match = forceHand(createMatch({ seed: 22, playerCount: 2, rulesetId: "allFives" }), [
    "3-3",
    "3-4",
    "0-1",
  ]);
  match = applyPlace(match, 0, "3-3", END.RIGHT);
  match = applyPlace(match, 0, "3-4", END.RIGHT);
  assertHorizontalMain(layoutFromMatch(match), match.board, "3-3", "B");
  console.log("✓ B. 3-3 spinner + 3-4 is a horizontal main chain");
}

{
  // C) 1-1 Spinner + 1-6
  let match = forceHand(createMatch({ seed: 23, playerCount: 2, rulesetId: "allFives" }), [
    "1-1",
    "1-6",
    "0-2",
  ]);
  match = applyPlace(match, 0, "1-1", END.RIGHT);
  match = applyPlace(match, 0, "1-6", END.LEFT);
  assertHorizontalMain(layoutFromMatch(match), match.board, "1-1", "C");
  console.log("✓ C. 1-1 spinner + 1-6 is a horizontal main chain");
}

{
  // D) Normal tiles before the first double; spinner recenters the rail.
  let match = forceHand(createMatch({ seed: 24, playerCount: 2, rulesetId: "allFives" }), [
    "5-6",
    "2-5",
    "2-2",
    "0-1",
  ]);
  match = applyPlace(match, 0, "5-6", END.RIGHT);
  match = applyPlace(match, 0, "2-5", END.LEFT);
  assert.equal(match.spinnerId, null);
  let layout = layoutFromMatch(match);
  assert.equal(layout.tiles.every((t) => t.orientation === "horizontal"), true, "D pre-spinner");
  match = applyPlace(match, 0, "2-2", END.LEFT);
  assert.equal(match.spinnerId, "2-2");
  layout = layoutFromMatch(match);
  assertHorizontalMain(layout, match.board, "2-2", "D");
  const map = byId(layout);
  assert.ok(centerOf(map["5-6"]).x > centerOf(map["2-2"]).x, "D previous tiles stay MAIN_RIGHT");
  assert.ok(centerOf(map["2-5"]).x > centerOf(map["2-2"]).x);
  console.log("✓ D. first double later recenters a horizontal main chain");
}

{
  // E) LEFT ← vertical spinner → RIGHT
  let match = forceHand(createMatch({ seed: 25, playerCount: 2, rulesetId: "allFives" }), [
    "4-4",
    "3-4",
    "4-6",
    "0-1",
  ]);
  match = applyPlace(match, 0, "4-4", END.RIGHT);
  match = applyPlace(match, 0, "3-4", END.LEFT);
  match = applyPlace(match, 0, "4-6", END.RIGHT);
  const layout = layoutFromMatch(match);
  assertHorizontalMain(layout, match.board, "4-4", "E");
  const map = byId(layout);
  assert.ok(centerOf(map["3-4"]).x < centerOf(map["4-4"]).x, "E LEFT is west");
  assert.ok(centerOf(map["4-6"]).x > centerOf(map["4-4"]).x, "E RIGHT is east");
  console.log("✓ E. LEFT ← horizontal spinner → RIGHT");
}

{
  // F) Explicit TOP/BOTTOM grow perpendicular and do not redefine the main line.
  let match = forceHand(createMatch({ seed: 26, playerCount: 2, rulesetId: "allFives" }), [
    "5-5",
    "4-5",
    "5-6",
    "3-5",
    "2-5",
    "0-1",
  ]);
  match = applyPlace(match, 0, "5-5", END.RIGHT);
  match = applyPlace(match, 0, "4-5", END.LEFT);
  match = applyPlace(match, 0, "5-6", END.RIGHT);
  match = applyPlace(match, 0, "3-5", END.NORTH);
  match = applyPlace(match, 0, "2-5", END.SOUTH);
  const layout = layoutFromMatch(match);
  const map = byId(layout);
  assert.equal(map["5-5"].orientation, "horizontal");
  assert.equal(map["4-5"].branch, BRANCH.MAIN_LEFT);
  assert.equal(map["5-6"].branch, BRANCH.MAIN_RIGHT);
  assert.equal(map["4-5"].orientation, "horizontal");
  assert.equal(map["5-6"].orientation, "horizontal");
  assert.ok(centerOf(map["4-5"]).x < centerOf(map["5-5"]).x);
  assert.ok(centerOf(map["5-6"]).x > centerOf(map["5-5"]).x);
  const north = layout.armTiles.find((t) => t.tileId === "3-5");
  const south = layout.armTiles.find((t) => t.tileId === "2-5");
  assert.ok(north, "F TOP exists");
  assert.ok(south, "F BOTTOM exists");
  assert.equal(north.branch, BRANCH.SPINNER_TOP);
  assert.equal(south.branch, BRANCH.SPINNER_BOTTOM);
  assert.ok(centerOf(north).y < centerOf(map["5-5"]).y, "F TOP is above");
  assert.ok(centerOf(south).y > centerOf(map["5-5"]).y, "F BOTTOM is below");
  assert.ok(
    Math.abs(centerOf(map["4-5"]).y - centerOf(map["5-5"]).y) <= 6,
    "F main line stays horizontal"
  );
  console.log("✓ F. TOP/BOTTOM are perpendicular arms; main chain stays E–W");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const leftId = `${(pip + 1) % 7}-${pip}`;
    const rightId = `${pip}-${(pip + 2) % 7}`;
    const leftTile = {
      id: leftId,
      left: (pip + 1) % 7,
      right: pip,
    };
    const spin = { id, left: pip, right: pip };
    const rightTile = {
      id: rightId,
      left: pip,
      right: (pip + 2) % 7,
    };
    const topology = buildBoardTopology({
      board: [leftTile, spin, rightTile],
      spinnerId: id,
      spinnerNorth: [],
      spinnerSouth: [],
    });
    assert.equal(topology.membership[leftId], BRANCH.MAIN_LEFT, `${id} LEFT membership`);
    assert.equal(topology.membership[id], SPINNER_NODE, `${id} spinner membership`);
    assert.equal(topology.membership[rightId], BRANCH.MAIN_RIGHT, `${id} RIGHT membership`);
    assert.equal(topology.branches[BRANCH.SPINNER_TOP].length, 0);
    assert.equal(topology.branches[BRANCH.SPINNER_BOTTOM].length, 0);

    const layout = calculateBoardLayout([leftTile, spin, rightTile], VIEW, {
      tileWidth: TILE.w,
      tileHeight: TILE.h,
      hudRight: 0,
      spinnerId: id,
      topology,
      rulesetId: "american",
    });
    assertHorizontalMain(layout, [leftTile, spin, rightTile], id, `${id}`);
    const map = byId(layout);
    assert.ok(centerOf(map[leftId]).x < centerOf(map[id]).x, `${id} LEFT is west`);
    assert.ok(centerOf(map[rightId]).x > centerOf(map[id]).x, `${id} RIGHT is east`);
  }
  console.log("✓ spinner 0-0 through 6-6: MAIN_LEFT / MAIN_RIGHT stay horizontal");
}

console.log("\nMain-chain orientation tests passed.");
