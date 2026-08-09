/**
 * Long-match layout stress — 50+ tiles, many turns, tight viewports.
 * Layout only: no game-rule / AI changes.
 */
import assert from "node:assert/strict";
import {
  CHAIN_GAP,
  BRIDGE_LEN,
  MARGIN,
  layoutBoard,
  measureMinRowClearance,
  countTurns,
  measureVerticalBridges,
  computeStableFitScale,
  computePlayBounds,
} from "./layoutEngine.js";

const SIZE = { w: 40, h: 76 };

const VIEWPORTS = [
  { width: 360, height: 280 },
  { width: 768, height: 420 },
  { width: 1100, height: 520 },
];

function tile(id, left = 0, right = 1) {
  return { id, left, right };
}

function dbl(id) {
  return { id, left: 6, right: 6 };
}

function mkChain(rightCount, leftCount = 0) {
  const tiles = [dbl("c")];
  for (let i = 1; i <= rightCount; i += 1) {
    tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
  }
  for (let i = 1; i <= leftCount; i += 1) {
    tiles.unshift(tile(`l${i}`, (i + 2) % 7, (i + 3) % 7));
  }
  return { tiles, centerIndex: leftCount };
}

function assertNoOverlap(placements, label) {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const overlap =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.ok(!overlap, `${label} overlap ${a.id}/${b.id}`);
    }
  }
}

function assertConstantGaps(placements, tiles, centerIndex, label) {
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const arms = [
    tiles.slice(centerIndex).map((t) => t.id),
    tiles
      .slice(0, centerIndex + 1)
      .map((t) => t.id)
      .reverse(),
  ];

  let expected = CHAIN_GAP;
  outer: for (const arm of arms) {
    for (let i = 1; i < arm.length; i += 1) {
      const a = byId[arm[i - 1]];
      const b = byId[arm[i]];
      if (!a || !b) continue;
      const sameRow = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 1.5;
      if (sameRow && a.w >= a.h && b.w >= b.h) {
        expected = Math.abs(
          b.x >= a.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
        );
        break outer;
      }
    }
  }

  for (const arm of arms) {
    for (let i = 1; i < arm.length; i += 1) {
      const a = byId[arm[i - 1]];
      const b = byId[arm[i]];
      if (!a || !b) continue;

      const sameRow = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 1.5;
      const sameCol = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 1.5;

      if (sameRow && a.w >= a.h && b.w >= b.h) {
        const g = Math.abs(
          b.x >= a.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w)
        );
        assert.ok(
          Math.abs(g - expected) <= 0.75,
          `${label} horizontal gap ${arm[i - 1]}→${arm[i]} = ${g}`
        );
      } else if (sameCol && a.h >= a.w && b.h >= b.w) {
        const g = Math.abs(
          b.y >= a.y ? b.y - (a.y + a.h) : a.y - (b.y + b.h)
        );
        assert.ok(
          Math.abs(g - expected) <= 0.75,
          `${label} vertical gap ${arm[i - 1]}→${arm[i]} = ${g}`
        );
      }
    }
  }
}

/**
 * Every tile AABB must stay inside the playable green felt (margin + HUD).
 */
function assertInsideFelt(placements, viewport, label, camera = null, hudRight = null) {
  assert.ok(!camera?.overflow, `${label} must not report felt overflow`);
  const play = computePlayBounds(viewport, MARGIN, hudRight);
  const pad = 0.75;
  for (const p of placements) {
    assert.ok(p.x >= play.minX - pad, `${label} ${p.id} left`);
    assert.ok(p.y >= play.minY - pad, `${label} ${p.id} top`);
    assert.ok(p.x + p.w <= play.maxX + pad, `${label} ${p.id} right`);
    assert.ok(p.y + p.h <= play.maxY + pad, `${label} ${p.id} bottom`);
  }
}

{
  // 50+ dominoes, bilateral arms, multiple turns
  const { tiles, centerIndex } = mkChain(32, 20);
  assert.equal(tiles.length, 53);

  for (const vp of VIEWPORTS) {
    const label = `50+ ${vp.width}x${vp.height}`;
    const t0 = Date.now();
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      SIZE
    );
    const ms = Date.now() - t0;
    assert.equal(placements.length, tiles.length, `${label} count`);
    assert.ok(tileScale >= 0.08 && tileScale <= 1, `${label} scale ${tileScale}`);
    // Soft hang guard — not a frame budget. Wall-clock varies heavily under
    // Windows load / cold V8; keep this well above a healthy run (~50–150ms)
    // so CI does not flake, while still failing on pathological multi-second hangs.
    assert.ok(ms < 4000, `${label} too slow: ${ms}ms`);
    assertNoOverlap(placements, label);
    assertInsideFelt(placements, vp, label, camera);
    assertConstantGaps(placements, tiles, centerIndex, label);

    const turns = countTurns(placements);
    assert.ok(turns >= 4, `${label} expected multiple turns, got ${turns}`);

    const bridges = measureVerticalBridges(placements);
    if (bridges.length >= 2) {
      const dual = bridges.filter((n) => n >= BRIDGE_LEN).length;
      assert.ok(
        dual >= 1,
        `${label} expected dual-tile bridges, got ${JSON.stringify(bridges)}`
      );
    }

    const rowClear = measureMinRowClearance(placements);
    if (rowClear != null) {
      assert.ok(rowClear >= 4, `${label} rows cramped: ${rowClear}`);
    }
  }
}

