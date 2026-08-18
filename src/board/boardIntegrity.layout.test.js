/**
 * Permanent board-integrity invariant: after every incremental play,
 * playedTileCount === layoutTileCount === unique rendered IDs.
 *
 * Run: node src/board/boardIntegrity.layout.test.js
 */
import assert from "node:assert/strict";
import {
  startMatch,
  getAvailableActions,
  playTile,
  drawTile,
  passTurn,
  PHASE,
} from "../game/index.js";
import {
  calculateBoardLayout,
  computePlayBounds,
  computeSafeFeltBounds,
  computeChainBounds,
  resolveBoardTileBase,
  MARGIN,
} from "./layoutEngine.js";
import {
  assertBoardLayoutIntegrity,
  inspectBoardLayoutIntegrity,
  playedTableTiles,
} from "./boardIntegrity.js";
import { resolveGameplayLayout } from "../ui/gameplayLayout.js";
import { buildBoardDisplays, buildSpinnerArmDisplays } from "./connectionDisplay.js";

const LENGTHS = [3, 5, 10, 15, 20, 23, 24, 25, 26, 27, 28];

const FIXTURES = [
  { name: "iphone-classic-2", vp: { width: 876, height: 440 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
  { name: "iphone-classic-3", vp: { width: 876, height: 440 }, opt: { playerCount: 3, rulesetId: "legacy" }, inset: true },
  { name: "iphone-classic-4", vp: { width: 876, height: 440 }, opt: { playerCount: 4, rulesetId: "legacy" }, inset: true },
  { name: "a37-classic-2", vp: { width: 832, height: 384 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
  { name: "tablet-classic-2", vp: { width: 1340, height: 800 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
  { name: "portrait-iphone", vp: { width: 390, height: 844 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
  { name: "portrait-android", vp: { width: 360, height: 740 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
  { name: "portrait-tall", vp: { width: 412, height: 915 }, opt: { playerCount: 2, rulesetId: "legacy" }, inset: false },
];

const LIVE_RULESETS = [
  { id: "legacy", counts: [2, 3, 4] },
  { id: "allFives", counts: [2, 3, 4] },
  { id: "american", counts: [2, 3, 4] },
  { id: "haitian", counts: [2, 4] },
  { id: "dominican", counts: [2, 4] },
  { id: "puertorican", counts: [2, 4] },
];

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function fourWay(leftCount, rightCount, northCount, southCount) {
  const board = [dbl("3-3", 3)];
  let leftPip = 3;
  for (let i = 1; i <= leftCount; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 3;
  for (let i = 1; i <= rightCount; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  const north = [];
  let nPip = 3;
  for (let i = 1; i <= northCount; i += 1) {
    const next = (nPip + 3) % 7;
    north.push(tile(`N${i}`, nPip, next));
    nPip = next;
  }
  const south = [];
  let sPip = 3;
  for (let i = 1; i <= southCount; i += 1) {
    const next = (sPip + 4) % 7;
    south.push(tile(`S${i}`, sPip, next));
    sPip = next;
  }
  return { board, north, south };
}

function stageOf(spec) {
  const L = resolveGameplayLayout(spec.vp, spec.opt);
  const stage = {
    width: spec.inset
      ? Math.max(220, Math.round(L.feltWidth - 154))
      : Math.round(L.feltWidth),
    height: Math.round(L.feltHeight),
  };
  const tileSize = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
  return { L, stage, tileSize };
}

function layoutPacked(stage, tileSize, packed) {
  return calculateBoardLayout(packed.board, stage, {
    centerTileId: packed.board.find((t) => t.id === "3-3") ? "3-3" : packed.board[0]?.id,
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
    hudRight: 0,
    spinnerId: packed.board.some((t) => t.id === "3-3") ? "3-3" : null,
    spinnerNorth: packed.north,
    spinnerSouth: packed.south,
  });
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function neighborsJoin(a, b) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  if (xOv && yOv) return false;
  return xOv || yOv;
}

function assertRendered(layout, packed, label) {
  const played = playedTableTiles(packed.board, packed.north, packed.south);
  assertBoardLayoutIntegrity(layout, played, { failureReason: label });
  const placements = layout.tiles.map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    travelDir: t.travelDir,
    branch: t.branch,
  }));
  const armPlacements = (layout.armTiles || []).map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    travelDir: t.travelDir,
    branch: t.branch,
  }));
  const displays = buildBoardDisplays(packed.board, placements);
  const spinPos = placements.find((p) => p.id === "3-3") || placements[0];
  const armDisplays = spinPos
    ? buildSpinnerArmDisplays(spinPos, packed.north, packed.south, layout.gap ?? 2, armPlacements)
    : [];
  const rendered = [...displays, ...armDisplays].filter((e) => e?.tile?.id);
  assert.equal(rendered.length, played.length, `${label} renderer entries`);
  const unique = new Set(rendered.map((e) => e.tile.id));
  assert.equal(unique.size, played.length, `${label} unique renderer ids`);
  for (const tile of played) {
    assert.ok(unique.has(tile.id), `${label} renderer missing ${tile.id}`);
  }
  const boxes = [...layout.tiles, ...(layout.armTiles || [])];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(
        !boxesOverlap(boxes[i], boxes[j]),
        `${label} overlap ${boxes[i].tileId}/${boxes[j].tileId}`
      );
    }
  }
  const byId = Object.fromEntries(boxes.map((t) => [t.tileId, t]));
  for (let i = 0; i < packed.board.length - 1; i += 1) {
    const a = byId[packed.board[i].id];
    const b = byId[packed.board[i + 1].id];
    assert.ok(a && b, `${label} chain missing ${packed.board[i].id}/${packed.board[i + 1].id}`);
    assert.ok(neighborsJoin(a, b), `${label} disconnected ${packed.board[i].id}→${packed.board[i + 1].id}`);
  }
  return boxes;
}

function assertInsideSafe(layout, stage, label) {
  const play = computePlayBounds(stage, MARGIN, 0, 0);
  const safe = computeSafeFeltBounds(play);
  for (const t of [...layout.tiles, ...(layout.armTiles || [])]) {
    assert.ok(t.x >= safe.minX - 0.75, `${label} ${t.tileId} x`);
    assert.ok(t.y >= safe.minY - 0.75, `${label} ${t.tileId} y`);
    assert.ok(t.x + t.w <= safe.maxX + 0.75, `${label} ${t.tileId} r`);
    assert.ok(t.y + t.h <= safe.maxY + 0.75, `${label} ${t.tileId} b`);
  }
}

{
  const incomplete = inspectBoardLayoutIntegrity(
    { tiles: [{ tileId: "a", x: 1, y: 1, w: 10, h: 10, orientation: "horizontal" }], armTiles: [], scale: 1 },
    [{ id: "a" }, { id: "b" }]
  );
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reason, "missing-tiles");
  assert.deepEqual(incomplete.missing, ["b"]);
  console.log("✓ integrity inspector flags missing tile IDs");
}

{
  const spec = FIXTURES[0];
  const { stage, tileSize } = stageOf(spec);
  let left = 0;
  let right = 0;
  for (let n = 1; n <= 28; n += 1) {
    if (n > 1) {
      if (n % 2 === 0) left += 1;
      else right += 1;
    }
    const packed = fourWay(left, right, 0, 0);
    const layout = layoutPacked(stage, tileSize, packed);
    const label = `${spec.name} bilateral n=${n}`;
    assertRendered(layout, packed, label);
    assertInsideSafe(layout, stage, label);
  }
  console.log("✓ synthetic Classic snake stays complete after every added tile through 28");
}

{
  const spec = FIXTURES[0];
  const { stage, tileSize, L } = stageOf(spec);
  let left = 0;
  let right = 0;
  let north = 0;
  let south = 0;
  for (let n = 1; n <= 28; n += 1) {
    if (n > 1) {
      const lane = (n - 2) % 4;
      if (lane === 0) left += 1;
      else if (lane === 1) right += 1;
      else if (lane === 2) north += 1;
      else south += 1;
    }
    const packed = fourWay(left, right, north, south);
    const layout = layoutPacked(stage, tileSize, packed);
    const label = `${spec.name} spinner n=${n}`;
    assertRendered(layout, packed, label);
    assertInsideSafe(layout, stage, label);
    if (n === 25) {
      const boxes = [...layout.tiles, ...(layout.armTiles || [])];
      const play = computePlayBounds(stage, MARGIN, 0, 0);
      const safe = computeSafeFeltBounds(play);
      const aabb = computeChainBounds(
        boxes.map((t) => ({ id: t.tileId, x: t.x, y: t.y, w: t.w, h: t.h }))
      );
      console.log(
        `25-tile Classic 2p phone after integrity fix: felt ${stage.width}×${stage.height} ` +
          `safe ${(safe.maxX - safe.minX).toFixed(0)}×${(safe.maxY - safe.minY).toFixed(0)} ` +
          `aabb ${aabb.width.toFixed(1)}×${aabb.height.toFixed(1)} ` +
          `util ${((aabb.width / (safe.maxX - safe.minX)) * 100).toFixed(0)}%×${((aabb.height / (safe.maxY - safe.minY)) * 100).toFixed(0)}% ` +
          `tile ${Math.min(boxes[0].w, boxes[0].h).toFixed(1)}×${Math.max(boxes[0].w, boxes[0].h).toFixed(1)} ` +
          `(preferred ${tileSize.w.toFixed(1)}×${tileSize.h.toFixed(1)}) ` +
          `scale ${layout.scale.toFixed(3)} (preferred 1.000)`
      );
      assert.ok(layout.scale + 0.001 >= 0.54, `25-tile scale ${layout.scale.toFixed(3)}`);
      void L;
    }
  }
  console.log("✓ synthetic four-way board stays complete after every added tile through 28");
}

{
  for (const spec of FIXTURES) {
    const { stage, tileSize } = stageOf(spec);
    for (const n of LENGTHS) {
      const left = Math.ceil((n - 1) / 2);
      const right = n - 1 - left;
      const packed = fourWay(left, right, 0, 0);
      const layout = layoutPacked(stage, tileSize, packed);
      assertRendered(layout, packed, `${spec.name} n=${n}`);
      assertInsideSafe(layout, stage, `${spec.name} n=${n}`);
    }
  }
  console.log("✓ 3/5/10/15/20/23–28 completeness holds on phone and tablet fixtures");
}

function advance(state) {
  const actions = getAvailableActions(state);
  if (actions.legalMoves.length > 0) {
    const move = actions.legalMoves[0];
    return playTile(state, move.tileId, move.end);
  }
  if (actions.canDraw) return drawTile(state);
  if (actions.canPass) return passTurn(state);
  return state;
}

{
  const vp = { width: 876, height: 440 };
  for (const ruleset of LIVE_RULESETS) {
    for (const playerCount of ruleset.counts) {
      const spec = {
        name: `${ruleset.id}-${playerCount}p`,
        vp,
        opt: { playerCount, rulesetId: ruleset.id },
        inset: playerCount >= 3,
      };
      const { stage, tileSize } = stageOf(spec);
      let state = startMatch({
        seed: 8125,
        playerCount,
        rulesetId: ruleset.id,
        targetScore: 100,
      });
      let steps = 0;
      const seen = new Set();
      while (state.phase === PHASE.PLAYING && steps < 90) {
        const before = playedTableTiles(state.board, state.spinnerNorth, state.spinnerSouth).length;
        const next = advance(state);
        if (next === state) break;
        state = next;
        steps += 1;
        const packed = {
          board: state.board,
          north: state.spinnerNorth || [],
          south: state.spinnerSouth || [],
        };
        const after = playedTableTiles(packed.board, packed.north, packed.south).length;
        if (after === before) continue;
        seen.add(after);
        const layout = calculateBoardLayout(packed.board, stage, {
          centerTileId: state.spinnerId || packed.board[0]?.id,
          tileWidth: tileSize.w,
          tileHeight: tileSize.h,
          hudRight: 0,
          spinnerId: state.spinnerId,
          spinnerNorth: packed.north,
          spinnerSouth: packed.south,
        });
        const label = `${spec.name} live n=${after} step=${steps}`;
        assertRendered(layout, packed, label);
        assertInsideSafe(layout, stage, label);
        if (after >= 28) break;
      }
      for (const n of LENGTHS) {
        if (n > 20 && !seen.has(n) && !seen.has(n - 1) && !seen.has(n + 1)) continue;
      }
    }
  }
  console.log("✓ live incremental matches stay complete across Classic/American/Haitian/Dominican/Puerto Rican");
}

console.log("Board integrity layout tests passed.");
