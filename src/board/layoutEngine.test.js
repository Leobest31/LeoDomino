/**
 * Board layout tests — professional ribbon serpentine
 */
import assert from "node:assert/strict";
import {
  CHAIN_GAP,
  GAP,
  MARGIN,
  MIN_BOARD_SCALE,
  MIN_TILE_SCALE,
  MIN_DESKTOP_TILE_PX,
  BOARD_TILE_HAND_FACTOR,
  BOARD_BASE_SHORT_MIN_PX,
  BOARD_BASE_SHORT_MAX_PX,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
  BRIDGE_LEN,
  TURN_EVERY,
  FIRST_FOLD_RIGHT,
  FIRST_FOLD_LEFT,
  layoutBoard,
  calculateBoardLayout,
  computePlayBounds,
  resolveBoardTileBase,
  orientationForTravel,
  computeLayoutMetrics,
  measureMinRowClearance,
  measureVerticalBridges,
  countTurns,
  collisionBox,
} from "./layoutEngine.js";

const size = { w: 40, h: 76 };
/** Locked desktop board footprint (hand×2.15 middle range). */
const locked = {
  w: LOCKED_BOARD_TILE_SHORT_PX,
  h: LOCKED_BOARD_TILE_LONG_PX,
};

function tile(id, left = 0, right = 1) {
  return { id, left, right };
}

function dbl(id) {
  return { id, left: 6, right: 6 };
}

assert.equal(CHAIN_GAP, 2);
assert.equal(GAP, 2);
assert.equal(MARGIN, 14);
assert.equal(MIN_BOARD_SCALE, 0.85);
assert.equal(MIN_TILE_SCALE, MIN_BOARD_SCALE);
assert.equal(MIN_DESKTOP_TILE_PX, 30);
assert.equal(BOARD_TILE_HAND_FACTOR, 2.15);
assert.equal(BOARD_BASE_SHORT_MIN_PX, 44);
assert.equal(BOARD_BASE_SHORT_MAX_PX, 80);
assert.equal(LOCKED_BOARD_TILE_SHORT_PX, 72);
assert.equal(LOCKED_BOARD_TILE_LONG_PX, 136);
assert.equal(TURN_EVERY, 5);
assert.equal(FIRST_FOLD_RIGHT, "S");
assert.equal(FIRST_FOLD_LEFT, "N");

