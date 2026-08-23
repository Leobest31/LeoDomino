/**
 * Destination targeting — proximity to real chain endpoints.
 * Run: node src/game/destinationTarget.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { END } from "./constants.js";
import {
  destinationTileId,
  destinationHighlightMap,
  pickTargetDestination,
  resolveDestinationOutward,
} from "./destinationTarget.js";
import { isAutoPlaceable, resolvePlayChoice, legalEndsForTile } from "./interaction.js";

function rect(left, top, w, h) {
  return { left, top, right: left + w, bottom: top + h, width: w, height: h };
}

function section(title) {
  console.log(`✓ ${title}`);
}

{
  const board = [{ id: "L-end" }, { id: "spin" }, { id: "R-end" }];
  const layout = {
    board,
    spinnerId: "spin",
    spinnerNorth: [{ id: "N1" }],
    spinnerSouth: [],
  };
  assert.equal(destinationTileId(END.LEFT, layout), "L-end");
  assert.equal(destinationTileId(END.RIGHT, layout), "R-end");
  assert.equal(destinationTileId(END.NORTH, layout), "N1");
  assert.equal(destinationTileId(END.SOUTH, layout), "spin");
  const map = destinationHighlightMap(["left", "right", "north", "south"], layout);
  assert.equal(map.left, "L-end");
  assert.equal(map.south, "spin");
  section("anchors map to real left/right/spinner tiles");
}

{
  const moves = [{ tileId: "3-0", end: END.RIGHT, left: 0, right: 3, orientation: "horizontal" }];
  assert.equal(isAutoPlaceable(moves, "3-0"), true);
  assert.equal(resolvePlayChoice(moves, "3-0")?.end, END.RIGHT);
  assert.equal(resolvePlayChoice(moves, "3-0", END.LEFT), null);
  section("Case A — exactly one legal move auto-plays that destination");
}

{
  const left = rect(40, 200, 80, 40);
  const right = rect(520, 200, 80, 40);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.RIGHT, rect: right },
  ];
  const moves = [
    { tileId: "3-0", end: END.LEFT, left: 3, right: 0, orientation: "horizontal" },
    { tileId: "3-0", end: END.RIGHT, left: 0, right: 3, orientation: "horizontal" },
  ];
  assert.equal(isAutoPlaceable(moves, "3-0"), false);
  assert.equal(resolvePlayChoice(moves, "3-0"), null);
  assert.equal(pickTargetDestination(50, 220, targets), END.LEFT);
  assert.equal(resolvePlayChoice(moves, "3-0", END.LEFT)?.end, END.LEFT);
  assert.equal(pickTargetDestination(560, 220, targets), END.RIGHT);
  assert.equal(resolvePlayChoice(moves, "3-0", END.RIGHT)?.end, END.RIGHT);
  section("Case B — left and right both legal; nearest end is played");
}

{
  const left = rect(40, 200, 80, 40);
  const spinner = rect(280, 180, 40, 80);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.NORTH, rect: spinner },
    { end: END.SOUTH, rect: spinner },
  ];
  const moves = [
    { tileId: "3-0", end: END.LEFT, left: 3, right: 0, orientation: "horizontal" },
    { tileId: "3-0", end: "north", left: 3, right: 0, orientation: "vertical" },
    { tileId: "3-0", end: "south", left: 3, right: 0, orientation: "vertical" },
  ];
  assert.equal(isAutoPlaceable(moves, "3-0"), true);
  assert.equal(resolvePlayChoice(moves, "3-0")?.end, END.LEFT);
  assert.ok(legalEndsForTile(moves, "3-0").includes(END.LEFT));
  assert.ok(legalEndsForTile(moves, "3-0").includes("north"));
  assert.equal(pickTargetDestination(60, 220, targets), END.LEFT);
  assert.equal(pickTargetDestination(300, 170, targets), "north");
  assert.equal(pickTargetDestination(300, 270, targets), "south");
  section("Case C — unique LEFT auto-places; spinner TOP/BOTTOM stay explicit");
}

{
  const left = rect(40, 200, 80, 40);
  const right = rect(520, 200, 80, 40);
  const spinner = rect(280, 180, 40, 80);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.RIGHT, rect: right },
    { end: END.NORTH, rect: spinner },
  ];
  const chosen = pickTargetDestination(300, 175, targets);
  assert.equal(chosen, "north");
  const moves = [
    { tileId: "3-0", end: END.LEFT },
    { tileId: "3-0", end: END.RIGHT },
    { tileId: "3-0", end: "north" },
  ];
  assert.equal(isAutoPlaceable(moves, "3-0"), false);
  assert.equal(resolvePlayChoice(moves, "3-0", chosen)?.end, "north");
  section("Case D — three destinations; closest target is the only play");
}

{
  const left = rect(40, 200, 80, 40);
  const right = rect(520, 200, 80, 40);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.RIGHT, rect: right },
  ];
  assert.equal(pickTargetDestination(300, 80, targets), null);
  const moves = [
    { tileId: "3-0", end: END.LEFT },
    { tileId: "3-0", end: END.RIGHT },
  ];
  assert.equal(resolvePlayChoice(moves, "3-0", null), null);
  section("Case E — invalid drag has no highlight and no fallback play");
}

{
  const left = rect(40, 200, 80, 40);
  const right = rect(520, 200, 80, 40);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.RIGHT, rect: right },
  ];
  assert.equal(pickTargetDestination(55, 220, targets), END.LEFT);
  const afterMove = pickTargetDestination(555, 220, targets);
  assert.equal(afterMove, END.RIGHT);
  const moves = [
    { tileId: "3-0", end: END.LEFT },
    { tileId: "3-0", end: END.RIGHT },
  ];
  assert.equal(resolvePlayChoice(moves, "3-0", afterMove)?.end, END.RIGHT);
  section("Case F — moving from LEFT to RIGHT switches the single highlight");
}

{
  const left = rect(40, 200, 80, 40);
  const right = rect(520, 200, 80, 40);
  const targets = [
    { end: END.LEFT, rect: left },
    { end: END.RIGHT, rect: right },
  ];
  const touchX = 48;
  const touchY = 210;
  assert.equal(pickTargetDestination(touchX, touchY, targets), END.LEFT);
  section("Case G — pointer/touch coordinates use the same destination picker");
}

{
  // Vertical spinner 72×136: LEFT/RIGHT are the long faces for every pip.
  const spinner = rect(548, 292, 72, 136);
  const targets = [
    { end: END.LEFT, rect: spinner },
    { end: END.RIGHT, rect: spinner },
    { end: END.NORTH, rect: spinner },
    { end: END.SOUTH, rect: spinner },
  ];
  const cx = 548 + 36;
  const cy = 292 + 68;
  for (let pip = 0; pip <= 6; pip += 1) {
    assert.equal(pickTargetDestination(cx - 20, cy, targets), END.LEFT, `${pip}-${pip} body-left`);
    assert.equal(pickTargetDestination(cx + 20, cy, targets), END.RIGHT, `${pip}-${pip} body-right`);
    assert.equal(
      pickTargetDestination(cx, cy, targets),
      END.LEFT,
      `${pip}-${pip} body-center is main chain, not TOP/BOTTOM`
    );
    assert.equal(
      pickTargetDestination(cx, 292 + 20, targets),
      END.LEFT,
      `${pip}-${pip} upper body is still LEFT/RIGHT`
    );
    assert.equal(
      pickTargetDestination(cx, 292 + 136 - 20, targets),
      END.LEFT,
      `${pip}-${pip} lower body is still LEFT/RIGHT`
    );
    assert.equal(pickTargetDestination(cx, 292 - 12, targets), END.NORTH, `${pip}-${pip} above`);
    assert.equal(pickTargetDestination(cx, 292 + 136 + 12, targets), END.SOUTH, `${pip}-${pip} below`);
    const moves = [
      { tileId: `${pip}-${(pip + 1) % 7}`, end: END.LEFT },
      { tileId: `${pip}-${(pip + 1) % 7}`, end: END.RIGHT },
      { tileId: `${pip}-${(pip + 1) % 7}`, end: END.NORTH },
      { tileId: `${pip}-${(pip + 1) % 7}`, end: END.SOUTH },
    ];
    const tileId = `${Math.min(pip, (pip + 1) % 7)}-${Math.max(pip, (pip + 1) % 7)}`;
    const four = moves.map((m) => ({ ...m, tileId }));
    assert.equal(isAutoPlaceable(four, tileId), false, `${pip} four-way is a player choice`);
    assert.equal(resolvePlayChoice(four, tileId), null);
    assert.equal(resolvePlayChoice(four, tileId, END.LEFT)?.end, END.LEFT);
    assert.equal(resolvePlayChoice(four, tileId, END.NORTH)?.end, END.NORTH);
  }
  section("E. spinner 0-0…6-6: body drop is LEFT/RIGHT; only explicit top/bottom is N/S");
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const tableJsx = readFileSync(join(here, "../components/GameTable.jsx"), "utf8");
  const tableCss = readFileSync(join(here, "../components/GameTable.css"), "utf8");
  assert.equal(tableJsx.includes("data-drop-end"), false);
  assert.equal(tableJsx.includes("game-table__drop"), false);
  assert.equal(tableCss.includes("game-table__drop"), false);
  section("felt drop-zone rectangles are removed");
}

{
  const folded = rect(200, 80, 80, 40);
  const targets = [{ end: END.LEFT, rect: folded, outward: "E" }];
  assert.equal(pickTargetDestination(folded.right + 10, 100, targets), END.LEFT);
  assert.equal(
    resolveDestinationOutward(END.LEFT, "E"),
    "E",
    "folded LEFT keeps logical LEFT with east outward face"
  );
  assert.equal(
    resolveDestinationOutward(END.NORTH, "E", { spinnerHub: true }),
    null,
    "spinner hub N/S do not inherit main-chain travelDir"
  );
  assert.equal(
    resolveDestinationOutward(END.NORTH, "N", { spinnerHub: true, american: true }),
    "W",
    "American spinner NORTH is the west/left short face"
  );
  assert.equal(
    resolveDestinationOutward(END.SOUTH, "S", { spinnerHub: true, american: true }),
    "E",
    "American spinner SOUTH is the east/right short face"
  );
  assert.equal(
    resolveDestinationOutward(END.LEFT, "N", { spinnerHub: true, american: true }),
    "S",
    "American spinner LEFT is the south long face"
  );
  assert.equal(
    resolveDestinationOutward(END.RIGHT, "N", { spinnerHub: true, american: true }),
    "N",
    "American spinner RIGHT is the north long face"
  );
  const americanHub = rect(400, 200, 136, 40);
  const americanTargets = [
    { end: END.LEFT, rect: americanHub, outward: "S" },
    { end: END.RIGHT, rect: americanHub, outward: "N" },
    { end: END.NORTH, rect: americanHub, outward: "W" },
    { end: END.SOUTH, rect: americanHub, outward: "E" },
  ];
  const cx = (americanHub.left + americanHub.right) / 2;
  const cy = (americanHub.top + americanHub.bottom) / 2;
  assert.ok(
    pickTargetDestination(cx, cy, americanTargets) === END.LEFT ||
      pickTargetDestination(cx, cy, americanTargets) === END.RIGHT,
    "American spinner body is a main-chain play"
  );
  assert.equal(
    pickTargetDestination(americanHub.left - 8, cy, americanTargets),
    END.NORTH,
    "tap left of the horizontal spinner is NORTH (left branch)"
  );
  assert.equal(
    pickTargetDestination(americanHub.right + 8, cy, americanTargets),
    END.SOUTH,
    "tap right of the horizontal spinner is SOUTH (right branch)"
  );
  section("folded LEFT endpoint keeps logical id; hit tests the outward face");
}

console.log("\nDestination targeting tests passed.");
