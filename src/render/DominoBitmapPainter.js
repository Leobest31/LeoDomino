/**
 * DominoBitmapPainter — pure Canvas 2D drawing routines for one domino
 * tile's *face* (the content that today lives inside `.domino__face` in
 * Domino.css: ivory plate, grain, sheen, halves, pips, divider, gold pin).
 *
 * This is a deliberate **port**, not a redesign — every layer below maps
 * to a named layer in Domino.css so the visual recipe travels across
 * renderers instead of being reinvented. See Domino.css for the source
 * of truth on intent; this file is the same intent expressed as draw
 * calls instead of gradients/box-shadows.
 *
 * Hard rules that keep this module safe to cache and unit test:
 * - No DOM, no `window`, no game state. Only calls methods on the given
 *   `ctx` (a CanvasRenderingContext2D, or anything duck-typing the same
 *   subset of it — tests pass a lightweight fake).
 * - Deterministic: identical `options` always produce the identical
 *   sequence of draw calls. `dominoBitmapCache.js` depends on this for
 *   correctness (a cache is only safe if "same key" truly means "same
 *   pixels").
 * - Draws entirely within the CSS-pixel box (0,0)..(w,h) that the caller
 *   hands it. DPR scaling is the cache's job (`ctx.scale(dpr, dpr)`
 *   before calling in), not this module's.
 * - `w`/`h` here are the *face* box (what `.domino__face` occupied),
 *   not the full tile box — the outer bevel/thickness band
 *   (`.domino__base`) is untouched CSS in both renderers and is not
 *   reproduced here.
 */

/** 3x3 grid cell indices (0..8, row-major) lit for each pip count. */
export const PIP_LAYOUT = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Face-up cream palette — matches the `--_*` custom properties in Domino.css. */
export const FACE_PALETTE = {
  ivoryTop: "#faf6f0",
  ivoryMid: "#f5ebe0",
  ivoryShade: "#e6d9cb",
  ivoryDeep: "#dccfbf",
  border: "#cfc3b6",
  selectedBorder: "#c4b8ac",
  pipColor: "#000000",
  divider: "#050505",
  dividerGroove: "rgba(255, 250, 242, 0.28)",
};

/** Face-down back palette — matches `.domino--facedown .domino__face`. */
export const BACK_PALETTE = {
  top: "#26332c",
  mid: "#1c2622",
  bottom: "#172019",
  border: "#3d4a44",
};

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Deterministic pseudo-random value in [0, 1) from an integer seed — a
 * classic cheap hash (no stored RNG state), used wherever this module
 * wants organic-looking scatter (material speckle) that must still be a
 * pure function of its inputs for the cache/tests to trust.
 */