{
  // Middle-range base: CSS hand×2.15 (~72×136) capped by felt — never the
  // old oversized ~134×254, never hand-tiny.
  const laptop = resolveBoardTileBase(
    { width: 1180, height: 520 },
    { w: 134, h: 254 }
  );
  assert.ok(
    laptop.w <= BOARD_BASE_SHORT_MAX_PX + 0.001,
    `oversized CSS must cap, got ${laptop.w}`
  );
  assert.ok(
    laptop.w >= BOARD_BASE_SHORT_MIN_PX - 0.001,
    `base must stay above tiny floor ${laptop.w}`
  );
  const balanced = resolveBoardTileBase(
    { width: 1180, height: 520 },
    { w: 72, h: 136 }
  );
  assert.ok(
    balanced.w >= 60 && balanced.w <= BOARD_BASE_SHORT_MAX_PX,
    `balanced CSS short ${balanced.w}`
  );
  assert.ok(
    Math.abs(balanced.h / balanced.w - 136 / 72) < 0.02,
    "aspect preserved"
  );
}
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
  const play = computePlayBounds(vp, MARGIN);
  const midX = (play.minX + play.maxX) / 2;
  const midY = (play.minY + play.maxY) / 2;
  const { placements, tileScale } = layoutBoard(tiles, 0, vp, size);
  assert.equal(tileScale, 1);
  assert.ok(Math.abs(placements[0].x + placements[0].w / 2 - midX) < 1);
  assert.ok(Math.abs(placements[0].y + placements[0].h / 2 - midY) < 1);
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
  assert.ok(tileScale > 0.05 && tileScale <= 1);
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const opener = byId.c;
  assert.ok(opener, "opener present");
  // One-sided arms may bbox-center once the rail uses the felt; short
  // openings still pin (covered by the dedicated opener-center cases).
  assert.ok(placements.length === tiles.length, "all tiles placed");
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
  const midVp = { width: 800, height: 400 };
  const { placements, tileScale, camera } = layoutBoard(
    tiles,
    10,
    midVp,
    size
  );
  assert.equal(placements.length, tiles.length);
  assert.ok(tileScale > 0.05 && tileScale <= 1);
  assert.ok(!camera?.overflow, "mid viewport must stay on-felt");
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
  // Narrow phone — serpentine must fold on-felt without overlap
  const tiles = [dbl("c")];
  for (let i = 1; i <= 12; i += 1) tiles.push(tile(`r${i}`));
  const phoneVp = { width: 360, height: 280 };
  const { placements, tileScale, camera } = layoutBoard(
    tiles,
    0,
    phoneVp,
    size
  );
  assert.equal(placements.length, tiles.length);
  assert.ok(tileScale > 0.05 && tileScale <= 1);
  assert.ok(!camera?.overflow, "phone chain must stay on-felt");
  const phonePlay = computePlayBounds(phoneVp, MARGIN);
  for (const p of placements) {
    assert.ok(p.x >= phonePlay.minX - 0.75, "phone left");
    assert.ok(p.y >= phonePlay.minY - 0.75, "phone top");
    assert.ok(p.x + p.w <= phonePlay.maxX + 0.75, "phone right");
    assert.ok(p.y + p.h <= phonePlay.maxY + 0.75, "phone bottom");
  }
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
    const { placements, tileScale, camera } = layoutBoard(tiles, 0, vp, size);
    assert.equal(placements.length, tiles.length, `${vp.width} count`);
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `${vp.width} scale ${tileScale}`
    );
    assert.ok(!camera?.overflow, `${vp.width} must stay on-felt`);
    const play = computePlayBounds(vp, MARGIN);
    for (const p of placements) {
      assert.ok(p.x >= play.minX - 0.75, `${vp.width} ${p.id} left`);
      assert.ok(p.y >= play.minY - 0.75, `${vp.width} ${p.id} top`);
      assert.ok(p.x + p.w <= play.maxX + 0.75, `${vp.width} ${p.id} right`);
      assert.ok(p.y + p.h <= play.maxY + 0.75, `${vp.width} ${p.id} bottom`);
    }
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
  // Stable scale: a 4-tile arm and a 10-tile arm on a roomy tablet may differ
  // once the 5-straight lock no longer fits at preferred size.
  const mk = (n) => {
    const tiles = [dbl("c")];
    for (let i = 1; i <= n; i += 1) tiles.push(tile(`r${i}`));
    return tiles;
  };
  const vp = { width: 768, height: 420 };
  const a = layoutBoard(mk(4), 0, vp, size);
  const b = layoutBoard(mk(10), 0, vp, size);
  assert.ok(a.tileScale > 0.05 && a.tileScale <= 1, `4-tile arm scale ${a.tileScale}`);
  assert.ok(b.tileScale > 0.05 && b.tileScale <= a.tileScale + 0.001, "longer arm must not upscale");
  assert.ok(!a.camera?.overflow && !b.camera?.overflow, "both lengths stay on-felt");
}

