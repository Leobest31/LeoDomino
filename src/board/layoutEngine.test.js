/**
 * Board layout tests — professional ribbon serpentine
 */
import assert from "node:assert/strict";
import {
  CHAIN_GAP,
  GAP,
  MARGIN,
  MIN_TILE_SCALE,
  BRIDGE_LEN,
  layoutBoard,
  calculateBoardLayout,
  computePlayBounds,
  orientationForTravel,
  computeLayoutMetrics,
  measureMinRowClearance,
  measureVerticalBridges,
} from "./layoutEngine.js";

const size = { w: 40, h: 76 };

function tile(id, left = 0, right = 1) {
  return { id, left, right };
}

function dbl(id) {
  return { id, left: 6, right: 6 };
}

assert.equal(CHAIN_GAP, 2);
assert.equal(GAP, 2);
assert.equal(MARGIN, 14);
assert.equal(MIN_TILE_SCALE, 0.45);
// Doubles stay vertical pivots on every travel axis
assert.equal(orientationForTravel(dbl("d"), "E"), "vertical");
assert.equal(orientationForTravel(dbl("d"), "N"), "vertical");
assert.equal(orientationForTravel(dbl("d"), "E", "N"), "vertical");
assert.equal(orientationForTravel(dbl("d"), "S", "E"), "vertical");
assert.equal(orientationForTravel(tile("t"), "E"), "horizontal");
assert.equal(orientationForTravel(tile("t"), "N"), "vertical");

{
  const m = computeLayoutMetrics({ width: 800, height: 400 }, size, MARGIN, 12);
  assert.ok(m.chainGap === 2 || m.chainGap === CHAIN_GAP);
  assert.ok(m.rowClear >= size.w * 0.55, `rowClear ${m.rowClear}`);
  assert.ok(m.maxRun >= 4, `maxRun should favor long rails, got ${m.maxRun}`);
}

{
  const tiles = [dbl("c")];
  const vp = { width: 900, height: 420 };
  const { placements, tileScale } = layoutBoard(tiles, 0, vp, size);
  assert.equal(tileScale, 1);
  assert.ok(Math.abs(placements[0].x + placements[0].w / 2 - 450) < 1);
  assert.ok(Math.abs(placements[0].y + placements[0].h / 2 - 210) < 1);
}

{
  const tiles = [dbl("c")];
  for (let i = 1; i <= 8; i += 1) tiles.push(tile(`r${i}`));
  const { placements, tileScale } = layoutBoard(
    tiles,
    0,
    { width: 900, height: 420 },
    size
  );
  assert.ok(tileScale >= MIN_TILE_SCALE && tileScale <= 1);
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const opener = byId.c;
  assert.ok(opener, "opener present");
  assert.ok(Math.abs(opener.x + opener.w / 2 - 450) < 2, "opener centered x");
  assert.ok(Math.abs(opener.y + opener.h / 2 - 210) < 2, "opener centered y");
  for (let i = 1; i < 4; i += 1) {
    const a = byId[`r${i}`];
    const b = byId[`r${i + 1}`];
    if (a && b && Math.abs(a.y - b.y) < 2) {
      const g = b.x - (a.x + a.w);
      assert.ok(
        g >= CHAIN_GAP - 0.5 && g <= CHAIN_GAP + 0.5,
        `connected gap r${i}=${g}`
      );
    }
  }
}

{
  const tiles = [dbl("c")];
  for (let i = 1; i <= 16; i += 1) tiles.push(tile(`r${i}`));
  for (let i = 1; i <= 10; i += 1) tiles.unshift(tile(`l${i}`));
  const { placements, tileScale } = layoutBoard(
    tiles,
    10,
    { width: 800, height: 400 },
    size
  );
  assert.equal(placements.length, tiles.length);
  assert.ok(tileScale >= MIN_TILE_SCALE && tileScale <= 1);
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const overlap =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.ok(!overlap, `overlap ${a.id}/${b.id}`);
    }
  }
  const rowClear = measureMinRowClearance(placements);
  if (rowClear != null) {
    assert.ok(rowClear >= 4, `parallel rows too close: ${rowClear}`);
  }
}

{
  // Narrow phone — serpentine must fold without overlap
  const tiles = [dbl("c")];
  for (let i = 1; i <= 12; i += 1) tiles.push(tile(`r${i}`));
  const { placements, tileScale } = layoutBoard(
    tiles,
    0,
    { width: 360, height: 280 },
    size
  );
  assert.equal(placements.length, tiles.length);
  assert.ok(tileScale >= MIN_TILE_SCALE && tileScale <= 1);
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const overlap =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      assert.ok(!overlap, `phone overlap ${a.id}/${b.id}`);
    }
  }
}

