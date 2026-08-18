/**
 * American (allFives) legal-move contract for pip 0.
 * 0 is a real endpoint — never falsy / missing.
 * Run: node src/game/rules/allFivesZeroEnds.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTile, generateSet, indexTiles, tileHasPip } from "../tiles.js";
import { createBoard, placeTile, getOpenEnds, canPlaceOnEnd } from "../board.js";
import { END } from "../constants.js";
import { getLegalMoves } from "../moves.js";
import { getAvailableActions, playTile } from "./drawDominoes.js";
import {
  getAllFivesLegalMoves,
} from "./allFivesSpinner.js";
import { PHASE } from "./constants.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import {
  isAutoPlaceable,
  legalEndsForTile,
  resolvePlayChoice,
} from "../interaction.js";
import {
  destinationTileId,
  pickTargetDestination,
  resolveDestinationOutward,
  DESTINATION_TAP_SLOP_PX,
} from "../destinationTarget.js";
import { calculateBoardLayout } from "../../board/layoutEngine.js";

const here = dirname(fileURLToPath(import.meta.url));
const byId = indexTiles(generateSet());

function section(title) {
  console.log(`✓ ${title}`);
}

function allFivesState(board, hand, extra = {}) {
  return {
    byId,
    players: [
      { id: "you", hand },
      { id: "rival", hand: ["5-6"] },
    ],
    reserve: [],
    board,
    spinnerId: extra.spinnerId ?? null,
    spinnerNorth: extra.spinnerNorth ?? [],
    spinnerSouth: extra.spinnerSouth ?? [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: 200,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
  };
}

function boardWithRightZero() {
  let board = createBoard();
  board = placeTile(board, createTile(1, 4));
  board = placeTile(board, createTile(4, 0), END.RIGHT);
  return board;
}

{
  assert.equal(tileHasPip(createTile(0, 3), 0), true);
  assert.equal(tileHasPip(createTile(3, 0), 0), true);
  assert.equal(tileHasPip(createTile(0, 0), 0), true);
  assert.equal(tileHasPip(createTile(3, 2), 0), false);
  assert.equal(tileHasPip(createTile(0, 3), "0"), true);
  assert.equal(tileHasPip(createTile(0, 3), null), false);
  assert.equal(tileHasPip(createTile(0, 3), undefined), false);
  assert.equal(tileHasPip(createTile(0, 3), ""), false);
  section("tileHasPip treats 0 as a real pip, including string '0'");
}

{
  const board = boardWithRightZero();
  assert.deepEqual(getOpenEnds(board), { left: 1, right: 0 });
  assert.equal(canPlaceOnEnd(board, createTile(0, 3), END.RIGHT), true);
  assert.equal(canPlaceOnEnd(board, createTile(0, 2), END.RIGHT), true);
  assert.equal(canPlaceOnEnd(board, createTile(0, 0), END.RIGHT), true);
  assert.equal(canPlaceOnEnd(board, createTile(3, 2), END.RIGHT), false);
  assert.equal(canPlaceOnEnd(board, createTile(0, 3), END.LEFT), false);
  section("A. normal endpoint 0 accepts [3|0] [2|0] [0|0]");
}

{
  const board = boardWithRightZero();
  const hand = ["0-3", "0-2", "2-3"];
  const state = allFivesState(board, hand);
  const actions = getAvailableActions(state);
  const ids = actions.legalMoves.map((m) => `${m.tileId}:${m.end}`);
  assert.ok(ids.includes("0-3:right"), `legalMoves missing 0-3 right: ${ids}`);
  assert.ok(ids.includes("0-2:right"), `legalMoves missing 0-2 right: ${ids}`);
  assert.equal(ids.some((id) => id.startsWith("2-3:")), false);
  section("B. [3|2] is illegal on endpoint 0; selectable set matches legalMoves");
}

{
  const board = boardWithRightZero();
  const classic = getLegalMoves(["0-3"], board, byId);
  const american = getAllFivesLegalMoves(["0-3"], allFivesState(board, ["0-3"]));
  assert.deepEqual(
    classic.map((m) => m.end),
    american.map((m) => m.end)
  );
  assert.equal(classic[0].end, END.RIGHT);
  section("C. [0|3] and [3|0] share id 0-3 and are legal on 0");
}

{
  let board = placeTile(createBoard(), createTile(5, 5));
  board = placeTile(board, createTile(5, 1), END.RIGHT);
  const north = [{ id: "0-5", left: 5, right: 0 }];
  const state = allFivesState(board, ["0-2", "0-3"], {
    spinnerId: "5-5",
    spinnerNorth: north,
  });
  const moves = getAllFivesLegalMoves(["0-2", "0-3"], state);
  assert.ok(
    moves.some((m) => m.tileId === "0-2" && m.end === "north"),
    "spinner north exposing 0 must accept 0-2"
  );
  const after = playTile(state, "0-2", "north");
  assert.equal(after.spinnerNorth[after.spinnerNorth.length - 1].id, "0-2");
  assert.equal(after.spinnerNorth[after.spinnerNorth.length - 1].left, 0);
  section("D. spinner branch exposing 0 accepts [2|0]");
}

{
  let board = placeTile(createBoard(), createTile(0, 0));
  const state = allFivesState(board, ["0-3"], { spinnerId: "0-0" });
  const moves = getAllFivesLegalMoves(["0-3"], state);
  const ends = legalEndsForTile(moves, "0-3");
  assert.ok(ends.includes(END.LEFT), `missing left: ${ends}`);
  assert.ok(ends.includes(END.RIGHT), `missing right: ${ends}`);
  assert.ok(ends.includes("north"), `missing north: ${ends}`);
  assert.ok(ends.includes("south"), `missing south: ${ends}`);
  assert.equal(isAutoPlaceable(moves, "0-3"), false);
  assert.equal(resolvePlayChoice(moves, "0-3"), null);
  assert.equal(resolvePlayChoice(moves, "0-3", END.LEFT)?.end, END.LEFT);
  assert.equal(resolvePlayChoice(moves, "0-3", END.RIGHT)?.end, END.RIGHT);
  assert.equal(resolvePlayChoice(moves, "0-3", "north")?.end, "north");
  assert.equal(destinationTileId(END.LEFT, state), "0-0");
  assert.equal(destinationTileId(END.RIGHT, state), "0-0");
  assert.equal(destinationTileId("north", state), "0-0");
  const afterLeft = playTile(state, "0-3", END.LEFT);
  assert.equal(afterLeft.board[0].id, "0-3");
  const afterNorth = playTile(state, "0-3", "north");
  assert.equal(afterNorth.spinnerNorth[0].id, "0-3");
  section("E. multiple matching 0 endpoints stay distinct; chosen end is respected");
}

{
  const board = [];
  board.push({ id: "L0", left: 0, right: 1, orientation: "horizontal" });
  for (let i = 1; i <= 8; i += 1) {
    const a = i % 7;
    const b = (i + 1) % 7;
    board.push({
      id: `M${i}`,
      left: a,
      right: b,
      orientation: "horizontal",
    });
  }
  const layout = calculateBoardLayout(board, { width: 520, height: 280 }, {
    tileWidth: 40,
    tileHeight: 76,
  });
  const leftTip = layout.tiles.find((t) => t.tileId === "L0") || layout.tiles[0];
  assert.ok(leftTip, "folded chain keeps the logical left tile");
  assert.equal(destinationTileId(END.LEFT, { board }), "L0");
  assert.equal(getOpenEnds(board).left, 0);
  const state = allFivesState(board, ["0-3", "0-2"]);
  const moves = getAvailableActions(state).legalMoves;
  assert.ok(moves.some((m) => m.tileId === "0-3" && m.end === END.LEFT));
  const travelDir = leftTip.travelDir || "W";
  const outward = resolveDestinationOutward(END.LEFT, travelDir);
  const rect = {
    left: leftTip.x,
    top: leftTip.y,
    right: leftTip.x + leftTip.w,
    bottom: leftTip.y + leftTip.h,
  };
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const drop =
    outward === "E"
      ? { x: rect.right + 8, y: cy }
      : outward === "N"
        ? { x: cx, y: rect.top - 8 }
        : outward === "S"
          ? { x: cx, y: rect.bottom + 8 }
          : { x: rect.left - 8, y: cy };
  const picked = pickTargetDestination(drop.x, drop.y, [
    { end: END.LEFT, rect, outward },
  ]);
  assert.equal(picked, END.LEFT);
  section("F. folded chain: logical 0 endpoint stays playable; drop uses outward face");
}

{
  const board = boardWithRightZero();
  const state = allFivesState(board, ["0-3"]);
  const moves = getAvailableActions(state).legalMoves;
  assert.equal(isAutoPlaceable(moves, "0-3"), true);
  assert.equal(resolvePlayChoice(moves, "0-3")?.end, END.RIGHT);
  const dest = destinationTileId(END.RIGHT, state);
  assert.equal(dest, board[board.length - 1].id);
  const right = { left: 400, top: 180, right: 480, bottom: 220 };
  assert.equal(
    pickTargetDestination(470, 200, [{ end: END.RIGHT, rect: right }]),
    END.RIGHT
  );
  assert.equal(resolvePlayChoice(moves, "0-3", END.RIGHT)?.end, END.RIGHT);
  assert.ok(DESTINATION_TAP_SLOP_PX >= 12 && DESTINATION_TAP_SLOP_PX <= 32);
  section("G. tap auto-place and drag destination resolve to the same 0-end");
}

{
  const board = boardWithRightZero();
  assert.equal(getOpenEnds(board).left, 1);
  for (const pip of [1, 2, 3, 4, 5, 6]) {
    const tile = createTile(pip, pip);
    assert.equal(
      canPlaceOnEnd(board, tile, END.LEFT),
      pip === 1,
      `${tile.id} vs left 1`
    );
  }
  assert.equal(canPlaceOnEnd(board, createTile(2, 2), END.RIGHT), false);
  section("non-zero matching 1–6 is unchanged");
}

{
  const after = playTile(
    allFivesState(boardWithRightZero(), ["0-3"]),
    "0-3",
    END.RIGHT
  );
  assert.equal(after.board[after.board.length - 1].id, "0-3");
  assert.equal(after.board[after.board.length - 1].left, 0);
  section("apply/commit path accepts 0-3 on endpoint 0");
}

{
  const page = readFileSync(join(here, "../../pages/GamePage.jsx"), "utf8");
  const down = page.slice(
    page.indexOf("handleTilePointerDown"),
    page.indexOf("runDrawSequence")
  );
  assert.match(down, /if \(!ends\.length\) return/);
  assert.doesNotMatch(down, /ends\.length < 2/);
  assert.match(page, /DESTINATION_TAP_SLOP_PX/);
  assert.match(page, /data-travel-dir/);
  const board = readFileSync(join(here, "../../board/BoardContainer.jsx"), "utf8");
  assert.match(board, /data-travel-dir=\{pos\.travelDir/);
  section("tap and drag share one legal-move contract; unique 0-ends can drag");
}

console.log("American zero-endpoint legal-move tests passed.");