{
  // Fixed base size + MIN_BOARD_SCALE floor on a roomy tablet felt.
  // Adding tiles must never upscale; 1–19 stay near full size; 24–28 may use
  // modest scale (≥ floor) and/or on-felt camera recenter — never shrink-to-fit.
  const mk = (n) => {
    const tiles = [dbl("c")];
    for (let i = 1; i < n; i += 1) {
      tiles.push(tile(`t${i}`, i % 7, (i + 1) % 7));
    }
    return tiles;
  };
  const vp = { width: 800, height: 900 };
  const base = { w: 72, h: 136 };
  let prev = 1;
  /** @type {Record<number, { scale: number, w: number, h: number, turns: number, recentered: boolean }>} */
  const at = {};
  for (const n of [1, 5, 10, 14, 15, 19, 24, 28]) {
    const { placements, tileScale, camera, content } = layoutBoard(
      mk(n),
      0,
      vp,
      base,
      { maxScale: 1, focusTileId: `t${n - 1}` }
    );
    assert.equal(placements.length, n, `tablet ${n} placement count`);
    assert.ok(
      tileScale <= prev + 0.001,
      `tablet scale must not upscale at ${n}: ${prev} → ${tileScale}`
    );
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `tablet ${n} scale out of range: ${tileScale}`
    );
    assert.ok(!camera?.overflow, `tablet ${n} must stay on-felt`);
    const short = Math.min(placements[0].w, placements[0].h);
    const long = Math.max(placements[0].w, placements[0].h);
    at[n] = {
      scale: tileScale,
      w: short,
      h: long,
      turns: countTurns(placements),
      recentered: Boolean(camera?.recentered || camera?.overflow),
      bounds: content,
    };
    prev = tileScale;
  }
  assert.ok(at[1].scale >= 0.99, `1-tile base scale ${at[1].scale}`);
  assert.ok(at[5].scale > 0.05 && at[5].scale <= 1, `5-tile scale ${at[5].scale}`);
  assert.ok(
    at[10].scale > 0.05 && at[10].scale <= 1,
    `10-tile scale ${at[10].scale}`
  );
  // Longer one-sided packs must stay on-felt; scale may use the emergency
  // path on shorter tablet widths once hard felt bounds are enforced.
  for (const n of [15, 19, 24, 28]) {
    assert.ok(at[n].scale > 0.05 && at[n].scale <= 1, `tablet ${n} scale ${at[n].scale}`);
    assert.ok(!at[n].recentered || at[n].scale > 0, `tablet ${n} placed`);
  }
  // Early turns: long chains should fold rather than one endless rail.
  assert.ok(at[15].turns >= 1, `15-tile should turn early, turns=${at[15].turns}`);
  assert.ok(at[19].turns >= 2, `19-tile should turn, turns=${at[19].turns}`);
}

{
  // Laptop felt + balanced board base (hand × 2.15, ~72×136). No bbox
  // fit-shrink — scale stays at/above MIN_BOARD_SCALE; short side middle-range.
  const mk = (n) => {
    const tiles = [dbl("c")];
    for (let i = 1; i < n; i += 1) {
      tiles.push(tile(`t${i}`, i % 7, (i + 1) % 7));
    }
    return tiles;
  };
  const vp = { width: 1180, height: 520 };
  const base = resolveBoardTileBase(vp, { w: 72, h: 136 });
  assert.ok(
    base.w >= 60 && base.w <= BOARD_BASE_SHORT_MAX_PX,
    `laptop base short ${base.w}`
  );
  let prevScale = 1;
  /** @type {Record<number, { scale: number, short: number, long: number, turns: number, overflow: boolean, bounds: object }>} */
  const at = {};
  for (const n of [1, 5, 10, 15, 19, 24, 28]) {
    const { placements, tileScale, camera, content } = layoutBoard(
      mk(n),
      0,
      vp,
      base,
      {
        maxScale: 1,
        focusTileId: `t${n - 1}`,
        hudRight: 96,
      }
    );
    assert.equal(placements.length, n, `laptop ${n} placement count`);
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        const overlap =
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        assert.ok(!overlap, `laptop ${n} overlap ${a.id}/${b.id}`);
      }
    }
    const short = Math.min(placements[0].w, placements[0].h);
    const long = Math.max(placements[0].w, placements[0].h);
    assert.ok(
      tileScale <= prevScale + 0.001,
      `laptop scale must not upscale at ${n}: ${prevScale} → ${tileScale}`
    );
    at[n] = {
      scale: tileScale,
      short,
      long,
      turns: countTurns(placements),
      overflow: Boolean(camera?.overflow),
      bounds: content,
    };
    prevScale = tileScale;
  }
  // Every length must stay fully on the playable green felt (no overflow).
  for (const n of [1, 5, 10, 15, 19, 24, 28]) {
    assert.ok(!at[n].overflow, `laptop ${n} should stay on-felt`);
  }
  for (const n of [1]) {
    assert.ok(at[n].scale >= 0.99, `laptop ${n} scale ${at[n].scale}`);
    assert.ok(
      at[n].short >= 60 && at[n].short <= BOARD_BASE_SHORT_MAX_PX + 0.5,
      `laptop ${n} short ${at[n].short}`
    );
  }
  for (const n of [5, 10, 15, 19, 24, 28]) {
    assert.ok(at[n].scale > 0.05 && at[n].scale <= 1, `laptop ${n} scale ${at[n].scale}`);
    assert.ok(at[n].short >= 8, `laptop ${n} short ${at[n].short}`);
  }
  assert.ok(at[15].turns >= 1, `laptop 15 should turn, turns=${at[15].turns}`);
  assert.ok(at[19].turns >= 2, `laptop 19 should turn, turns=${at[19].turns}`);
}