{
  // Connected tiles keep a constant readable face gap on a long straight run
  const tiles = [dbl("c")];
  for (let i = 1; i <= 5; i += 1) tiles.push(tile(`r${i}`));
  const { placements } = layoutBoard(tiles, 0, { width: 1100, height: 520 }, size);
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  for (let i = 1; i < 5; i += 1) {
    const a = byId[`r${i}`];
    const b = byId[`r${i + 1}`];
    if (!a || !b) continue;
    if (Math.abs(a.y - b.y) > 3) continue;
    const g = Math.abs(b.x - (a.x + a.w));
    assert.ok(
      g >= CHAIN_GAP - 0.5 && g <= CHAIN_GAP + 0.5,
      `straight gap ${g}`
    );
  }
}

{
  // Horizontal runs share an exact centerline
  const tiles = [dbl("c")];
  for (let i = 1; i <= 6; i += 1) tiles.push(tile(`r${i}`));
  const { placements } = layoutBoard(tiles, 0, { width: 1100, height: 520 }, size);
  const horiz = placements.filter((p) => p.w >= p.h && p.id !== "c");
  if (horiz.length >= 2) {
    const cy0 = horiz[0].y + horiz[0].h / 2;
    for (let i = 1; i < Math.min(4, horiz.length); i += 1) {
      const cy = horiz[i].y + horiz[i].h / 2;
      if (Math.abs(horiz[i].y - horiz[0].y) < horiz[0].h) {
        assert.ok(Math.abs(cy - cy0) < 0.75, `rail drift ${cy - cy0}`);
      }
    }
  }
}

{
  // Long chain with many turns — no overlap on phone / tablet / desktop
  const tiles = [dbl("c")];
  for (let i = 1; i <= 18; i += 1) {
    tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
  }
  for (const vp of [
    { width: 360, height: 280 },
    { width: 768, height: 420 },
    { width: 1100, height: 520 },
  ]) {
    const { placements, tileScale } = layoutBoard(tiles, 0, vp, size);
    assert.equal(placements.length, tiles.length, `${vp.width} count`);
    assert.ok(tileScale >= 0.2 && tileScale <= 1, `${vp.width} scale ${tileScale}`);
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        const overlap =
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        assert.ok(!overlap, `${vp.width} overlap ${a.id}/${b.id}`);
      }
    }
  }
}

{
  // Stable scale: more tiles must not shrink further once viewport is fixed
  const mk = (n) => {
    const tiles = [dbl("c")];
    for (let i = 1; i <= n; i += 1) tiles.push(tile(`r${i}`));
    return tiles;
  };
  const vp = { width: 768, height: 420 };
  const a = layoutBoard(mk(4), 0, vp, size);
  const b = layoutBoard(mk(10), 0, vp, size);
  assert.ok(Math.abs(a.tileScale - b.tileScale) < 0.02, "scale should stay stable mid-match");
}

{
  // Doubles keep the same face gap as non-doubles on a straight run
  const tiles = [
    dbl("c"),
    { id: "a", left: 6, right: 3 },
    dbl("d1"),
    { id: "b", left: 6, right: 2 },
    dbl("d2"),
    { id: "c2", left: 6, right: 1 },
  ];
  const { placements } = layoutBoard(tiles, 0, { width: 1100, height: 520 }, size);
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  for (let i = 1; i < tiles.length; i += 1) {
    const a = byId[tiles[i - 1].id];
    const b = byId[tiles[i].id];
    if (!a || !b) continue;
    if (Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) > Math.max(a.h, b.h) * 0.55) {
      continue;
    }
    const g = Math.abs(b.x >= a.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w));
    assert.ok(
      g >= CHAIN_GAP - 0.5 && g <= CHAIN_GAP + 0.5,
      `double-run gap ${tiles[i - 1].id}→${tiles[i].id} = ${g}`
    );
  }
}

{
  // Exact mathematical center for opening double and non-double
  for (const opener of [dbl("c"), tile("c", 3, 5)]) {
    const { placements } = layoutBoard(
      [opener],
      0,
      { width: 900, height: 420 },
      size
    );
    const p = placements[0];
    assert.ok(
      Math.abs(p.x + p.w / 2 - 450) < 0.01,
      `opener x center ${opener.id}`
    );
    assert.ok(
      Math.abs(p.y + p.h / 2 - 210) < 0.01,
      `opener y center ${opener.id}`
    );
  }
}