function hash01(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A gradient *overlaid on top of* a rounded-rect can only vary along a
 * straight axis — it has no way to actually bend around a corner, so a
 * rounded corner rendered that way always looks like two straight bands
 * crossing, never a genuinely curved lit edge. Real machined bevels
 * catch light differently at every point *around* the curve. This
 * traces the tile's actual rounded silhouette in four corner arcs +
 * four straight edges and colors each according to a single consistent
 * top-left key light — the same technique a 3D renderer's rim/Fresnel
 * light uses, just done by hand for one fixed light direction. Layered
 * on top of the broader soft bevel bands, this is what turns "a
 * rectangle with a gradient" into "a rounded object light is wrapping
 * around".
 */
function paintCurvedRim(ctx, box) {
  const { x, y, w, h, r } = box;
  const inset = 0.6;
  const rw = Math.max(0, w - inset * 2);
  const rh = Math.max(0, h - inset * 2);
  const rr = Math.max(0, Math.min(r - inset, rw / 2, rh / 2));
  const rx = x + inset;
  const ry = y + inset;

  const tl = { x: rx + rr, y: ry + rr };
  const tr = { x: rx + rw - rr, y: ry + rr };
  const br = { x: rx + rw - rr, y: ry + rh - rr };
  const bl = { x: rx + rr, y: ry + rh - rr };

  ctx.save();
  ctx.lineWidth = Math.max(0.4, Math.min(w, h) * 0.016);
  ctx.lineCap = "round";

  ctx.strokeStyle = "rgba(255, 250, 242, 0.4)";
  ctx.beginPath();
  ctx.arc(tl.x, tl.y, rr, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tl.x, ry);
  ctx.lineTo(tr.x, ry);
  ctx.stroke();

  const trGrad = ctx.createLinearGradient(tr.x - rr, tr.y - rr, tr.x + rr, tr.y + rr);
  trGrad.addColorStop(0, "rgba(255, 250, 242, 0.28)");
  trGrad.addColorStop(1, "rgba(62, 46, 28, 0.16)");
  ctx.strokeStyle = trGrad;
  ctx.beginPath();
  ctx.arc(tr.x, tr.y, rr, Math.PI * 1.5, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(62, 46, 28, 0.18)";
  ctx.beginPath();
  ctx.moveTo(rx + rw, tr.y);
  ctx.lineTo(rx + rw, br.y);
  ctx.stroke();

  // Bottom-right: extend the contour slightly past the axes so the rim
  // wraps the rounded corner as one continuous polished edge (same width,
  // faint catch only — not brighter than the upper rims).
  const brGrad = ctx.createLinearGradient(
    br.x + rr * 0.15,
    br.y - rr,
    br.x - rr,
    br.y + rr * 0.15
  );
  brGrad.addColorStop(0, "rgba(62, 46, 28, 0.16)");
  brGrad.addColorStop(0.62, "rgba(62, 46, 28, 0.12)");
  brGrad.addColorStop(1, "rgba(255, 248, 236, 0.1)");
  ctx.strokeStyle = brGrad;
  ctx.beginPath();
  ctx.arc(br.x, br.y, rr, -0.12, Math.PI * 0.5 + 0.12);
  ctx.stroke();

  ctx.strokeStyle = "rgba(62, 46, 28, 0.16)";
  ctx.beginPath();
  ctx.moveTo(br.x, ry + rh);
  ctx.lineTo(bl.x, ry + rh);
  ctx.stroke();

  const blGrad = ctx.createLinearGradient(bl.x - rr, bl.y + rr, bl.x + rr, bl.y - rr);
  blGrad.addColorStop(0, "rgba(62, 46, 28, 0.16)");
  blGrad.addColorStop(1, "rgba(255, 250, 242, 0.24)");
  ctx.strokeStyle = blGrad;
  ctx.beginPath();
  ctx.arc(bl.x, bl.y, rr, Math.PI * 0.5, Math.PI);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 250, 242, 0.24)";
  ctx.beginPath();
  ctx.moveTo(rx, bl.y);
  ctx.lineTo(rx, tl.y);
  ctx.stroke();

  ctx.restore();
}

/**
 * Ivory (or face-down) plate: fill + border + a genuine **multi-stage**
 * bevel — a hard "cut edge" rim (stage 1: directional rim bands + corner
 * light/shadow pooling where two rims meet) followed by a graduated
 * ambient-occlusion falloff (stage 2: a tight hard ring right at the cut,
 * a wider softer one further in). Two visually distinct stages read as a
 * real machined/rounded edge instead of one flat gradient smear.
 */
function paintFacePlate(ctx, box, faceDown, selected) {
  const { x, y, w, h, r } = box;
  const minSide = Math.min(w, h);

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, r);

  const plate = ctx.createLinearGradient(x, y, x + w * 0.32, y + h * 0.34);
  if (faceDown) {
    plate.addColorStop(0, BACK_PALETTE.top);
    plate.addColorStop(0.6, BACK_PALETTE.mid);
    plate.addColorStop(1, BACK_PALETTE.bottom);
  } else {
    plate.addColorStop(0, FACE_PALETTE.ivoryTop);
    plate.addColorStop(0.42, FACE_PALETTE.ivoryMid);
    plate.addColorStop(0.78, FACE_PALETTE.ivoryShade);
    plate.addColorStop(1, FACE_PALETTE.ivoryDeep);
  }
  ctx.fillStyle = plate;
  ctx.fill();

  // Soft silhouette only — no hard plate outline (molded continuous body).
  ctx.lineWidth = 0.75;
  ctx.strokeStyle = faceDown
    ? "rgba(61, 74, 68, 0.35)"
    : selected
      ? "rgba(170, 145, 75, 0.35)"
      : "rgba(160, 145, 125, 0.28)";
  ctx.stroke();
  ctx.restore();

  if (faceDown) return;

  // --- Soft continuous fillet (deck into walls), not a hard cut bevel.
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.clip();

  const topHi = ctx.createLinearGradient(x, y, x, y + h * 0.18);
  topHi.addColorStop(0, "rgba(255, 250, 242, 0.36)");
  topHi.addColorStop(1, "rgba(255, 250, 242, 0)");
  ctx.fillStyle = topHi;
  ctx.fillRect(x, y, w, h * 0.18);

  const leftHi = ctx.createLinearGradient(x, y, x + w * 0.12, y);
  leftHi.addColorStop(0, "rgba(255, 250, 242, 0.24)");
  leftHi.addColorStop(1, "rgba(255, 250, 242, 0)");
  ctx.fillStyle = leftHi;
  ctx.fillRect(x, y, w * 0.12, h);

  const botLo = ctx.createLinearGradient(x, y + h, x, y + h * 0.72);
  botLo.addColorStop(0, "rgba(62, 46, 28, 0.14)");
  botLo.addColorStop(1, "rgba(62, 46, 28, 0)");
  ctx.fillStyle = botLo;
  ctx.fillRect(x, y + h * 0.72, w, h * 0.28);

  const rightLo = ctx.createLinearGradient(x + w, y, x + w * 0.88, y);
  rightLo.addColorStop(0, "rgba(62, 46, 28, 0.12)");
  rightLo.addColorStop(1, "rgba(62, 46, 28, 0)");
  ctx.fillStyle = rightLo;
  ctx.fillRect(x + w * 0.88, y, w * 0.12, h);

  const cornerPool = ctx.createRadialGradient(
    x + w * 0.98, y + h * 0.98, 0,
    x + w * 0.98, y + h * 0.98, minSide * 0.42
  );
  cornerPool.addColorStop(0, "rgba(55, 40, 20, 0.14)");
  cornerPool.addColorStop(1, "rgba(55, 40, 20, 0)");
  ctx.fillStyle = cornerPool;
  ctx.fillRect(x, y, w, h);

  const cornerHi = ctx.createRadialGradient(
    x + w * 0.04, y + h * 0.03, 0,
    x + w * 0.04, y + h * 0.03, minSide * 0.3
  );
  cornerHi.addColorStop(0, "rgba(255, 250, 242, 0.28)");
  cornerHi.addColorStop(1, "rgba(255, 250, 242, 0)");
  ctx.fillStyle = cornerHi;
  ctx.fillRect(x, y, w, h);

  ctx.restore();

  // Soft continuous shoulder rim — faint, not a crisp cut line.
  paintCurvedRim(ctx, box);

  ctx.save();
  roundedRectPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, Math.max(0, r - 0.75));
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(62, 46, 28, 0.09)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundedRectPath(
    ctx,
    x + 2.2,
    y + 2.2,
    Math.max(0, w - 4.4),
    Math.max(0, h - 4.4),
    Math.max(0, r - 2.2)
  );
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(62, 46, 28, 0.045)";
  ctx.stroke();
  ctx.restore();

  if (selected) {
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(170, 145, 75, 0.4)";
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * A real porcelain/bone surface has dozens of tiny, irregular mineral
 * flecks at every scale, not a handful of same-size dots — CSS can only
 * afford a few `radial-gradient()` layers before the declaration
 * becomes unmaintainable, so `Domino.css` settles for ~10 fixed flecks.
 * Canvas has no such ceiling: this procedurally scatters ~70 flecks of
 * varying size, warmth, and opacity from a fixed hash (see `hash01`),
 * so it's still a pure function of nothing but its own fixed indices —
 * deterministic and cache-safe — while looking meaningfully more
 * organic than a handful of hand-placed dots ever could.
 */
const GRAIN_FLECK_COUNT = 70;

function forEachGrainFleck(callback) {
  for (let i = 0; i < GRAIN_FLECK_COUNT; i += 1) {
    const fx = hash01(i * 3.1 + 1.7);
    const fy = hash01(i * 3.1 + 7.3);
    const size = 0.4 + hash01(i * 3.1 + 4.1) * 1.1;
    const warm = hash01(i * 3.1 + 9.9) > 0.45;
    const opacity = 0.03 + hash01(i * 3.1 + 2.4) * 0.06;
    callback(fx, fy, size, warm, opacity);
  }
}

function paintGrain(ctx, box) {
  const { x, y, w, h, r } = box;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.clip();

  // Soft inner vignette toward the perimeter.
  const vignette = ctx.createRadialGradient(
    x + w * 0.46, y + h * 0.42, 0,
    x + w * 0.46, y + h * 0.42, Math.max(w, h) * 0.62
  );
  vignette.addColorStop(0, "rgba(72, 54, 28, 0)");
  vignette.addColorStop(0.72, "rgba(72, 54, 28, 0.05)");
  vignette.addColorStop(1, "rgba(72, 54, 28, 0.085)");
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);

  // Upper-left ambient highlight.
  const hi = ctx.createRadialGradient(
    x + w * 0.18, y + h * 0.12, 0,
    x + w * 0.18, y + h * 0.12, Math.max(w, h) * 0.5
  );
  hi.addColorStop(0, "rgba(255, 250, 242, 0.36)");
  hi.addColorStop(0.4, "rgba(255, 250, 242, 0.1)");
  hi.addColorStop(1, "rgba(255, 250, 242, 0)");
  ctx.fillStyle = hi;
  ctx.fillRect(x, y, w, h);

  // Mineral banding washes — broad, low-opacity warm tone shifts so
  // the ivory isn't a perfectly uniform color field.
  const bands = [
    [0.28, 0.78, "rgba(128, 104, 68, 0.055)"],
    [0.8, 0.18, "rgba(126, 102, 66, 0.042)"],
    [0.68, 0.62, "rgba(142, 120, 82, 0.032)"],
    [0.15, 0.45, "rgba(190, 175, 145, 0.04)"],
    [0.52, 0.28, "rgba(120, 130, 118, 0.022)"],
    [0.36, 0.9, "rgba(150, 128, 90, 0.03)"],
  ];
  for (const [fx, fy, color] of bands) {
    const g = ctx.createRadialGradient(
      x + w * fx, y + h * fy, 0,
      x + w * fx, y + h * fy, Math.max(w, h) * 0.35
    );
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  // Fine mineral flecks — warm (bone-brown) and cool (pale gray) grains
  // interleaved; keep opacity low so texture stays almost invisible.
  const speckleR = Math.max(0.4, Math.min(w, h) * 0.009);
  forEachGrainFleck((fx, fy, size, warm, opacity) => {
    const a = opacity * 0.72;
    ctx.fillStyle = warm
      ? `rgba(98, 80, 54, ${a})`
      : `rgba(148, 146, 140, ${a * 0.8})`;
    ctx.beginPath();
    ctx.arc(x + w * fx, y + h * fy, speckleR * size, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Soft satin clear-coat (mix-blend-mode: soft-light in CSS) — lightly
 * waxed porcelain polish; no wet/plastic screen hotspot.
 */
function paintSheen(ctx, box) {
  const { x, y, w, h, r } = box;
  ctx.save();
  roundedRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.globalAlpha = 0.34;
  ctx.globalCompositeOperation = "soft-light";

  // Broad UL bloom — satin catch-light, never a tight hotspot.
  const bloom = ctx.createRadialGradient(
    x + w * 0.24, y + h * 0.14, 0,
    x + w * 0.24, y + h * 0.14, Math.max(w, h) * 0.42
  );
  bloom.addColorStop(0, "rgba(255, 252, 246, 0.16)");
  bloom.addColorStop(0.38, "rgba(255, 252, 246, 0.05)");
  bloom.addColorStop(0.72, "rgba(255, 252, 246, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(x, y, w, h);

  // Soft directional specular band across the ivory deck (124°).
  const dx = w * Math.cos((124 * Math.PI) / 180);
  const dy = h * Math.sin((124 * Math.PI) / 180);
  const sheen = ctx.createLinearGradient(x, y, x + dx, y + dy);
  sheen.addColorStop(0.34, "rgba(255, 252, 246, 0)");
  sheen.addColorStop(0.44, "rgba(255, 252, 246, 0.04)");
  sheen.addColorStop(0.51, "rgba(255, 252, 246, 0.09)");
  sheen.addColorStop(0.54, "rgba(255, 252, 246, 0.12)");
  sheen.addColorStop(0.6, "rgba(255, 252, 246, 0.06)");
  sheen.addColorStop(0.76, "rgba(255, 252, 246, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

/**
 * Below this radius (CSS px), any multi-stop *gradient* fill — even a
 * single one, let alone the full multi-layer crater treatment — has too
 * few real pixels to sample cleanly: a two-point radial gradient's
 * per-pixel interpolation visibly facets into a soft square/diamond
 * blob instead of a dot once its radius drops to a couple of device
 * pixels. Below the threshold, skip gradients entirely and use flat
 * solid fills instead, which Canvas 2D's arc rasterizer always renders
 * as a clean anti-aliased circle regardless of size.
 */
const SMALL_PIP_THRESHOLD = 3;

/** Crisp recessed black pip for hand/reserve scale. */
function paintPipSimple(ctx, cx, cy, pr) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();

  if (pr >= 1) {
    ctx.beginPath();
    ctx.arc(cx - pr * 0.28, cy - pr * 0.3, Math.max(0.25, pr * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
    ctx.fill();
  }

  ctx.restore();
}

/** One carved recessed black pip at (cx, cy) with radius `pr`. */
function paintPip(ctx, cx, cy, pr) {
  if (pr < SMALL_PIP_THRESHOLD) {
    paintPipSimple(ctx, cx, cy, pr);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);

  const crater = ctx.createRadialGradient(
    cx - pr * 0.24, cy - pr * 0.3, 0,
    cx, cy, pr
  );
  crater.addColorStop(0, "#222222");
  crater.addColorStop(0.24, "#0c0c0c");
  crater.addColorStop(0.5, "#030303");
  crater.addColorStop(0.74, "#000000");
  crater.addColorStop(1, "#000000");
  ctx.fillStyle = crater;
  ctx.fill();

  // Near wall shade — deeper recess
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx - pr * 0.34, cy - pr * 0.34, pr * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
  ctx.fill();
  ctx.restore();

  // Far-wall bounce inside the hole
  const bounce = ctx.createRadialGradient(
    cx + pr * 0.28, cy + pr * 0.34, 0,
    cx + pr * 0.28, cy + pr * 0.34, pr * 0.42
  );
  bounce.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  bounce.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx + pr * 0.28, cy + pr * 0.34, pr * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = bounce;
  ctx.fill();

  // Tiny pale white specular (upper-left) — visible, soft, consistent
  const fleckR = Math.max(0.4, pr * 0.2);
  const fleck = ctx.createRadialGradient(
    cx - pr * 0.32, cy - pr * 0.34, 0,
    cx - pr * 0.32, cy - pr * 0.34, fleckR
  );
  fleck.addColorStop(0, "rgba(255, 255, 255, 0.52)");
  fleck.addColorStop(0.4, "rgba(255, 255, 255, 0.22)");
  fleck.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx - pr * 0.32, cy - pr * 0.34, fleckR, 0, Math.PI * 2);
  ctx.fillStyle = fleck;
  ctx.fill();

  // Raised cream lip around the indent
  ctx.lineWidth = Math.max(0.45, pr * 0.16);
  const rimRadius = Math.max(0, pr - ctx.lineWidth / 2);
  ctx.strokeStyle = "rgba(36, 24, 12, 0.38)";
  ctx.beginPath();
  ctx.arc(cx, cy, rimRadius, Math.PI * 0.75, Math.PI * 1.4);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 250, 242, 0.68)";
  ctx.beginPath();
  ctx.arc(cx, cy, rimRadius, Math.PI * -0.25, Math.PI * 0.4);
  ctx.stroke();

  ctx.restore();
}

/** 3x3 pip grid inset within `cellBox`, lighting only the pips in `PIP_LAYOUT[value]`. */
function paintPipGrid(ctx, cellBox, value) {
  const active = PIP_LAYOUT[value] ?? [];
  if (active.length === 0) return;

  const { x, y, w, h } = cellBox;
  if (!(w > 0) || !(h > 0)) return;

  const gridW = w * 0.8;
  const gridH = h * 0.8;
  const gridX = x + (w - gridW) / 2;
  const gridY = y + (h - gridH) / 2;
  const cellW = gridW / 3;
  const cellH = gridH / 3;
  // Clamped defensively: a genuinely degenerate box (e.g. a transient
  // near-zero measurement mid-layout) must never reach `ctx.arc` with a
  // negative radius — real browsers throw IndexSizeError for that,
  // unlike a permissive test mock.
  const pipRadius = Math.max(0, Math.min(cellW, cellH) * 0.34);
  if (pipRadius <= 0) return;

  for (const index of active) {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const cx = gridX + cellW * (col + 0.5);
    const cy = gridY + cellH * (row + 0.5);
    paintPip(ctx, cx, cy, pipRadius);
  }
}

/** Small brass/gold hinge stud at the divider's center. */
function paintGoldPin(ctx, cx, cy, pinRadius) {
  ctx.save();

  // Soft cast shadow onto the ivory around it — the cue that sells "this
  // is a small raised rivet", not a flat printed dot.
  const shadow = ctx.createRadialGradient(
    cx + pinRadius * 0.2, cy + pinRadius * 0.3, 0,
    cx + pinRadius * 0.2, cy + pinRadius * 0.3, pinRadius * 1.8
  );
  shadow.addColorStop(0, "rgba(15, 10, 2, 0.42)");
  shadow.addColorStop(0.55, "rgba(15, 10, 2, 0.14)");
  shadow.addColorStop(1, "rgba(15, 10, 2, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, pinRadius * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = shadow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);

  const body = ctx.createRadialGradient(
    cx - pinRadius * 0.12, cy - pinRadius * 0.2, 0,
    cx, cy, pinRadius
  );
  body.addColorStop(0, "#f6e3a8");
  body.addColorStop(0.32, "#dcae3e");
  body.addColorStop(0.62, "#ad7c17");
  body.addColorStop(1, "#6e4f0f");
  ctx.fillStyle = body;
  ctx.fill();

  ctx.lineWidth = Math.max(0.4, pinRadius * 0.14);
  ctx.strokeStyle = "rgba(94, 68, 16, 0.45)";
  ctx.stroke();

  // Tight specular fleck — the hard catch-light that reads as metal.
  ctx.beginPath();
  ctx.arc(cx - pinRadius * 0.32, cy - pinRadius * 0.4, pinRadius * 0.32, 0, Math.PI * 2);
  const fleck = ctx.createRadialGradient(
    cx - pinRadius * 0.32, cy - pinRadius * 0.4, 0,
    cx - pinRadius * 0.32, cy - pinRadius * 0.4, pinRadius * 0.32
  );
  fleck.addColorStop(0, "rgba(255, 255, 250, 0.98)");
  fleck.addColorStop(1, "rgba(255, 255, 250, 0)");
  ctx.fillStyle = fleck;
  ctx.fill();

  ctx.restore();
}

/**
 * Engraved center groove (a rounded-cap bar across the tile's short
 * axis, like a router bit's entry/exit) + a soft cast shadow onto the
 * adjacent ivory + gold pin. Rounded caps and a stronger black plateau
 * are what make this read as *machined into* the tile rather than a
 * flat printed stripe.
 */
function paintDivider(ctx, box, orientation) {
  const { x, y, w, h } = box;
  const barThickness = Math.max(2.25, Math.min(w, h) * 0.048);
  const capRadius = barThickness / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  if (orientation === "horizontal") {
    const barH = h * 0.74;
    const bx = cx - barThickness / 2;
    const by = cy - barH / 2;

    roundedRectPath(ctx, bx - 0.75, by - 0.75, barThickness + 1.5, barH + 1.5, capRadius + 0.75);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.36)";
    ctx.stroke();

    // Lower/right cast onto ivory — engraved depth cue
    roundedRectPath(ctx, bx + 0.55, by + 0.85, barThickness, barH, capRadius);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fill();

    roundedRectPath(ctx, bx, by, barThickness, barH, capRadius);
    ctx.clip();
    const groove = ctx.createLinearGradient(bx, 0, bx + barThickness, 0);
    groove.addColorStop(0, "rgba(0, 0, 0, 0.72)");
    groove.addColorStop(0.18, "#000000");
    groove.addColorStop(0.48, "#000000");
    groove.addColorStop(0.7, "#0a0a0a");
    groove.addColorStop(0.88, "rgba(28, 22, 14, 0.92)");
    groove.addColorStop(1, FACE_PALETTE.dividerGroove);
    ctx.fillStyle = groove;
    ctx.fillRect(bx, by, barThickness, barH);
  } else {
    const barW = w * 0.74;
    const bx = cx - barW / 2;
    const by = cy - barThickness / 2;

    roundedRectPath(ctx, bx - 0.75, by - 0.75, barW + 1.5, barThickness + 1.5, capRadius + 0.75);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.36)";
    ctx.stroke();

    roundedRectPath(ctx, bx + 0.55, by + 0.85, barW, barThickness, capRadius);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fill();

    roundedRectPath(ctx, bx, by, barW, barThickness, capRadius);
    ctx.clip();
    const groove = ctx.createLinearGradient(0, by, 0, by + barThickness);
    groove.addColorStop(0, "rgba(0, 0, 0, 0.72)");
    groove.addColorStop(0.18, "#000000");
    groove.addColorStop(0.48, "#000000");
    groove.addColorStop(0.7, "#0a0a0a");
    groove.addColorStop(0.88, "rgba(28, 22, 14, 0.92)");
    groove.addColorStop(1, FACE_PALETTE.dividerGroove);
    ctx.fillStyle = groove;
    ctx.fillRect(bx, by, barW, barThickness);
  }
  ctx.restore();

  const pinRadius = Math.max(1.5, Math.min(w, h) * 0.048);
  paintGoldPin(ctx, cx, cy, pinRadius);
}

/** Two pip halves + divider, arranged per `orientation`. */
function paintHalvesAndDivider(ctx, box, orientation, left, right, size) {
  const { x, y, w, h } = box;
  const pad = (size === "sm" ? 0.06 : 0.07) * Math.min(w, h);
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const dividerSpan = Math.max(2.25, Math.min(w, h) * 0.048);

  if (orientation === "horizontal") {
    const halfW = (innerW - dividerSpan) / 2;
    paintPipGrid(ctx, { x: innerX, y: innerY, w: halfW, h: innerH }, left);
    paintPipGrid(ctx, { x: innerX + halfW + dividerSpan, y: innerY, w: halfW, h: innerH }, right);
  } else {
    const halfH = (innerH - dividerSpan) / 2;
    paintPipGrid(ctx, { x: innerX, y: innerY, w: innerW, h: halfH }, left);
    paintPipGrid(ctx, { x: innerX, y: innerY + halfH + dividerSpan, w: innerW, h: halfH }, right);
  }

  paintDivider(ctx, box, orientation);
}

/** Face-down back pattern — a simple centered bordered rectangle. */
function paintBack(ctx, box) {
  const { x, y, w, h } = box;
  const patW = w * 0.68;
  const patH = h * 0.76;
  const px = x + (w - patW) / 2;
  const py = y + (h - patH) / 2;

  ctx.save();
  roundedRectPath(ctx, px, py, patW, patH, 3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(170, 145, 75, 0.28)";
  ctx.stroke();
  ctx.restore();
}

/**
 * Paint one domino tile's face into `ctx` at CSS-pixel box (0,0)..(w,h).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   left?: number, right?: number, faceDown?: boolean,
 *   orientation?: "vertical"|"horizontal", selected?: boolean,
 *   size?: "sm"|"md", w: number, h: number,
 * }} options
 */
export function paintDominoTile(ctx, options) {
  const {
    left = 0,
    right = 0,
    faceDown = false,
    orientation = "vertical",
    selected = false,
    size = "md",
    w,
    h,
  } = options;

  if (!(w > 0) || !(h > 0)) return;

  const radius = Math.min(w, h) * 0.13;
  const box = { x: 0, y: 0, w, h, r: radius };

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  paintFacePlate(ctx, box, faceDown, selected);

  if (faceDown) {
    paintBack(ctx, box);
  } else {
    paintGrain(ctx, box);
    paintSheen(ctx, box);
    paintHalvesAndDivider(ctx, box, orientation, left, right, size);
  }

  ctx.restore();
}
