/**
 * Board Layout Engine — stop-on-first-overlap stress (50 / 100 / 200 / 500).
 *
 * If ONE overlap or incomplete placement occurs: STOP and report
 * move count + responsible domino ids.
 */
import assert from "node:assert/strict";
import {
  layoutBoard,
  computePlayBounds,
  MARGIN,
  CHAIN_GAP,
} from "./BoardLayoutEngine.js";
import { edgeClearance } from "./boardDebug.js";

const SIZE = { w: 40, h: 76 };

const VIEWPORTS = [
  { width: 360, height: 280, name: "phone" },
  { width: 768, height: 420, name: "tablet" },
  { width: 1100, height: 520, name: "desktop" },
];

const MOVE_COUNTS = [50, 100, 200, 500];

function buildChain(n) {
  const left = Math.floor((n - 1) / 2);
  const right = n - 1 - left;
  const tiles = [];
  for (let i = left; i >= 1; i -= 1) {
    tiles.push({ id: `L${i}`, left: (i + 1) % 7, right: i % 7 });
  }
  tiles.push({ id: "OPEN", left: 6, right: 6 });
  for (let i = 1; i <= right; i += 1) {
    const isDouble = i % 7 === 0;
    tiles.push(
      isDouble
        ? { id: `R${i}`, left: i % 7, right: i % 7 }
        : { id: `R${i}`, left: (i - 1) % 7, right: i % 7 }
    );
  }
  return { tiles, centerIndex: left };
}

function findFirstOverlap(placements, tiles, gap) {
  const attach = new Set();
  for (let i = 0; i < tiles.length - 1; i += 1) {
    attach.add(`${tiles[i].id}|${tiles[i + 1].id}`);
    attach.add(`${tiles[i + 1].id}|${tiles[i].id}`);
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const connected = attach.has(`${a.id}|${b.id}`);
      const c = edgeClearance(a, b);
      if (c < 0) {
        return {
          move: Math.max(i, j) + 1,
          a: a.id,
          b: b.id,
          reason: "aabb-overlap",
          clearance: c,
        };
      }
      if (connected) continue;

      const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
      const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
      if ((xOv || yOv) && c < gap - 0.05) {
        return {
          move: Math.max(i, j) + 1,
          a: a.id,
          b: b.id,
          reason: "axis-clearance",
          clearance: c,
        };
      }
    }
  }
  return null;
}

let audits = 0;
for (const moves of MOVE_COUNTS) {
  const { tiles, centerIndex } = buildChain(moves);
  assert.equal(tiles.length, moves);

  for (const vp of VIEWPORTS) {
    const label = `${moves} moves @ ${vp.name}`;
    const result = layoutBoard(
      tiles,
      centerIndex,
      { width: vp.width, height: vp.height },
      SIZE
    );
    const { placements, tileScale, gap } = result;

    if (placements.length !== moves) {
      assert.fail(
        `STOP ${label}: incomplete placement ${placements.length}/${moves} (scale=${tileScale})`
      );
    }

    const hit = findFirstOverlap(placements, tiles, gap ?? CHAIN_GAP);
    if (hit) {
      assert.fail(
        `STOP ${label}: overlap at move≈${hit.move} dominoes ${hit.a}↔${hit.b} reason=${hit.reason} clearance=${hit.clearance}`
      );
    }

    const bounds = computePlayBounds(vp, MARGIN);
    for (const p of placements) {
      assert.ok(
        p.x >= bounds.minX - 0.75 &&
          p.y >= bounds.minY - 0.75 &&
          p.x + p.w <= bounds.maxX + 0.75 &&
          p.y + p.h <= bounds.maxY + 0.75,
        `STOP ${label}: ${p.id} outside bounds`
      );
      assert.ok(
        p.rotation === 0 || p.rotation === 90,
        `STOP ${label}: ${p.id} missing rotation`
      );
    }

    audits += 1;
    console.log(`OK ${label} scale=${tileScale.toFixed(3)} gap=${gap}`);
  }
}

assert.equal(audits, MOVE_COUNTS.length * VIEWPORTS.length);
console.log(
  `Board layout move-stress PASSED: ${MOVE_COUNTS.join("/")} tiles × ${VIEWPORTS.length} viewports — zero overlaps.`
);