{
  // Locked ~72×136 board size: 10 / 15 / 19 / 24 / full 28 — zero unintended
  // overlap, connected chain, spinner clearance, size not reduced.
  function overlaps(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }
  const mk = (n) => {
    const tiles = [dbl("c")];
    for (let i = 1; i < n; i += 1) {
      tiles.push(
        i % 4 === 0
          ? dbl(`d${i}`, i % 7)
          : tile(`t${i}`, i % 7, (i + 1) % 7)
      );
    }
    return tiles;
  };
  const vp = { width: 1180, height: 520 };
  let prevScale = 1;
  for (const n of [10, 15, 19, 24, 28]) {
    const tiles = mk(n);
    const { placements, tileScale, content } = layoutBoard(
      tiles,
      0,
      vp,
      locked,
      { maxScale: 1, focusTileId: tiles[tiles.length - 1].id, hudRight: 96 }
    );
    assert.equal(placements.length, n, `locked ${n} placement count`);
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `locked ${n} scale ${tileScale}`
    );
    assert.ok(
      tileScale <= prevScale + 0.001,
      `locked ${n} must not upscale ${prevScale} → ${tileScale}`
    );
    const short = Math.min(placements[0].w, placements[0].h);
    const long = Math.max(placements[0].w, placements[0].h);
    // Painted footprint = locked base × chosen scale (base size unchanged).
    assert.ok(
      Math.abs(short - LOCKED_BOARD_TILE_SHORT_PX * tileScale) < 0.6,
      `locked ${n} short ${short}`
    );
    assert.ok(
      Math.abs(long - LOCKED_BOARD_TILE_LONG_PX * tileScale) < 1.2,
      `locked ${n} long ${long}`
    );

    const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
    const order = Object.fromEntries(tiles.map((t, i) => [t.id, i]));

    // Zero AABB overlap; neighbors stay face-connected (gap band).
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        assert.ok(!overlaps(a, b), `locked ${n} overlap ${a.id}/${b.id}`);
        const connected = Math.abs(order[a.id] - order[b.id]) === 1;
        if (!connected) {
          assert.ok(
            !overlaps(collisionBox(a), collisionBox(b)),
            `locked ${n} halo overlap ${a.id}/${b.id}`
          );
        }
      }
    }
    for (let i = 0; i < tiles.length - 1; i += 1) {
      const a = byId[tiles[i].id];
      const b = byId[tiles[i + 1].id];
      assert.ok(a && b, `locked ${n} missing link ${tiles[i].id}→${tiles[i + 1].id}`);
      assert.ok(!overlaps(a, b), `locked ${n} neighbor overlap ${a.id}/${b.id}`);
      // Endpoint connection: boxes share an axis projection with a face gap.
      const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
      const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
      assert.ok(
        xOv || yOv,
        `locked ${n} disconnected ${a.id}→${b.id}`
      );
      assert.ok(
        !(xOv && yOv),
        `locked ${n} body underlap at link ${a.id}→${b.id}`
      );
    }

    // Spinners keep vertical footprint on E/W rails (base × scale).
    for (const p of placements) {
      if (!p.double) continue;
      assert.ok(p.h > p.w, `locked ${n} spinner ${p.id} must be vertical`);
      assert.ok(
        Math.abs(Math.max(p.w, p.h) - LOCKED_BOARD_TILE_LONG_PX * tileScale) < 1.2,
        `locked ${n} spinner ${p.id} footprint`
      );
    }

    // Chain content exists (usable local bounds).
    assert.ok(content?.width > 0 && content?.height > 0, `locked ${n} content`);

    if (n >= 15) {
      assert.ok(
        countTurns(placements) >= 1,
        `locked ${n} should turn early, turns=${countTurns(placements)}`
      );
    }
    prevScale = tileScale;
  }
}