{
  // Invisible grid: shared horizontal rail centerlines + exact gaps
  const tiles = [dbl("c")];
  for (let i = 1; i <= 10; i += 1) tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
  const { placements } = layoutBoard(
    tiles,
    0,
    { width: 1100, height: 520 },
    size
  );
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const opener = byId.c;
  assert.ok(Math.abs(opener.x + opener.w / 2 - 550) < 0.5, "opener pinned");
  for (let i = 1; i < tiles.length; i += 1) {
    const a = byId[tiles[i - 1].id];
    const b = byId[tiles[i].id];
    const sameRow = Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 0.75;
    if (sameRow && a.w >= a.h - 0.5 && b.w >= b.h - 0.5) {
      const g =
        b.x >= a.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
      if (g < 0 || g > 12) continue;
      assert.ok(
        Math.abs(g - CHAIN_GAP) < 0.51,
        `grid gap ${tiles[i - 1].id}→${tiles[i].id} = ${g}`
      );
      assert.ok(
        Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 0.51,
        `rail drift ${tiles[i - 1].id}/${tiles[i].id}`
      );
    }
  }
}

{
  // Dual-tile vertical bridges on a long serpentine arm
  const tiles = [dbl("c")];
  for (let i = 1; i <= 16; i += 1) {
    tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
  }
  const { placements } = layoutBoard(
    tiles,
    0,
    { width: 900, height: 480 },
    size
  );
  const bridges = measureVerticalBridges(placements);
  assert.ok(bridges.length >= 1, "expected at least one vertical bridge");
  const dual = bridges.filter((n) => n >= BRIDGE_LEN).length;
  assert.ok(
    dual >= Math.ceil(bridges.length * 0.5),
    `most bridges should be dual-tile, got ${JSON.stringify(bridges)}`
  );
  for (const n of bridges) {
    assert.ok(n >= 1 && n <= 4, `bridge length odd: ${n}`);
  }
}

{
  // Tablet + desktop viewports
  for (const vp of [
    { width: 768, height: 420 },
    { width: 1100, height: 520 },
  ]) {
    const tiles = [dbl("c")];
    for (let i = 1; i <= 10; i += 1) tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
    const { tileScale, placements } = layoutBoard(tiles, 0, vp, size);
    assert.ok(tileScale >= MIN_TILE_SCALE && tileScale <= 1, `${vp.width} scale`);
    assert.equal(placements.length, tiles.length);
  }
}

{
  // Opening double: first L/R tiles attach on short faces — never through body
  const tiles = [
    tile("l2", 1, 2),
    tile("l1", 2, 3),
    dbl("c"),
    tile("r1", 6, 4),
    tile("r2", 4, 1),
  ];
  const { placements } = layoutBoard(
    tiles,
    2,
    { width: 900, height: 480 },
    size
  );
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const o = byId.c;
  const r1 = byId.r1;
  const l1 = byId.l1;
  assert.ok(o.h > o.w, "opener vertical");
  assert.ok(r1.x >= o.x + o.w + CHAIN_GAP - 0.6, "r1 must clear opener right face");
  assert.ok(l1.x + l1.w <= o.x - CHAIN_GAP + 0.6, "l1 must clear opener left face");
  assert.ok(
    Math.abs(r1.y + r1.h / 2 - (o.y + o.h / 2)) < 1.5,
    "r1 centered on opener"
  );
  assert.ok(
    Math.abs(l1.y + l1.h / 2 - (o.y + o.h / 2)) < 1.5,
    "l1 centered on opener"
  );
  for (const [a, b] of [
    [o, r1],
    [o, l1],
    [o, byId.r2],
    [o, byId.l2],
  ]) {
    const hit =
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y;
    assert.ok(!hit, `opener must not intersect ${b.id}`);
  }
}

// Phone felt + oversized HUD carve-out must never fail closed (empty board).
{
  const phone = { width: 352, height: 498 };
  const measuredHud = phone.width * 0.38 + 48; // mirrors GamePage mobile score width + gap
  const play = computePlayBounds(phone, MARGIN, measuredHud);
  assert.ok(
    play.maxX - play.minX >= 200,
    `playable width must stay usable, got ${play.maxX - play.minX} (hudRight=${play.hudRight})`
  );

  const chain = [dbl("c")];
  for (let i = 1; i <= 11; i += 1) chain.push(tile(`t${i}`, i % 6, (i + 1) % 6));

  const layout = calculateBoardLayout(chain, phone, {
    centerIndex: 0,
    tileWidth: 103,
    tileHeight: 196,
    hudRight: measuredHud,
  });
  assert.equal(
    layout.tiles.length,
    chain.length,
    `phone+HUD must place all tiles, got ${layout.tiles.length}`
  );
}

console.log("Board layout engine tests passed.");
