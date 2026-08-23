/**
 * Topology → layout → display pipeline. The screenshot regression
 * (two non-doubles stacked vertically) must fail if branch is inferred
 * from rotation / bbox / spinner-center leftovers.
 *
 * Run: node src/board/boardTopology.layout.test.js
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
import { applyPlace, createMatch, END } from "../game/index.js";

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

function layoutFromMatch(match, extra = {}) {
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
    // Live BoardContainer used to pass the non-double opener as centerTileId.
    centerTileId: extra.centerTileId ?? topology.spinnerId ?? match.board[0]?.id,
    ...extra,
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

function assertHorizontalChain(layout, board, label) {
  assert.equal(layout.armTiles.length, 0, `${label}: invented TOP/BOTTOM`);
  const map = byId(layout);
  const ys = [];
  for (const tile of board) {
    const p = map[tile.id];
    assert.ok(p, `${label}: missing ${tile.id}`);
    const double = Number(tile.left) === Number(tile.right);
    if (!double) {
      assert.equal(p.orientation, "horizontal", `${label}: ${tile.id} orientation`);
      assert.ok(p.w > p.h + 0.5, `${label}: ${tile.id} stacked vertically ${p.w}x${p.h}`);
      assert.ok(
        p.branch === BRANCH.MAIN_LEFT || p.branch === BRANCH.MAIN_RIGHT,
        `${label}: ${tile.id} branch ${p.branch}`
      );
      assert.notEqual(p.branch, BRANCH.SPINNER_TOP, `${label}: ${tile.id} became TOP`);
      assert.notEqual(p.branch, BRANCH.SPINNER_BOTTOM, `${label}: ${tile.id} became BOTTOM`);
    }
    ys.push(centerOf(p).y);
  }
  const mid = ys[0];
  for (let i = 0; i < ys.length; i += 1) {
    assert.ok(
      Math.abs(ys[i] - mid) < 3,
      `${label}: tile ${board[i].id} left the horizontal Y axis (${ys[i]} vs ${mid})`
    );
  }
  for (let i = 0; i < board.length - 1; i += 1) {
    const a = map[board[i].id];
    const b = map[board[i + 1].id];
    assert.ok(centerOf(b).x > centerOf(a).x + 8, `${label}: ${board[i].id} / ${board[i + 1].id} stacked on x`);
  }
}

{
  // Screenshot regression: 2 non-doubles, no double yet.
  let match = forceHand(createMatch({ seed: 21, playerCount: 2, rulesetId: "allFives" }), [
    "2-5",
    "5-6",
    "0-1",
  ]);
  match = applyPlace(match, 0, "2-5", END.RIGHT);
  match = applyPlace(match, 0, "5-6", END.RIGHT);
  const layout = layoutFromMatch(match);
  assertHorizontalChain(layout, match.board, "A-two-non-doubles");

  const displays = buildBoardDisplays(match.board, layout.tiles.map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    branch: t.branch,
    travelDir: t.travelDir,
  })));
  for (const entry of displays) {
    assert.equal(entry.display.orientation, "horizontal", `A paint ${entry.tile.id}`);
  }
  console.log("✓ A. two non-doubles stay on one horizontal main line");
}

{
  let match = forceHand(createMatch({ seed: 22, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
    "1-2",
    "0-1",
  ]);
  match = applyPlace(match, 0, "3-6", BRANCH.MAIN_RIGHT);
  match = applyPlace(match, 0, "2-3", BRANCH.MAIN_LEFT);
  match = applyPlace(match, 0, "1-2", BRANCH.MAIN_LEFT);
  match = applyPlace(match, 0, "0-1", BRANCH.MAIN_LEFT);
  const layout = layoutFromMatch(match);
  assertHorizontalChain(layout, match.board, "B-four-non-doubles");
  console.log("✓ B. four non-doubles stay on one horizontal main line");
}

{
  let match = forceHand(createMatch({ seed: 23, playerCount: 2, rulesetId: "allFives" }), [
    "3-6",
    "2-3",
    "2-2",
  ]);
  match = applyPlace(match, 0, "3-6", BRANCH.MAIN_RIGHT);
  match = applyPlace(match, 0, "2-3", BRANCH.MAIN_LEFT);
  match = applyPlace(match, 0, "2-2", BRANCH.MAIN_LEFT);
  const layout = layoutFromMatch(match);
  const map = byId(layout);
  assert.equal(map["2-2"].branch, SPINNER_NODE);
  assert.ok(map["2-2"].w > map["2-2"].h, "C spinner is visually horizontal");
  assert.equal(map["3-6"].branch, BRANCH.MAIN_RIGHT);
  assert.equal(map["2-3"].branch, BRANCH.MAIN_RIGHT);
  assert.equal(map["3-6"].orientation, "horizontal");
  assert.equal(map["2-3"].orientation, "horizontal");
  assert.ok(centerOf(map["3-6"]).x > centerOf(map["2-2"]).x);
  assert.ok(Math.abs(centerOf(map["3-6"]).y - centerOf(map["2-2"]).y) <= 6);
  assert.equal(layout.armTiles.length, 0, "C TOP/BOTTOM empty until explicitly played");
  console.log("✓ C. first double re-anchors; previous tiles stay MAIN_RIGHT, not TOP/BOTTOM");
}

{
  for (const pip of [1, 3, 5, 6]) {
    const id = `${pip}-${pip}`;
    const left = { id: `L${pip}`, left: (pip + 1) % 7, right: pip };
    const right = { id: `R${pip}`, left: pip, right: (pip + 2) % 7 };
    const spin = { id, left: pip, right: pip };
    const topology = buildBoardTopology({
      board: [left, spin, right],
      spinnerId: id,
      spinnerNorth: [],
      spinnerSouth: [],
    });
    const layout = calculateBoardLayout([left, spin, right], VIEW, {
      tileWidth: TILE.w,
      tileHeight: TILE.h,
      hudRight: 0,
      spinnerId: id,
      topology,
      rulesetId: "allFives",
    });
    const map = byId(layout);
    assert.equal(map[id].branch, SPINNER_NODE, `${id} node`);
    assert.ok(map[id].w > map[id].h, `${id} horizontal spinner`);
    assert.equal(map[`L${pip}`].branch, BRANCH.MAIN_LEFT);
    assert.equal(map[`R${pip}`].branch, BRANCH.MAIN_RIGHT);
    assert.equal(map[`L${pip}`].orientation, "horizontal");
    assert.equal(map[`R${pip}`].orientation, "horizontal");
    assert.ok(centerOf(map[`L${pip}`]).x < centerOf(map[id]).x, `${id} left is west`);
    assert.ok(centerOf(map[`R${pip}`]).x > centerOf(map[id]).x, `${id} right is east`);
    assert.ok(Math.abs(centerOf(map[`L${pip}`]).y - centerOf(map[id]).y) <= 6);
    assert.ok(Math.abs(centerOf(map[`R${pip}`]).y - centerOf(map[id]).y) <= 6);
    assert.equal(layout.armTiles.length, 0, `${id} no invented arms`);
  }
  console.log("✓ D–G. 1-1 / 3-3 / 5-5 / 6-6 MAIN_LEFT/RIGHT stay horizontal");
}

{
  // A double used only as centerTileId (not spinnerId) must not open TOP/BOTTOM.
  const board = [
    { id: "5-6", left: 5, right: 6 },
    { id: "6-1", left: 6, right: 1 },
  ];
  const layout = calculateBoardLayout(board, VIEW, {
    tileWidth: TILE.w,
    tileHeight: TILE.h,
    hudRight: 0,
    centerTileId: "5-6",
    spinnerId: null,
  });
  assertHorizontalChain(layout, board, "no-false-spinner");
  console.log("✓ centerTileId on a non-double does not invent a spinner");
}

console.log("\nTopology layout pipeline tests passed.");