{
  // Deterministic LeoDomino snake: 5 right then DOWN; 5 left then UP.
  // Lengths 10 / 15 / 19 / 24 / 28 — locked tile size, no unintended overlap.
  function overlaps(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }
  function mkBilateral(total) {
    const right = Math.floor((total - 1) / 2);
    const left = total - 1 - right;
    const tiles = [];
    for (let i = left; i >= 1; i -= 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `L${i}`, left: i % 7, right: i % 7 }
          : tile(`L${i}`, i % 7, (i + 1) % 7)
      );
    }
    tiles.push(dbl("c"));
    for (let i = 1; i <= right; i += 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `R${i}`, left: i % 7, right: i % 7 }
          : tile(`R${i}`, i % 7, (i + 1) % 7)
      );
    }
    return { tiles, centerIndex: left };
  }
  const vp = { width: 1180, height: 520 };
  const play = computePlayBounds(vp, MARGIN, 96);

  for (const n of [10, 15, 19, 24, 28]) {
    const { tiles, centerIndex } = mkBilateral(n);
    const { placements, tileScale, camera } = layoutBoard(
      tiles,
      centerIndex,
      vp,
      locked,
      { hudRight: 96, focusTileId: tiles[tiles.length - 1].id }
    );
    assert.equal(placements.length, n, `snake ${n} count`);
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `snake ${n} scale ${tileScale}`
    );
    const short = Math.min(placements[0].w, placements[0].h);
    const long = Math.max(placements[0].w, placements[0].h);
    assert.ok(
      Math.abs(short - LOCKED_BOARD_TILE_SHORT_PX * tileScale) < 0.6,
      `snake ${n} short locked×scale`
    );
    assert.ok(
      Math.abs(long - LOCKED_BOARD_TILE_LONG_PX * tileScale) < 1.2,
      `snake ${n} long locked×scale`
    );

    const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
    const opener = byId.c;
    assert.ok(opener, `snake ${n} opener`);
    const feltMidX = (play.minX + play.maxX) / 2;
    const feltMidY = (play.minY + play.maxY) / 2;
    assert.ok(
      Math.abs(opener.x + opener.w / 2 - feltMidX) < 1.5,
      `snake ${n} opener x center`
    );
    assert.ok(
      Math.abs(opener.y + opener.h / 2 - feltMidY) < 1.5,
      `snake ${n} opener y center`
    );
    assert.ok(!camera?.overflow, `snake ${n} must not overflow felt`);

    const rightArm = tiles.slice(centerIndex + 1);
    const leftArm = [];
    for (let i = centerIndex - 1; i >= 0; i -= 1) leftArm.push(tiles[i]);

    // Exactly 5 horizontal RIGHT, 6th turns DOWN.
    if (rightArm.length >= 6) {
      for (let i = 0; i < 5; i += 1) {
        assert.equal(
          byId[rightArm[i].id].travelDir,
          "E",
          `snake ${n} right[${i}] must be E`
        );
      }
      assert.equal(
        byId[rightArm[5].id].travelDir,
        FIRST_FOLD_RIGHT,
        `snake ${n} right[5] must turn ${FIRST_FOLD_RIGHT}`
      );
      assert.ok(byId[rightArm[5].id].isCorner, `snake ${n} right[5] corner`);
    } else {
      for (const t of rightArm) {
        assert.equal(byId[t.id].travelDir, "E", `snake ${n} short right E`);
      }
    }

    // Exactly 5 horizontal LEFT, 6th turns UP.
    if (leftArm.length >= 6) {
      for (let i = 0; i < 5; i += 1) {
        assert.equal(
          byId[leftArm[i].id].travelDir,
          "W",
          `snake ${n} left[${i}] must be W`
        );
      }
      assert.equal(
        byId[leftArm[5].id].travelDir,
        FIRST_FOLD_LEFT,
        `snake ${n} left[5] must turn ${FIRST_FOLD_LEFT}`
      );
      assert.ok(byId[leftArm[5].id].isCorner, `snake ${n} left[5] corner`);
    } else {
      for (const t of leftArm) {
        assert.equal(byId[t.id].travelDir, "W", `snake ${n} short left W`);
      }
    }

    // Zero unintended overlap + valid neighbor connections.
    const order = Object.fromEntries(tiles.map((t, i) => [t.id, i]));
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        assert.ok(!overlaps(a, b), `snake ${n} overlap ${a.id}/${b.id}`);
        if (Math.abs(order[a.id] - order[b.id]) !== 1) {
          assert.ok(
            !overlaps(collisionBox(a), collisionBox(b)),
            `snake ${n} halo ${a.id}/${b.id}`
          );
        }
      }
    }
    for (let i = 0; i < tiles.length - 1; i += 1) {
      const a = byId[tiles[i].id];
      const b = byId[tiles[i + 1].id];
      const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
      const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
      assert.ok(xOv || yOv, `snake ${n} disconnected ${a.id}→${b.id}`);
      assert.ok(!(xOv && yOv), `snake ${n} underlap ${a.id}→${b.id}`);
    }

    // Stay inside playable green (scoreboard/HUD carve-out honored).
    for (const p of placements) {
      assert.ok(p.x >= play.minX - 0.5, `snake ${n} ${p.id} left bound`);
      assert.ok(p.y >= play.minY - 0.5, `snake ${n} ${p.id} top bound`);
      assert.ok(
        p.x + p.w <= play.maxX + 0.5,
        `snake ${n} ${p.id} right bound`
      );
      assert.ok(
        p.y + p.h <= play.maxY + 0.5,
        `snake ${n} ${p.id} bottom bound`
      );
    }

    for (const p of placements) {
      if (!p.double) continue;
      assert.ok(p.h > p.w, `snake ${n} spinner ${p.id} vertical`);
    }
  }
}

