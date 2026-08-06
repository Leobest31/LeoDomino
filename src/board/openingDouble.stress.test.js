/**
 * Opening-double & collision stress — zero overlaps near spinners.
 * Placement algorithm only.
 */
import assert from "node:assert/strict";
import { CHAIN_GAP, layoutBoard } from "./layoutEngine.js";

const VIEWPORTS = [
  { width: 360, height: 280 },
  { width: 768, height: 420 },
  { width: 900, height: 500 },
  { width: 1100, height: 520 },
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
];

const SIZES = [
  { w: 40, h: 76 },
  { w: 52, h: 99 },
  { w: 58, h: 110 },
  { w: 64, h: 122 },
];

function overlaps(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function assertNoOverlap(placements, label) {
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      assert.ok(
        !overlaps(placements[i], placements[j]),
        `${label} overlap ${placements[i].id}/${placements[j].id}`
      );
    }
  }
}

function neighborFaceGap(a, b) {
  const xGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const yGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  if (xOv && !yOv) return yGap;
  if (yOv && !xOv) return xGap;
  return Math.min(xGap, yGap);
}

function assertOpenerAttachments(placements, tiles, centerIndex, label, expectedGap = CHAIN_GAP) {
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  const opener = byId[tiles[centerIndex].id];
  assert.ok(opener, `${label} missing opener`);

  // Opening double is vertical on the E/W ribbon.
  assert.ok(
    opener.h > opener.w,
    `${label} opener should be vertical spinner`
  );

  for (const offset of [-1, 1]) {
    const idx = centerIndex + offset;
    if (idx < 0 || idx >= tiles.length) continue;
    const neighbor = byId[tiles[idx].id];
    assert.ok(neighbor, `${label} missing neighbor ${tiles[idx].id}`);

    const g = neighborFaceGap(opener, neighbor);
    assert.ok(
      g >= expectedGap - 0.75 && g <= expectedGap + 1.5,
      `${label} opener↔${neighbor.id} gap ${g} (expected ~${expectedGap})`
    );

    // Neighbor must not intersect the opener body.
    assert.ok(!overlaps(opener, neighbor), `${label} opener covers ${neighbor.id}`);

    // Must attach on a short side — not through the spinner center column
    // unless centered on the N/S face (then X ranges nest inside opener width).
    const xOv = neighbor.x < opener.x + opener.w && neighbor.x + neighbor.w > opener.x;
    const yOv = neighbor.y < opener.y + opener.h && neighbor.y + neighbor.h > opener.y;
    if (xOv && yOv) {
      assert.fail(`${label} ${neighbor.id} intersects opener AABB`);
    }

    // Side attachments stay centered on the spinner axis.
    if (!xOv && yOv) {
      const cyO = opener.y + opener.h / 2;
      const cyN = neighbor.y + neighbor.h / 2;
      assert.ok(
        Math.abs(cyO - cyN) < 1.5,
        `${label} side neighbor ${neighbor.id} not centered on opener`
      );
    }
  }
}

{
  // Every opening double 0-0 … 6-6 with bilateral arms
  for (let pip = 0; pip <= 6; pip += 1) {
    const tiles = [];
    for (let i = 0; i < 5; i += 1) {
      tiles.push({
        id: `l${i}`,
        left: (pip + i) % 7,
        right: (pip + i + 1) % 7,
      });
    }
    tiles.push({ id: "open", left: pip, right: pip });
    for (let i = 1; i <= 8; i += 1) {
      tiles.push({
        id: `r${i}`,
        left: (pip + i) % 7,
        right: (pip + i + 1) % 7,
      });
    }
    // Sprinkle mid-chain doubles
    tiles[2] = { id: "ld", left: (pip + 1) % 7, right: (pip + 1) % 7 };
    tiles[10] = { id: "rd", left: (pip + 2) % 7, right: (pip + 2) % 7 };
    const centerIndex = 5;

    for (const vp of VIEWPORTS) {
      for (const size of SIZES) {
        const label = `open-${pip} ${vp.width}x${vp.height} ${size.w}`;
        const { placements, gap } = layoutBoard(tiles, centerIndex, vp, size);
        assert.equal(
          placements.length,
          tiles.length,
          `${label} incomplete ${placements.length}/${tiles.length}`
        );
        assertNoOverlap(placements, label);
        assertOpenerAttachments(placements, tiles, centerIndex, label, gap ?? CHAIN_GAP);
      }
    }
  }
}

{
  // Long serpentine with many turns + multiple doubles
  const tiles = [{ id: "open", left: 6, right: 6 }];
  for (let i = 1; i <= 18; i += 1) {
    if (i === 5 || i === 11 || i === 15) {
      tiles.push({ id: `rd${i}`, left: i % 7, right: i % 7 });
    } else {
      tiles.push({ id: `r${i}`, left: i % 7, right: (i + 1) % 7 });
    }
  }
  for (let i = 1; i <= 12; i += 1) {
    if (i === 4 || i === 9) {
      tiles.unshift({ id: `ld${i}`, left: (i + 2) % 7, right: (i + 2) % 7 });
    } else {
      tiles.unshift({ id: `l${i}`, left: (i + 2) % 7, right: (i + 3) % 7 });
    }
  }
  const centerIndex = tiles.findIndex((t) => t.id === "open");

  for (const vp of VIEWPORTS) {
    for (const size of SIZES) {
      const label = `long ${vp.width}x${vp.height} ${size.w}`;
      const { placements, gap } = layoutBoard(tiles, centerIndex, vp, size);
      assert.equal(placements.length, tiles.length, `${label} incomplete`);
      assertNoOverlap(placements, label);
      const expectedGap = gap ?? CHAIN_GAP;
      assertOpenerAttachments(placements, tiles, centerIndex, label, expectedGap);

      // Neighbor gaps stay near the layout's constant face gap
      const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
      for (let i = 1; i < tiles.length; i += 1) {
        const a = byId[tiles[i - 1].id];
        const b = byId[tiles[i].id];
        const g = neighborFaceGap(a, b);
        if (g < -0.01) {
          assert.fail(`${label} negative gap ${tiles[i - 1].id}→${tiles[i].id} = ${g}`);
        }
        if (g >= 0 && g < Math.max(12, expectedGap + 4)) {
          assert.ok(
            g >= expectedGap - 0.75 && g <= expectedGap + 1.5,
            `${label} gap ${tiles[i - 1].id}→${tiles[i].id} = ${g}`
          );
        }
      }
    }
  }
}

console.log("Opening-double stress tests passed.");