{
  // Near-empty reserve / long blocked spiral — dense single arm
  const { tiles, centerIndex } = mkChain(55, 0);
  assert.equal(tiles.length, 56);

  for (const vp of VIEWPORTS) {
    const label = `dense ${vp.width}`;
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      SIZE
    );
    assert.equal(placements.length, 56);
    assert.ok(tileScale >= 0.08 && tileScale <= 1);
    assertNoOverlap(placements, label);
    assertInsideFelt(placements, vp, label, camera);
    assertConstantGaps(placements, tiles, centerIndex, label);
    assert.ok(
      countTurns(placements) >= 6,
      `${label} needs many folds, got ${countTurns(placements)}`
    );
  }
}

{
  // Opening tile stays centered on playable felt mid when camera pins opener.
  const short = mkChain(4, 4);
  const vp = { width: 1100, height: 520 };
  const play = computePlayBounds(vp, MARGIN);
  const midX = (play.minX + play.maxX) / 2;
  const midY = (play.minY + play.maxY) / 2;
  const shortLayout = layoutBoard(short.tiles, short.centerIndex, vp, SIZE);
  const opener = shortLayout.placements.find((p) => p.id === "c");
  assert.ok(opener, "opener");
  assert.ok(!shortLayout.camera?.overflow, "short chain on-felt");
  if (!shortLayout.camera?.recentered) {
    assert.ok(
      Math.abs(opener.x + opener.w / 2 - midX) < 3,
      "opener x centered on short chain"
    );
    assert.ok(
      Math.abs(opener.y + opener.h / 2 - midY) < 3,
      "opener y centered on short chain"
    );
  }

  const long = mkChain(24, 24);
  const longLayout = layoutBoard(long.tiles, long.centerIndex, vp, SIZE);
  assert.equal(longLayout.placements.length, long.tiles.length);
  assertNoOverlap(longLayout.placements, "long-bilateral");
  assertInsideFelt(longLayout.placements, vp, "long-bilateral", longLayout.camera);
  if (!longLayout.camera?.recentered) {
    const o = longLayout.placements.find((p) => p.id === "c");
    assert.ok(
      Math.abs(o.x + o.w / 2 - midX) < 3,
      "opener x centered when pinned"
    );
  }
}

{
  // Stable planned scale across growth within a real double-six match (≤28)
  const vp = { width: 768, height: 420 };
  const plannedA = computeStableFitScale(vp, SIZE, 18, 12);
  const plannedB = computeStableFitScale(vp, SIZE, 18, 24);
  assert.ok(
    Math.abs(plannedA - plannedB) < 0.02,
    `planned scale drift ${plannedA} vs ${plannedB}`
  );
  const a = layoutBoard(mkChain(12).tiles, 0, vp, SIZE);
  const b = layoutBoard(mkChain(24).tiles, 0, vp, SIZE);
  assert.ok(a.tileScale >= 0.08 && b.tileScale >= 0.08);
  assertNoOverlap(a.placements, "stable-a");
  assertNoOverlap(b.placements, "stable-b");
}

{
  // Precision across common desktop resolutions — no overlap; on-felt;
  // opener pinned to playable felt mid when focusMode is opener.
  const { tiles, centerIndex } = mkChain(18, 12);
  for (const vp of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const label = `desktop ${vp.width}`;
    const { placements, camera } = layoutBoard(tiles, centerIndex, vp, SIZE);
    assert.equal(placements.length, tiles.length);
    assertNoOverlap(placements, label);
    assertInsideFelt(placements, vp, label, camera);
    const opener = placements.find((p) => p.id === "c");
    assert.ok(opener, label);
    const play = computePlayBounds(vp, MARGIN);
    const midX = (play.minX + play.maxX) / 2;
    const midY = (play.minY + play.maxY) / 2;
    if (camera?.focusMode === "opener") {
      assert.ok(
        Math.abs(opener.x + opener.w / 2 - midX) < 1,
        `${label} opener x`
      );
      assert.ok(
        Math.abs(opener.y + opener.h / 2 - midY) < 1,
        `${label} opener y`
      );
    }
    assertConstantGaps(placements, tiles, centerIndex, label);
  }
}

console.log("Board layout long-match stress tests passed.");