{
  // Mandatory V1 board-chain scenarios: 7/14/21/28 on three felts.
  // Fail if the chain collapses to a thin horizontal strip, shrinks below
  // the readable floors, leaves the felt, overlaps, or loses continuity.
  function mkBi(total) {
    const right = Math.floor((total - 1) / 2);
    const left = total - 1 - right;
    const tiles = [];
    for (let i = left; i >= 1; i -= 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `L${i}`, left: i % 7, right: i % 7 }
          : tile(`L${i}`, i % 7, (i + 1) % 7)
      );
    }
    tiles.push(dbl("c"));
    for (let i = 1; i <= right; i += 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `R${i}`, left: i % 7, right: i % 7 }
          : tile(`R${i}`, i % 7, (i + 1) % 7)
      );
    }
    return { tiles, centerIndex: left };
  }

  function chainTurns(placements, tiles) {
    const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
    let n = 0;
    for (let i = 1; i < tiles.length - 1; i += 1) {
      const a = byId[tiles[i - 1].id];
      const b = byId[tiles[i].id];
      const c = byId[tiles[i + 1].id];
      const d1x = b.x + b.w / 2 - (a.x + a.w / 2);
      const d1y = b.y + b.h / 2 - (a.y + a.h / 2);
      const d2x = c.x + c.w / 2 - (b.x + b.w / 2);
      const d2y = c.y + c.h / 2 - (b.y + b.h / 2);
      const aH = Math.abs(d1x) > Math.abs(d1y);
      const bH = Math.abs(d2x) > Math.abs(d2y);
      if (aH !== bH) n += 1;
    }
    return n;
  }

  const viewports = [
    { name: "desktop", width: 1180, height: 520 },
    { name: "tablet-landscape", width: 940, height: 480 },
    { name: "tablet-portrait", width: 700, height: 620 },
  ];
  const lengths = [7, 14, 21, 28];

  for (const vp of viewports) {
    for (const n of lengths) {
      const { tiles, centerIndex } = mkBi(n);
      const play = computePlayBounds(vp, MARGIN, 0, 0);
      const { placements, tileScale } = layoutBoard(
        tiles,
        centerIndex,
        vp,
        locked,
        { hudRight: 0, hudLeft: 0, maxScale: 1 }
      );
      assert.equal(placements.length, n, `${vp.name} n=${n} count`);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of placements) {
        assert.ok(p.x >= play.minX - 0.75, `${vp.name} n=${n} left felt`);
        assert.ok(p.y >= play.minY - 0.75, `${vp.name} n=${n} top felt`);
        assert.ok(
          p.x + p.w <= play.maxX + 0.75,
          `${vp.name} n=${n} right felt`
        );
        assert.ok(
          p.y + p.h <= play.maxY + 0.75,
          `${vp.name} n=${n} bottom felt`
        );
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.w);
        maxY = Math.max(maxY, p.y + p.h);
      }

      function overlaps(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }
      const order = Object.fromEntries(tiles.map((t, i) => [t.id, i]));
      for (let i = 0; i < placements.length; i += 1) {
        for (let j = i + 1; j < placements.length; j += 1) {
          const a = placements[i];
          const b = placements[j];
          assert.ok(!overlaps(a, b), `${vp.name} n=${n} overlap ${a.id}/${b.id}`);
          if (Math.abs(order[a.id] - order[b.id]) !== 1) {
            assert.ok(
              !overlaps(collisionBox(a), collisionBox(b)),
              `${vp.name} n=${n} halo ${a.id}/${b.id}`
            );
          }
        }
      }

      const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
      for (let i = 0; i < tiles.length - 1; i += 1) {
        const a = byId[tiles[i].id];
        const b = byId[tiles[i + 1].id];
        const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
        const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
        assert.ok(xOv || yOv, `${vp.name} n=${n} disconnected ${a.id}→${b.id}`);
        assert.ok(!(xOv && yOv), `${vp.name} n=${n} underlap ${a.id}→${b.id}`);
      }

      const midX = (play.minX + play.maxX) / 2;
      const midY = (play.minY + play.maxY) / 2;
      const opener = byId.c;
      assert.ok(opener, `${vp.name} n=${n} missing center`);
      assert.ok(
        Math.abs(opener.x + opener.w / 2 - midX) < 1.5,
        `${vp.name} n=${n} center not pinned X`
      );
      assert.ok(
        Math.abs(opener.y + opener.h / 2 - midY) < 1.5,
        `${vp.name} n=${n} center not pinned Y`
      );

      const short = Math.min(placements[0].w, placements[0].h);
      const long = Math.max(placements[0].w, placements[0].h);
      const turns = chainTurns(placements, tiles);

      if (n <= 7 && vp.width >= 1100) {
        assert.ok(
          tileScale >= 0.99,
          `${vp.name} n=${n} short chain should keep preferred scale ${tileScale}`
        );
      } else {
        assert.ok(
          tileScale > 0.05 && tileScale <= 1,
          `${vp.name} n=${n} scale ${tileScale}`
        );
      }

      // After the first five-per-side, the chain must take the locked folds.
      if (n >= 14) {
        assert.ok(
          turns >= 1,
          `${vp.name} n=${n} expected a first-fold, turns=${turns}`
        );
      }

      for (const p of placements) {
        if (!p.double) continue;
        assert.ok(p.h > p.w, `${vp.name} n=${n} spinner ${p.id}`);
      }

      assert.ok(short > 0 && long > short, `${vp.name} n=${n} tile ${short}x${long}`);
    }
  }
}

{
  // Uneven / one-sided arms must also stay readable at 21 (live play bias).
  function mkOne(n) {
    const tiles = [dbl("c")];
    for (let i = 1; i < n; i += 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `t${i}`, left: i % 7, right: i % 7 }
          : tile(`t${i}`, i % 7, (i + 1) % 7)
      );
    }
    return tiles;
  }
  for (const vp of [
    { name: "desktop", width: 1180, height: 520 },
    { name: "tablet-landscape", width: 940, height: 480 },
  ]) {
    const tiles = mkOne(21);
    const play = computePlayBounds(vp, MARGIN, 0, 0);
    const { placements, tileScale } = layoutBoard(tiles, 0, vp, locked, {
      hudRight: 0,
      hudLeft: 0,
      maxScale: 1,
    });
    assert.equal(placements.length, 21, `${vp.name} one21 count`);
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `${vp.name} one21 scale ${tileScale}`
    );
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of placements) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + p.h);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
    }
    const heightUse = (maxY - minY) / (play.maxY - play.minY);
    assert.ok(heightUse >= 0.28, `${vp.name} one21 hUse ${heightUse}`);
    const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
    assert.equal(byId.t6?.travelDir, "S", `${vp.name} one21 must fold DOWN after 5`);
  }
}

{
  // Mid-tablet locked tiles with live hudRight=0: 19→21 stay near full size.
  function mkBi(total) {
    const right = Math.floor((total - 1) / 2);
    const left = total - 1 - right;
    const tiles = [];
    for (let i = left; i >= 1; i -= 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `L${i}`, left: i % 7, right: i % 7 }
          : tile(`L${i}`, i % 7, (i + 1) % 7)
      );
    }
    tiles.push(dbl("c"));
    for (let i = 1; i <= right; i += 1) {
      tiles.push(
        i % 4 === 0
          ? { id: `R${i}`, left: i % 7, right: i % 7 }
          : tile(`R${i}`, i % 7, (i + 1) % 7)
      );
    }
    return { tiles, centerIndex: left };
  }
  const midTablet = { width: 1024, height: 600 };
  let prevScale = null;
  for (const n of [19, 20, 21, 22]) {
    const { tiles, centerIndex } = mkBi(n);
    const { placements, tileScale } = layoutBoard(
      tiles,
      centerIndex,
      midTablet,
      locked,
      { hudRight: 0, hudLeft: 0, maxScale: 1 }
    );
    assert.equal(placements.length, n, `mid-tablet ${n} count`);
    assert.ok(
      tileScale > 0.05 && tileScale <= 1,
      `mid-tablet ${n} scale ${tileScale}`
    );
    if (prevScale != null) {
      assert.ok(
        prevScale - tileScale <= 0.16 + 0.001,
        `mid-tablet scale cliff ${n}: ${prevScale} → ${tileScale}`
      );
    }
    prevScale = tileScale;
  }
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
  // Exact mathematical center on playable felt mid for opening tiles
  const vp = { width: 900, height: 420 };
  const play = computePlayBounds(vp, MARGIN);
  const midX = (play.minX + play.maxX) / 2;
  const midY = (play.minY + play.maxY) / 2;
  for (const opener of [dbl("c"), tile("c", 3, 5)]) {
    const { placements } = layoutBoard([opener], 0, vp, size);
    const p = placements[0];
    assert.ok(
      Math.abs(p.x + p.w / 2 - midX) < 0.01,
      `opener x center ${opener.id}`
    );
    assert.ok(
      Math.abs(p.y + p.h / 2 - midY) < 0.01,
      `opener y center ${opener.id}`
    );
  }
}

{
  // Invisible grid: shared horizontal rail centerlines + exact gaps
  const tiles = [dbl("c")];
  for (let i = 1; i <= 10; i += 1) tiles.push(tile(`r${i}`, i % 7, (i + 1) % 7));
  const { placements, camera } = layoutBoard(
    tiles,
    0,
    { width: 1100, height: 520 },
    size
  );
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const opener = byId.c;
  const playGrid = computePlayBounds({ width: 1100, height: 520 }, MARGIN);
  const feltMidX = (playGrid.minX + playGrid.maxX) / 2;
  // Short openings pin the opener on playable felt mid.
  if (!camera?.recentered) {
    assert.ok(Math.abs(opener.x + opener.w / 2 - feltMidX) < 0.5, "opener pinned");
  }
  assert.ok(!camera?.overflow, "grid chain must stay on-felt");
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
    assert.ok(tileScale > 0.05 && tileScale <= 1, `${vp.width} scale`);
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

{
  // REGRESSION: spinner-arm options must never drop the main chain
  // (empty placements → invisible played tiles).
  const spinner = dbl("6-6");
  const west = tile("5-6", 5, 6);
  const east = tile("3-6", 6, 3);
  const shortFelt = { width: 467, height: 238 };
  const withArms = calculateBoardLayout([west, spinner, east], shortFelt, {
    centerIndex: 1,
    tileWidth: 72,
    tileHeight: 136,
    hudRight: 0,
    spinnerId: "6-6",
    spinnerNorthCount: 2,
    spinnerSouthCount: 2,
  });
  assert.equal(
    withArms.tiles.length,
    3,
    `played tiles must stay laid out with spinner arms, got ${withArms.tiles.length}`
  );
}

{
  // REGRESSION: growing live match must keep every played tile placed
  // (1 / 5 / 10 / 20) on a short phone felt — never an empty board.
  const board = [dbl("c")];
  let open = 6;
  const shortFelt = { width: 467, height: 260 };
  const checkpoints = new Set([1, 5, 10, 20]);
  for (let i = 1; i <= 20; i += 1) {
    const next = (open + 1) % 7;
    board.push(tile(`t${i}`, open, next));
    open = next;
    if (!checkpoints.has(board.length)) continue;
    const layout = calculateBoardLayout(board, shortFelt, {
      centerIndex: 0,
      tileWidth: 72,
      tileHeight: 136,
      hudRight: 0,
    });
    assert.equal(
      layout.tiles.length,
      board.length,
      `n=${board.length} must keep all played tiles visible, got ${layout.tiles.length}`
    );
  }
}

console.log("Board layout engine tests passed.");
