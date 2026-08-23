/**
 * DominoLayoutEngine — one LeoDomino chain layout for every ruleset.
 *
 * Pipeline (same game state → same layout):
 *   1. Before any double exists: one horizontal main line in board order
 *      (left end = board[0]). Non-doubles stay horizontal. No spinner
 *      ports, N/S branches, or first-fold routing. Bbox-center the chain
 *      on the usable felt — a centered non-double is not a spinner.
 *   2. First double of the round (spinnerId) becomes the felt-center
 *      anchor. Reflow the already-played chain around it.
 *   3. LEFT/RIGHT/TOP/BOTTOM use deterministic first-turn routing around
 *      that double. The classic 5-straight (LEFT/RIGHT) and 2-straight
 *      (TOP/BOTTOM) locks are the ceiling — they stay when they still fit
 *      at preferred size. If a 5-straight rail cannot fit the usable felt,
 *      the first fold happens earlier so unused felt is used before any
 *      uniform shrink. Fold directions stay locked (left→UP, right→DOWN,
 *      top→RIGHT, bottom→LEFT).
 *   4. Measure the AABB of actual rotated played-tile footprints. Invisible
 *      routing / reserve placeholders must not enlarge that AABB.
 *   5. Keep the preferred tile size when the real chain fits. Translate the
 *      complete AABB into the exclusive playable felt (HUD and Player 1
 *      dock are outside this rectangle) before any uniform auto-fit scale.
 *      Later horizontal runs fold to the felt width so unused vertical
 *      felt is used before shrinking. Parallel runs keep a tile-short
 *      alley on American / All Fives so neighboring rows never crowd.
 *      The American spinner hub stays horizontal; Classic/Haitian doubles
 *      stay vertical. The spinner may leave the geometric felt mid so
 *      unused space above a south branch is used.
 *
 * Preferred first turns when they fit at preferred size:
 *   LEFT  up to 5 straight west  → next tile turns UP
 *   RIGHT up to 5 straight east  → next tile turns DOWN
 *   TOP   2 straight north → tile 3 turns RIGHT
 *   BOTTOM 2 straight south → tile 3 turns LEFT
 *
 * After the first fold, later runs may fold sooner so the packed AABB uses
 * felt height before any uniform shrink. Never let played tiles leave the
 * playable felt.
 *
 * Rotation convention (degrees):
 *   0   — horizontal (long axis E–W)
 *   90  — vertical   (long axis N–S)
 *   180 — horizontal flipped (paint handled by display layer)
 *   270 — vertical flipped
 */

import {
  BRANCH,
  SPINNER_NODE,
  assertBoardTopology,
  buildBoardTopology,
  publicLayoutBranch,
} from "../game/boardTopology.js";
import {
  capPlayedShortPx,
  GAMEPLAY_REF,
  PLAYED_SHORT_MAX_PX,
} from "../ui/gameplayLayout.js";
import {
  formatLayoutIntegrityError,
  inspectBoardLayoutIntegrity,
  layoutDevDiagnosticsEnabled,
  playedTableTiles,
} from "./boardIntegrity.js";

/** @typedef {{ id: string, left: number, right: number }} BoardTile */
/** @typedef {{ width: number, height: number }} Viewport */

export const TILE_ASPECT = 2;
/** Constant face-to-face visual gap (0–2 px). */
export const CHAIN_GAP = 2;
export const GAP = CHAIN_GAP;
export const MARGIN = 14;
export const PADDING = 28;
/** Extra inset inside the playable felt so bones stay off the gold/table frame. */
export const SAFE_FELT_INSET = 12;
export const BRIDGE_LEN = 2;
/**
 * Plan B/C: readable board floor. Effective tile scale must not fall below
 * this for normal match lengths (≤28) unless a hard layout failure forces
 * the documented emergency path (EMERGENCY_MIN_SCALE).
 */
export const MIN_BOARD_SCALE = 0.85;
/** @deprecated Prefer MIN_BOARD_SCALE — kept as alias for callers/tests. */
export const MIN_TILE_SCALE = MIN_BOARD_SCALE;
export const MIN_SCALE = MIN_BOARD_SCALE;
/**
 * LeoDomino main-chain ceiling: tiles after the center double on LEFT and
 * RIGHT stay on the same horizontal line up to this count when that rail
 * still fits at preferred size. The double is not counted. A shorter first
 * run is used when 5-straight would force an unnecessary uniform shrink.
 */
export const LEO_MAIN_STRAIGHT = 5;
export const SPINNER_MAIN_STRAIGHT = LEO_MAIN_STRAIGHT;
/**
 * Preferred first horizontal run on each arm. The next tile takes the
 * deterministic first fold (right → DOWN/S, left → UP/N) — earlier if the
 * felt cannot hold this many tiles at preferred size.
 */
export const TURN_EVERY = LEO_MAIN_STRAIGHT;
/**
 * LeoDomino N/S lock: tiles after the center double on TOP and BOTTOM stay
 * on the same vertical line until this count. The double is not counted.
 */
export const LEO_ARM_STRAIGHT = 2;
export const SPINNER_ARM_STRAIGHT = LEO_ARM_STRAIGHT;
/** Soft upper bound on later horizontal runs after the first fold. */
export const RUN_CEILING = 6;
/**
 * When a long chain is height-bound with unused width, later-run search may
 * exceed RUN_CEILING so the snake can occupy more of the safe rectangle.
 */
export const RUN_SEARCH_CEILING = 18;
/** Expand later-run search only for long boards that already have to shrink. */
const PACK_EXPAND_MIN_TILES = 10;
/**
 * Leftover felt on either axis that still justifies a full first-run /
 * later-run search before accepting a uniform shrink. 22% was too strict:
 * 23-tile American snakes were already axis-capped with ~6–18% unused
 * felt on the other axis, so the engine scaled instead of rerouting.
 */
const PACK_EXPAND_UNUSED_WIDTH = 0.06;
const PACK_ARM_MIN_LEN = 4;
const PACK_ARM_SCALE_GAIN = 0.02;
const PACK_SCALE_TIE = 0.004;
const PACK_ARM_RUN_CEILING = 8;

/**
 * Later-run length from exclusive felt width at the preferred tile size.
 * First LeoDomino folds use packFirstRunLimit; only subsequent rails use this.
 */
export function packRunLimit(usableWidth, tileLong, gap = CHAIN_GAP, ceiling = RUN_CEILING) {
  const step = Math.max(1, Number(tileLong) || 1) + Math.max(0, Number(gap) || 0);
  const widthRun = Math.floor(Math.max(1, Number(usableWidth) || 0) / step);
  return Math.max(2, Math.min(ceiling, widthRun));
}

/**
 * Longest later-run worth trying when the default packing wastes width.
 * Felt-aware: never below the preferred-size run, never above the longer arm.
 */
export function packLaterRunSearchLimit(defaultRun, maxArm, ceiling = RUN_SEARCH_CEILING) {
  const base = Math.max(2, Number(defaultRun) || RUN_CEILING);
  const arm = Math.max(base, Number(maxArm) || base);
  return Math.max(base, Math.min(Math.max(2, Number(ceiling) || RUN_SEARCH_CEILING), arm));
}

function packingFittedSlack(picked, safeW, safeH) {
  const aabbW = Math.max(1, picked.content?.width || 1);
  const aabbH = Math.max(1, picked.content?.height || 1);
  const scale = Number(picked.scale) || 0;
  const fittedW = aabbW * scale;
  const fittedH = aabbH * scale;
  const slackW = safeW - fittedW;
  const slackH = safeH - fittedH;
  return {
    slackFracW: slackW / Math.max(1, safeW),
    slackFracH: slackH / Math.max(1, safeH),
    waste: 1 - (fittedW * fittedH) / Math.max(1, safeW * safeH),
  };
}

/** Width-bound shrink with leftover felt height: try shorter rails / earlier folds. */
function packingNeedsTighterRunSearch(played, scale, slackFracW, slackFracH) {
  if (played < 6 || played > 32) return false;
  if (!(scale < 0.99)) return false;
  return slackFracH >= PACK_EXPAND_UNUSED_WIDTH && slackFracW + 0.02 <= slackFracH;
}

/**
 * Opposite LEFT↑ / RIGHT↓ folds occupy both halves of a short felt and
 * height-cap the uniform scale while width is still free. Same-direction
 * folds let the snake sit in one half, then AABB-recenter into the table.
 */
function packingNeedsSameDirFoldSearch(played, scale, _slackFracW, slackFracH, maxArm = 0) {
  if (played < 18 || played > 32) return false;
  if (Math.max(0, maxArm) < 8) return false;
  if (!(scale < 0.99)) return false;
  return slackFracH <= 0.08;
}

/** Balanced arms never hit the |L-R|≥3 path; still try independent first-runs. */
function packingNeedsBalancedFirstRunSearch(
  played,
  scale,
  slackFracW,
  slackFracH,
  leftLen,
  rightLen
) {
  if (played < 20 || played > 32) return false;
  if (!(scale < 0.99)) return false;
  if (Math.abs(leftLen - rightLen) >= 3) return false;
  if (Math.max(leftLen, rightLen) < 8) return false;
  return (
    slackFracW >= PACK_EXPAND_UNUSED_WIDTH || slackFracH >= PACK_EXPAND_UNUSED_WIDTH
  );
}

/**
 * Default 5-straight packing already had to shrink. Search the full legal
 * first-run × later-run grid before accepting that uniform scale. Do not
 * require leftover-felt slack: a medium chain can look "tight" on a bad
 * route and then a longer chain finds a better snake and appears to grow.
 */
function packingNeedsFullRunSearch(played, scale) {
  if (played < PACK_EXPAND_MIN_TILES) return false;
  if (played > 32) return false;
  return scale < 0.99;
}

function resolveFirstRunOverride(override, side) {
  if (override && typeof override === "object") {
    const n = side === "left" ? override.left : override.right;
    if (Number.isFinite(n)) return Math.floor(n);
  }
  if (Number.isFinite(override)) return Math.floor(override);
  return null;
}

function packingNeedsSpinnerArmSearch(northN, southN, scale, slackFracW, slackFracH) {
  if (Math.max(northN, southN) < PACK_ARM_MIN_LEN) return false;
  // Double-six four-way boards can reach ~11+11. Skip only pathological
  // stress lengths so 500-move layout runs stay bounded.
  if (northN + southN > 26) return false;
  if (Math.max(northN, southN) > 14) return false;
  if (!(scale < 0.99)) return false;
  return slackFracH >= PACK_EXPAND_UNUSED_WIDTH && slackFracW <= slackFracH + 0.02;
}

function spinnerArmRunCandidates(minStraight, maxArm) {
  const remaining = Math.max(0, maxArm - Math.max(1, minStraight));
  const runs = [0];
  if (remaining < 3) return runs;
  const maxRun = Math.min(PACK_ARM_RUN_CEILING, remaining);
  for (let r = 2; r <= maxRun; r += 1) runs.push(r);
  return runs;
}

function isBetterArmCandidate(candidate, best) {
  if (!best) return true;
  if (candidate.scale > best.scale + PACK_SCALE_TIE) return true;
  if (candidate.scale < best.scale - PACK_SCALE_TIE) return false;
  if (candidate.armRun === 0 && best.armRun !== 0) return true;
  if (best.armRun === 0 && candidate.armRun !== 0) return false;
  if (candidate.turns !== best.turns) return candidate.turns < best.turns;
  return candidate.armRun >= best.armRun;
}

function packingHasOverlap(picked) {
  const boxes = [...(picked.tiles || []), ...(picked.armTiles || [])];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i], boxes[j])) return true;
    }
  }
  return false;
}

function isCompletePicked(picked, mainTiles, northTiles, southTiles) {
  if (!picked) return false;
  return inspectBoardLayoutIntegrity(
    picked,
    playedTableTiles(mainTiles, northTiles, southTiles)
  ).ok;
}

function forceAttachTile(prev, tile, size, gap, dir, branch) {
  const travel = dir || prev?.travelDir || "E";
  const anchor = prev || {
    id: "__origin",
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
    travelDir: travel,
  };
  const box = placeAgainst(anchor, tile, travel, size, gap, travel);
  return {
    ...box,
    travelDir: travel,
    branch,
    isCorner: false,
    isBridge: !isMainAxisDir(travel),
  };
}

function fillMissingPlayedTiles(map, chain, size, gap, defaultDir, branchFor, startPrev = null) {
  if (!chain.length) return;
  let prev = startPrev && startPrev.id ? startPrev : null;
  for (const tile of chain) {
    if (map.has(tile.id)) {
      prev = map.get(tile.id);
      continue;
    }
    const branch = branchFor?.(tile) || prev?.branch || BRANCH.MAIN_RIGHT;
    const placed = forceAttachTile(
      prev,
      tile,
      size,
      gap,
      prev?.travelDir || defaultDir,
      branch
    );
    map.set(tile.id, placed);
    prev = placed;
  }
}

function takeScreenTile(byId, tile, neighbor, fallback, size, scale, topology) {
  const hit = byId.get(tile.id);
  if (
    hit &&
    Number.isFinite(hit.x) &&
    Number.isFinite(hit.y) &&
    Number.isFinite(hit.w) &&
    Number.isFinite(hit.h) &&
    hit.w > 0 &&
    hit.h > 0 &&
    (hit.orientation === "horizontal" || hit.orientation === "vertical")
  ) {
    return hit;
  }
  const src = neighbor ? byId.get(neighbor.id) : null;
  const w = src?.w || size.w * (scale || 1);
  const h = src?.h || size.h * (scale || 1);
  return {
    tileId: tile.id,
    valueLeft: Number(tile.left),
    valueRight: Number(tile.right),
    x: Number.isFinite(src?.x) ? src.x + src.w + 2 : Number(fallback?.x) || 0,
    y: Number.isFinite(src?.y) ? src.y : Number(fallback?.y) || 0,
    w,
    h,
    rotation: src?.rotation ?? 0,
    orientation:
      src?.orientation ||
      (Number(tile.left) === Number(tile.right) ? "vertical" : "horizontal"),
    zIndex: 0,
    travelDir: src?.travelDir || "E",
    branch: topology?.membership?.[tile.id] ?? src?.branch,
    double: Number(tile.left) === Number(tile.right),
  };
}

function isBetterPacking(candidate, best, laterRunDefault) {
  if (!best) return true;
  const scaleDelta = candidate.scale - best.scale;
  if (scaleDelta > PACK_SCALE_TIE) return true;
  if (scaleDelta < -PACK_SCALE_TIE) return false;
  if (candidate.laterRun === best.laterRun) {
    return candidate.firstRun > best.firstRun;
  }
  if (candidate.waste < best.waste - 0.02) return true;
  if (best.waste < candidate.waste - 0.02) return false;
  const candEven = Math.abs(candidate.slackFracW - candidate.slackFracH);
  const bestEven = Math.abs(best.slackFracW - best.slackFracH);
  if (candEven < bestEven - 0.02) return true;
  if (bestEven < candEven - 0.02) return false;
  if (candidate.firstRun !== best.firstRun) return candidate.firstRun > best.firstRun;
  const candRunDist = Math.abs(candidate.laterRun - laterRunDefault);
  const bestRunDist = Math.abs(best.laterRun - laterRunDefault);
  if (candRunDist !== bestRunDist) return candRunDist < bestRunDist;
  return candidate.turns <= best.turns;
}

/**
 * Max LEFT/RIGHT tiles that can stay on the opening E/W rail at preferred
 * size without overflowing usable felt width. Ceiling is LEO_MAIN_STRAIGHT.
 *
 * Width model: spinner short side + 2 × n × (tileLong + gap).
 */
export function packFirstRunLimit(
  usableWidth,
  tileLong,
  tileShort,
  gap = CHAIN_GAP,
  ceiling = LEO_MAIN_STRAIGHT
) {
  const step = Math.max(1, Number(tileLong) || 1) + Math.max(0, Number(gap) || 0);
  const short = Math.max(1, Number(tileShort) || 1);
  const inner = Math.max(0, (Number(usableWidth) || 0) - short);
  const n = Math.floor(inner / (2 * step));
  const cap = Math.max(1, Math.min(LEO_MAIN_STRAIGHT, Number(ceiling) || LEO_MAIN_STRAIGHT));
  return Math.max(1, Math.min(cap, n));
}

/**
 * Felt height below which a 2-straight TOP/BOTTOM column is allowed to
 * fold after 1 tile. Tablet/desktop felts stay on SPINNER_ARM_STRAIGHT.
 *
 * A spinner is a vertical double (height = tile long). Two north + spinner
 * + two south is five longs — taller than a short phone landscape felt.
 */
export const SPINNER_ARM_SHORT_FELT_H = 320;

export function packSpinnerArmLimit(
  safeHeight,
  tileLong,
  tileShort,
  gap = CHAIN_GAP
) {
  const long = Math.max(Number(tileLong) || 1, Number(tileShort) || 1);
  const g = Math.max(0, Number(gap) || 0);
  const h = Math.max(1, Number(safeHeight) || 0);
  if (h >= SPINNER_ARM_SHORT_FELT_H) return SPINNER_ARM_STRAIGHT;
  const col2 = 5 * long + 4 * g;
  if (col2 <= h + 0.5) return SPINNER_ARM_STRAIGHT;
  return 1;
}

export const CHAIN_GAP_PX = CHAIN_GAP;
export const SEGMENT_TILES = TURN_EVERY;
/** Canonical first-fold directions (locked LeoDomino snake). */
export const FIRST_FOLD_RIGHT = "S";
export const FIRST_FOLD_LEFT = "N";
export const FIRST_FOLD_TOP = "E";
export const FIRST_FOLD_BOTTOM = "W";
export const SAFETY_MARGIN_PX = MARGIN;
export const MIN_BOARD_ZOOM = MIN_BOARD_SCALE;
export const MAX_GLOBAL_ZOOM = MIN_BOARD_SCALE;
/** Desktop readability floor for effective board tile short side (px). */
export const MIN_DESKTOP_TILE_PX = 30;
/**
 * Historical tablet-landscape preferred size (hand×2.93 ≈ 99×186). Live
 * preferred size now comes from `resolveGameplayLayout` / `--played-tile-*`
 * (PLAYED_PREFERRED_SCALE on that 99×186 reference). This factor remains
 * the locked historical note for engine tests.
 */
export const BOARD_TILE_HAND_FACTOR = 2.93;
/** Soft floor/ceiling for the unscaled board base short side (px). */
export const BOARD_BASE_SHORT_MIN_PX = 44;
export const BOARD_BASE_SHORT_MAX_PX = PLAYED_SHORT_MAX_PX;
/** Locked preferred board tile — same source as GAMEPLAY_REF played size. */
export const LOCKED_BOARD_TILE_SHORT_PX = GAMEPLAY_REF.playedShort;
export const LOCKED_BOARD_TILE_LONG_PX = GAMEPLAY_REF.playedLong;
/**
 * Readable short-side floor (px) at locked base × MIN_BOARD_SCALE.
 * Preferred for mid-match (≤21). Snap may land ~0.5px under this.
 */
export const MIN_READABLE_TILE_SHORT_PX =
  LOCKED_BOARD_TILE_SHORT_PX * MIN_BOARD_SCALE;
/**
 * Hard scale floor for a full double-six chain (≤28). Spinner-tall rows need
 * ~4 lanes on mid tablets/portrait — slightly below MIN_BOARD_SCALE is
 * required, but never the old emergency strip scales (~0.4).
 */
export const MIN_MATCH_SCALE = 0.62;
export const MIN_MATCH_TILE_SHORT_PX =
  LOCKED_BOARD_TILE_SHORT_PX * MIN_MATCH_SCALE;
/**
 * Extra collision halo around spinner (double) boxes — not added to face gap.
 * Sized for the locked ~72×136 footprint (was tuned on smaller tiles).
 */
export const SPINNER_RESERVE = 3;
/** Extra collision halo around turn/corner tiles (direction changes). */
export const CORNER_RESERVE = 3;
/** Extra collision halo around vertical-bridge tiles (keeps branches apart). */
export const BRIDGE_RESERVE = 2;
/** Hard floor for the final on-screen gap — never allowed to shrink toward 0. */
export const MIN_SAFE_GAP_PX = 0.6;
/** Floor for usable felt height after the hand-dock carve-out. */
export const MIN_PLAYABLE_HEIGHT = 180;

const EMERGENCY_MIN_SCALE = 0.05;
/** Extra clearance so half-pixel snap after screen mapping cannot collapse the gap. */
const SNAP_CLEARANCE = 0.5;
const OPP = Object.freeze({ E: "W", W: "E", N: "S", S: "N" });
const RESERVE_PREFIX = "__spin-";

/**
 * American / All Fives board policy (not Classic or Haitian).
 * Spinner hub stays horizontal. Parallel (non-connected) chain runs keep a
 * tile-short + face-gap alley so a 1-tile wrap cannot pack rows to ~0px.
 */
export function usesAmericanBoardLayout(rulesetId) {
  const id = String(rulesetId || "");
  return id === "american" || id === "allFives";
}

/**
 * Minimum face-to-face gap between neighboring parallel chain runs.
 * Scales with the rendered tile short side plus the connected-face gap —
 * not a per-device CSS or coordinate constant.
 */
export function parallelRunClearance(size, gap = CHAIN_GAP) {
  const short = Math.min(
    Math.max(1, Number(size?.w) || 0),
    Math.max(1, Number(size?.h) || 0)
  );
  const g = Math.max(0, Number(gap) || 0);
  return short + g;
}

const DEFAULT_LAYOUT_POLICY = Object.freeze({
  rulesetId: "",
  american: false,
  horizontalSpinner: false,
  verticalMainChain: false,
  spinnerId: null,
  runClear: CHAIN_GAP + SNAP_CLEARANCE,
});

/** @type {typeof DEFAULT_LAYOUT_POLICY | null} */
let activeLayoutPolicy = null;

function layoutPolicy() {
  return activeLayoutPolicy || DEFAULT_LAYOUT_POLICY;
}

export function createBoardLayoutPolicy(options, size, gap) {
  const american = usesAmericanBoardLayout(options?.rulesetId);
  const spinnerId =
    typeof options?.spinnerId === "string" && options.spinnerId
      ? options.spinnerId
      : null;
  return {
    rulesetId: String(options?.rulesetId || ""),
    american,
    horizontalSpinner: Boolean(american && spinnerId),
    verticalMainChain: american,
    spinnerId,
    runClear: american
      ? parallelRunClearance(size, gap)
      : Math.max(0, Number(gap) || 0) + SNAP_CLEARANCE,
  };
}

function americanVerticalMain() {
  return Boolean(layoutPolicy().american);
}

/** Main-rail start/fold dirs. American: N/S through a horizontal spinner. */
function mainRailDirs() {
  if (americanVerticalMain()) {
    return { right: "N", left: "S", foldRight: "E", foldLeft: "W" };
  }
  return {
    right: "E",
    left: "W",
    foldRight: FIRST_FOLD_RIGHT,
    foldLeft: FIRST_FOLD_LEFT,
  };
}

/** Spinner-arm start dirs. American: W/E off the horizontal spinner. */
function spinnerArmStartDirs() {
  if (americanVerticalMain()) return { top: "W", bottom: "E" };
  return { top: "N", bottom: "S" };
}

function spinnerArmFoldDir(startDir) {
  if (startDir === "N") return FIRST_FOLD_TOP;
  if (startDir === "S") return FIRST_FOLD_BOTTOM;
  if (startDir === "W") return "N";
  return "S";
}

function isMainAxisDir(dir, verticalMain = americanVerticalMain()) {
  return verticalMain ? dir === "N" || dir === "S" : dir === "E" || dir === "W";
}

function asLayoutPolicy(value) {
  return value && typeof value === "object" ? value : null;
}

function isReserveId(id) {
  return typeof id === "string" && id.startsWith(RESERVE_PREFIX);
}

function snap(n) {
  return Math.round(n * 2) / 2;
}

function isDouble(tile) {
  return Number(tile.left) === Number(tile.right);
}

/** How many tiles ahead (in travel order) to look when preferring a double
 * as the natural fold point instead of an arbitrary run-limit cutoff. */
const DOUBLE_LOOKAHEAD = 2;

/** True if a double appears within `count` tiles ahead of index `i`,
 * walking in travel order (`step` is +1 for the right arm, -1 for left). */
function hasDoubleAhead(tiles, i, step, count) {
  for (let k = 1; k <= count; k += 1) {
    const t = tiles[i + k * step];
    if (!t) break;
    if (isDouble(t)) return true;
  }
  return false;
}

/**
 * Reserve halos shrink proportionally at emergency-small scales (deep
 * chains on tiny viewports) so they never make an already-tight layout
 * geometrically infeasible — at normal scale the full reserve applies.
 */
function scaledReserve(base, span) {
  if (span >= 20) return base;
  return Math.min(base, Math.max(0, span * 0.12));
}

/**
 * Reserve halo for a placed tile — larger around doubles (spinners), then
 * turn/corner tiles, then vertical-bridge tiles, so branches never crowd
 * the geometry that other arms depend on for clearance.
 */
export function reserveFor(p) {
  const span = Math.max(p.w || 0, p.h || 0);
  if (p.double) return scaledReserve(SPINNER_RESERVE, span);
  if (p.isCorner) return scaledReserve(CORNER_RESERVE, span);
  if (p.isBridge) return scaledReserve(BRIDGE_RESERVE, span);
  return 0;
}

/**
 * Fixed collision rectangle for a placed tile.
 * Spinners, corners, and vertical bridges get a reserve halo so branches
 * clear the body and never enter another branch's reserved space.
 */
export function collisionBox(p) {
  const pad = reserveFor(p);
  return {
    id: p.id,
    x: p.x - pad,
    y: p.y - pad,
    w: p.w + pad * 2,
    h: p.h + pad * 2,
    double: !!p.double,
    isCorner: !!p.isCorner,
    isBridge: !!p.isBridge,
  };
}

/**
 * Doubles stay vertical on the chain (spinner on E/W rails; end-to-end on
 * bridges), except the American / All Fives spinner hub, which stays
 * horizontal as the visual center of the four-way topology.
 * Non-doubles align with the path.
 */
export function rotationForTravel(tile, dir, policyArg = null) {
  const p = asLayoutPolicy(policyArg) || layoutPolicy();
  if (p?.horizontalSpinner && p.spinnerId && tile?.id === p.spinnerId) {
    return 0;
  }
  if (isDouble(tile)) return 90;
  const alongEW = dir === "E" || dir === "W";
  return alongEW ? 0 : 90;
}

export function orientationForTravel(tile, dir) {
  return rotationForTravel(tile, dir) === 90 ? "vertical" : "horizontal";
}

export function rotationForOrientation(orientation) {
  return orientation === "horizontal" ? 0 : 90;
}

/** Footprint in local px for a travel direction. */
export function footprintForTravel(tile, dir, size) {
  const rotation = rotationForTravel(tile, dir);
  const vertical = rotation === 90 || rotation === 270;
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  return {
    w: vertical ? short : long,
    h: vertical ? long : short,
    orientation: vertical ? "vertical" : "horizontal",
    rotation,
  };
}

export function tileFootprint(tile, size) {
  const vertical = (tile.orientation || "horizontal") === "vertical";
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  return vertical ? { w: short, h: long } : { w: long, h: short };
}

function effectiveGap(short, long, requested = CHAIN_GAP) {
  const span = Math.max(short, long);
  // Keep visual gap in the 0–2 px band; ease down only for emergency tiny tiles.
  if (span >= 12) return Math.min(2, Math.max(0, requested));
  return Math.max(0, Math.min(2, requested, snap(span * 0.08)));
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function axisClearance(a, b) {
  const xOv = a.x < b.x + b.w && a.x + a.w > b.x;
  const yOv = a.y < b.y + b.h && a.y + a.h > b.y;
  if (xOv && yOv) return -1;
  const xClear =
    a.x + a.w <= b.x
      ? b.x - (a.x + a.w)
      : b.x + b.w <= a.x
        ? a.x - (b.x + b.w)
        : 0;
  const yClear =
    a.y + a.h <= b.y
      ? b.y - (a.y + a.h)
      : b.y + b.h <= a.y
        ? a.y - (b.y + b.h)
        : 0;
  if (xOv) return yClear;
  if (yOv) return xClear;
  return Math.min(xClear, yClear);
}

/**
 * Collision gate: fixed AABB (spinner/corner/bridge halo included); non-neighbors
 * need ≥ minClear. Vertical branches vs horizontal rails are rejected on any AABB hit.
 * At emergency-tiny spans, fall back to essential boxes so routing stays feasible.
 */
function findWrapCollision(box, occupied, gap, attachId = null) {
  const minClear = layoutPolicy().american
    ? layoutPolicy().runClear
    : Math.max(0, Number(gap) || 0);
  for (const other of occupied) {
    if (other.id === box.id) continue;
    if (other.id === attachId) {
      if (overlaps(box, other)) return { other, reason: "overlap-attach" };
      continue;
    }
    if (overlaps(box, other)) return { other, reason: "overlap" };
    const xOv = box.x < other.x + other.w && box.x + box.w > other.x;
    const yOv = box.y < other.y + other.h && box.y + box.h > other.y;
    const clear = axisClearance(box, other);
    if ((xOv || yOv) && clear < minClear - 0.05) {
      return { other, reason: "tight", clearance: clear };
    }
  }
  return null;
}

function findCollision(box, occupied, gap, attachId = null, minClear) {
  const required = minClear ?? layoutPolicy().runClear;
  const span = Math.max(box.w || 0, box.h || 0, 0);
  const useEssential = span < 20;
  const probe = useEssential ? essentialCollisionBox(box) : collisionBox(box);
  for (const other of occupied) {
    if (other.id === box.id) continue;
    const hull = useEssential ? essentialCollisionBox(other) : collisionBox(other);
    if (other.id === attachId) {
      // Neighbors: only the visual tile boxes may not overlap (halo may touch).
      if (overlaps(box, other)) return { other, reason: "overlap-attach" };
      continue;
    }
    if (overlaps(probe, hull)) return { other, reason: "aabb-overlap" };
    const xOv = probe.x < hull.x + hull.w && probe.x + probe.w > hull.x;
    const yOv = probe.y < hull.y + hull.h && probe.y + probe.h > hull.y;
    const clear = axisClearance(probe, hull);
    const probeH = (probe.w || 0) >= (probe.h || 0) - 0.5;
    const hullH = (hull.w || 0) >= (hull.h || 0) - 0.5;
    const probeV = (probe.h || 0) > (probe.w || 0) + 0.5;
    const hullV = (hull.h || 0) > (hull.w || 0) + 0.5;
    const faceClear = Math.max(0, Number(gap) || 0) + SNAP_CLEARANCE;
    const rowNeed = probeH && hullH ? required : faceClear;
    const colNeed = probeV && hullV ? required : faceClear;
    if (xOv && clear < rowNeed - 0.05) {
      return { other, reason: "row-clearance", clearance: clear };
    }
    if (yOv && clear < colNeed - 0.05) {
      return { other, reason: "col-clearance", clearance: clear };
    }
  }
  return null;
}

function fitsSoft(box, soft) {
  return (
    box.x >= soft.minX - 0.01 &&
    box.y >= soft.minY - 0.01 &&
    box.x + box.w <= soft.maxX + 0.01 &&
    box.y + box.h <= soft.maxY + 0.01
  );
}

/**
 * Temporarily widen soft bounds so a started vertical bridge / first fold
 * can finish — but NEVER past the hard playable-table rect.
 */
function expandSoft(soft, size, bridges = BRIDGE_LEN, hard = null) {
  const pad = Math.max(size.w, size.h) * bridges + CHAIN_GAP * 3;
  const expanded = {
    minX: soft.minX - pad,
    maxX: soft.maxX + pad,
    minY: soft.minY - pad,
    maxY: soft.maxY + pad,
  };
  if (!hard) return expanded;
  return {
    minX: Math.max(hard.minX, expanded.minX),
    maxX: Math.min(hard.maxX, expanded.maxX),
    minY: Math.max(hard.minY, expanded.minY),
    maxY: Math.min(hard.maxY, expanded.maxY),
  };
}

function playMid(play) {
  return {
    x: (play.minX + play.maxX) / 2,
    y: (play.minY + play.maxY) / 2,
  };
}

/** True if every screen tile AABB sits fully inside the playable green rect. */
function screenTilesInsidePlay(tiles, play, pad = 0.5) {
  for (const t of tiles) {
    if (t.x < play.minX - pad) return false;
    if (t.y < play.minY - pad) return false;
    if (t.x + t.w > play.maxX + pad) return false;
    if (t.y + t.h > play.maxY + pad) return false;
  }
  return true;
}

/**
 * Place `tile` against `prev` traveling `dir`.
 * Face gap is always `gap` (0–2 px). Spinner reserve is collision-only (see collisionBox).
 *
 * 90° turns use END-SIDE attachment (not underlap): the next tile sits past the
 * open end of `prev` so horizontal and vertical AABBs only touch at the
 * connection endpoint — never stack the vertical body under the rail. That
 * underlap was tuned for smaller tiles and collides with spinner protrusions
 * at the locked ~72×136 board size.
 */
function placeAgainst(prev, tile, dir, size, gap, fromDir) {
  const fp = footprintForTravel(tile, dir, size);
  const turning = Boolean(fromDir && fromDir !== dir);
  const prevVert = prev.h > prev.w + 0.5;
  const prevDouble = !!prev.double;
  const ew = dir === "E" || dir === "W";
  let x;
  let y;

  const edge = () => {
    if (dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y + (prev.h - fp.h) / 2 };
    }
    if (dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y + (prev.h - fp.h) / 2 };
    }
    if (dir === "S") {
      return { x: prev.x + (prev.w - fp.w) / 2, y: prev.y + prev.h + gap };
    }
    return { x: prev.x + (prev.w - fp.w) / 2, y: prev.y - gap - fp.h };
  };

  /** Rail → bridge: sit past the open end, flush with the travel-side edge. */
  const railToBridge = () => {
    if (fromDir === "E" && dir === "S") {
      return { x: prev.x + prev.w + gap, y: prev.y };
    }
    if (fromDir === "E" && dir === "N") {
      return { x: prev.x + prev.w + gap, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "W" && dir === "S") {
      return { x: prev.x - gap - fp.w, y: prev.y };
    }
    if (fromDir === "W" && dir === "N") {
      return { x: prev.x - gap - fp.w, y: prev.y + prev.h - fp.h };
    }
    return null;
  };

  /** Bridge → rail: sit past the open end, flush with the exit edge. */
  const bridgeToRail = () => {
    if (fromDir === "S" && dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "S" && dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y + prev.h - fp.h };
    }
    if (fromDir === "N" && dir === "E") {
      return { x: prev.x + prev.w + gap, y: prev.y };
    }
    if (fromDir === "N" && dir === "W") {
      return { x: prev.x - gap - fp.w, y: prev.y };
    }
    return null;
  };

  if (!turning || prevDouble) {
    ({ x, y } = edge());
  } else if (!prevVert && !ew) {
    ({ x, y } = railToBridge() || edge());
  } else if (prevVert && ew) {
    ({ x, y } = bridgeToRail() || edge());
  } else {
    ({ x, y } = edge());
  }

  return {
    id: tile.id,
    x: snap(x),
    y: snap(y),
    w: snap(fp.w),
    h: snap(fp.h),
    orientation: fp.orientation,
    rotation: fp.rotation,
    double: isDouble(tile),
    valueLeft: Number(tile.left),
    valueRight: Number(tile.right),
  };
}

function boxesTouchOrNear(a, b, maxClear) {
  if (overlaps(a, b)) return true;
  const clear = axisClearance(a, b);
  return clear >= -0.01 && clear <= maxClear + 0.75;
}

/**
 * After a legal N/S wrap fold, place the returning rail so it stays in edge
 * contact with the wrap tile but does not sit on top of the previous rail.
 * Aspect ratios slightly under 2:1 make a naive 1-tile wrap overlap the
 * previous row; this only nudges along the wrap face.
 */
function placeSpinnerWrapRail(prev, tile, dir, size, gap, fromDir, awayDir, priorRail) {
  const box = placeAgainst(prev, tile, dir, size, gap, fromDir);
  if (!priorRail || (dir !== "E" && dir !== "W")) return box;
  const g = Math.max(0, Number(gap) || 0);
  const rowClear = layoutPolicy().american ? layoutPolicy().runClear : g;
  let y = box.y;
  if (awayDir === "N") {
    const clearBottom = priorRail.y - rowClear;
    if (box.y + box.h > clearBottom + 0.01) y = clearBottom - box.h;
  } else if (awayDir === "S") {
    const clearTop = priorRail.y + priorRail.h + rowClear;
    if (box.y < clearTop - 0.01) y = clearTop;
  }
  const nudged = { ...box, y: snap(y) };
  if (!boxesTouchOrNear(nudged, prev, g + 1)) return null;
  if (overlaps(nudged, priorRail)) return null;
  return nudged;
}

function isLegalStep(prev, tile, dir, size) {
  const fp = footprintForTravel(tile, dir, size);
  const prevVert = prev.h > prev.w + 0.5;
  const prevDouble = !!prev.double;
  const ew = dir === "E" || dir === "W";
  // Doubles stay vertical. A fold onto E/W therefore sits beside the previous
  // vertical bone instead of becoming a horizontal rail tile.
  if (prevVert && !prevDouble && ew) {
    return isDouble(tile) || fp.orientation === "horizontal";
  }
  if (!prevVert && !ew) {
    return fp.orientation === "vertical" || isDouble(tile);
  }
  return true;
}

/** Routed footprint even when the preferred-size halo would reject it. */
function routedBox(prev, tile, dir, fromDir, size, gap) {
  const box = placeAgainst(prev, tile, dir, size, gap, fromDir);
  box.isCorner = Boolean(fromDir && fromDir !== dir);
  box.isBridge = dir === "N" || dir === "S";
  return box;
}

function tryPlace(prev, tile, dir, fromDir, size, gap, soft, occupied, hard = null) {
  if (!isLegalStep(prev, tile, dir, size)) return null;
  // Predict the full rotated footprint before committing the placement.
  const box = placeAgainst(prev, tile, dir, size, gap, fromDir);
  const turning = Boolean(fromDir && fromDir !== dir);
  box.isCorner = turning;
  box.isBridge = dir === "N" || dir === "S";
  // Soft encourages early turns; hard playable-table bounds always win.
  if (!fitsSoft(box, soft)) return null;
  if (hard && !fitsSoft(box, hard)) return null;
  if (findCollision(box, occupied, gap, prev.id)) return null;
  return box;
}

/**
 * Grow one arm as a deterministic LeoDomino ribbon.
 * When the center is a double: first-run tiles stay on the startDir rail
 * (up to LEO_MAIN_STRAIGHT, or fewer when that rail cannot fit the felt at
 * preferred size), then the next tile MUST take foldDir (never the opposite).
 * Before any double exists the chain stays linear (no fake spinner folds).
 * Later runs after the mandatory first fold use a felt-aware run length.
 * Long height-bound chains may search past RUN_CEILING when that raises
 * the uniform fit scale.
 */
function growArm(
  tiles,
  from,
  to,
  step,
  start,
  startDir,
  foldDir,
  size,
  gap,
  soft,
  out,
  branch,
  bridgeTarget,
  hard = soft,
  /** Unscaled (or floor-scale) size used only for run-length topology. */
  packSize = null,
  /**
   * Prefer shorter later rails so the snake fills vertical room instead of
   * one/two wide center rows. When set, overrides the default targetRun.
   */
  targetRunOverride = null,
  force = false,
  leoLayout = false,
  firstRunOverride = null,
  exitOutward = false
) {
  void packSize;
  const verticalMain = americanVerticalMain();
  const isMain = (d) => isMainAxisDir(d, verticalMain);
  const isCross = (d) => !isMain(d);
  let prev = start;
  let dir = startDir;
  let lastMain = isMain(startDir) ? startDir : verticalMain ? "N" : "E";
  let vertRun = 0;
  let exitAfterPivot = false;
  let run = 0;
  let firstFoldDone = false;
  const minFirstRun = leoLayout
    ? Math.max(
        1,
        Math.min(
          28,
          Number.isFinite(firstRunOverride) && firstRunOverride != null
            ? Math.floor(firstRunOverride)
            : LEO_MAIN_STRAIGHT
        )
      )
    : Number.POSITIVE_INFINITY;
  const laterRun = Math.max(
    2,
    targetRunOverride != null ? targetRunOverride : RUN_CEILING
  );

  for (let i = from; i !== to; i += step) {
    const tile = tiles[i];
    const occupied = [...out.values()];
    const onCross = isCross(dir);
    const tileIsDouble = isDouble(tile);

    const attempt = (d) =>
      tryPlace(prev, tile, d, dir, size, gap, soft, occupied, hard);
    const attemptFirstFold = (d) =>
      attempt(d) ||
      tryPlace(
        prev,
        tile,
        d,
        dir,
        size,
        gap,
        expandSoft(soft, size, 1, hard),
        occupied,
        hard
      );
    const forcePlace = (d) => {
      if (!isLegalStep(prev, tile, d, size)) return null;
      const cand = placeAgainst(prev, tile, d, size, gap, dir);
      cand.isCorner = d !== dir;
      cand.isBridge = isCross(d);
      return findCollision(cand, occupied, gap, prev.id) ? null : cand;
    };

    let wantTurn = exitAfterPivot;
    const mandatoryStraight =
      !onCross && !firstFoldDone && run < minFirstRun;
    if (!wantTurn) {
      const straight = attempt(dir);
      if (mandatoryStraight) {
        if (!straight && !force) return false;
      } else if (!straight) {
        wantTurn = true;
      } else if (onCross && vertRun >= Math.max(1, bridgeTarget)) {
        const exitDirs = exitOutward
          ? [lastMain, OPP[lastMain], foldDir, OPP[foldDir]]
          : [OPP[lastMain], lastMain, foldDir, OPP[foldDir]];
        if (exitDirs.some((d) => attempt(d))) {
          wantTurn = true;
        }
      } else if (!onCross && !firstFoldDone && leoLayout && run >= minFirstRun) {
        wantTurn = true;
      } else if (!onCross && firstFoldDone) {
        const nearLimit = run >= laterRun - 1;
        const effectiveMaxRun =
          nearLimit && hasDoubleAhead(tiles, i, step, DOUBLE_LOOKAHEAD)
            ? laterRun + DOUBLE_LOOKAHEAD
            : laterRun;
        if (run >= effectiveMaxRun) {
          const turnDirs = [foldDir, OPP[foldDir], OPP[lastMain], lastMain];
          const canTurn = turnDirs.some(
            (d) =>
              attempt(d) ||
              tryPlace(
                prev,
                tile,
                d,
                dir,
                size,
                gap,
                expandSoft(soft, size, 1, hard),
                occupied,
                hard
              )
          );
          if (canTurn) wantTurn = true;
        }
      }
    }

    if (wantTurn && onCross && tileIsDouble && attempt(dir)) {
      wantTurn = false;
      exitAfterPivot = true;
    }

    let chosen = null;
    let chosenDir = dir;
    const lockingFirstFold =
      leoLayout && !firstFoldDone && !onCross && wantTurn;

    if (mandatoryStraight) {
      chosen = attempt(dir) || (force ? forcePlace(dir) : null);
      if (!chosen) return false;
      chosenDir = dir;
    } else if (lockingFirstFold) {
      chosen = attemptFirstFold(foldDir) || (force ? forcePlace(foldDir) : null);
      if (!chosen) return false;
      chosenDir = foldDir;
    } else if (onCross && vertRun > 0 && vertRun < Math.max(1, bridgeTarget)) {
      chosen =
        attempt(dir) ||
        tryPlace(
          prev,
          tile,
          dir,
          dir,
          size,
          gap,
          expandSoft(soft, size, bridgeTarget, hard),
          occupied,
          hard
        );
      if (chosen) chosenDir = dir;
    } else if (!wantTurn) {
      chosen = attempt(dir);
      chosenDir = dir;
    }

    if (!chosen && !lockingFirstFold) {
      // First main-chain tiles after the spinner stay on the main rail
      // (E/W Classic, N/S American). Spinner arms are never a main fallback.
      const lockMainAxis = leoLayout && !firstFoldDone && !onCross;
      const verticalExits = exitOutward
        ? [lastMain, OPP[lastMain], foldDir, OPP[foldDir], dir]
        : [OPP[lastMain], lastMain, foldDir, OPP[foldDir], dir];
      const primary = lockMainAxis
        ? [dir]
        : onCross
          ? verticalExits
          : [foldDir, OPP[foldDir], OPP[lastMain], lastMain, dir];
      const seen = new Set();
      for (const d of primary) {
        if (seen.has(d)) continue;
        seen.add(d);
        const box = attempt(d);
        if (box) {
          chosen = box;
          chosenDir = d;
          break;
        }
      }
      if (!chosen && !lockMainAxis) {
        for (const d of ["E", "W", "N", "S"]) {
          if (seen.has(d)) continue;
          const box = attempt(d);
          if (box) {
            chosen = box;
            chosenDir = d;
            break;
          }
        }
      }
    }

    if (!chosen && wantTurn && !lockingFirstFold) {
      chosen = attempt(dir);
      if (chosen) chosenDir = dir;
    }

    if (!chosen && force) {
      const open = [...out.values()];
      const lockMainAxis = leoLayout && !firstFoldDone && !onCross;
      const order = lockingFirstFold
        ? [foldDir]
        : lockMainAxis
          ? [dir]
          : exitOutward
            ? [dir, lastMain, OPP[lastMain], foldDir, OPP[foldDir], "E", "W", "N", "S"]
            : [dir, foldDir, OPP[foldDir], OPP[dir], "E", "W", "N", "S"];
      for (const d of order) {
        if (!isLegalStep(prev, tile, d, size)) continue;
        const box = placeAgainst(prev, tile, d, size, gap, dir);
        box.isCorner = d !== dir;
        box.isBridge = isCross(d);
        if (!findCollision(box, open, gap, prev.id)) {
          chosen = box;
          chosenDir = d;
          break;
        }
      }
    }

    if (!chosen) return false;
    if (findCollision(chosen, occupied, gap, prev.id)) return false;

    if (isMain(chosenDir)) {
      lastMain = chosenDir;
      run = chosenDir === dir && !onCross ? run + 1 : 1;
      vertRun = 0;
      if (exitAfterPivot) exitAfterPivot = false;
    } else {
      if (!firstFoldDone && isMain(dir)) {
        firstFoldDone = true;
      }
      run = 0;
      vertRun = chosenDir === dir && onCross ? vertRun + 1 : 1;
      if (!tileIsDouble) exitAfterPivot = false;
    }

    const turned = chosenDir !== dir;
    dir = chosenDir;
    const placed = {
      ...chosen,
      travelDir: chosenDir,
      branch: publicLayoutBranch(branch) ?? branch,
      isCorner: turned,
      isBridge: isCross(chosenDir),
    };
    out.set(tile.id, placed);
    prev = placed;
  }

  return true;
}

function bboxOf(items) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of items) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  return { minX, minY, maxX, maxY };
}

/** Playable felt minus inner padding (margin from the gold/table border). */
export function computeSafeFeltBounds(play, inset = SAFE_FELT_INSET) {
  const pad = Math.max(0, Number(inset) || 0);
  const width = play.maxX - play.minX;
  const height = play.maxY - play.minY;
  const padX = Math.min(pad, Math.max(0, (width - 48) / 2));
  const padY = Math.min(pad, Math.max(0, (height - 48) / 2));
  return {
    minX: play.minX + padX,
    maxX: play.maxX - padX,
    minY: play.minY + padY,
    maxY: play.maxY - padY,
  };
}

/** AABB of rotated tile footprints (not centers). */
export function computeChainBounds(placements) {
  if (!placements?.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  const bb = bboxOf(placements);
  return {
    ...bb,
    width: Math.max(0, bb.maxX - bb.minX),
    height: Math.max(0, bb.maxY - bb.minY),
    cx: (bb.minX + bb.maxX) / 2,
    cy: (bb.minY + bb.maxY) / 2,
  };
}

/**
 * Uniform board scale. Never upscales past preferred. Only shrinks when the
 * complete chain AABB no longer fits in the safe felt.
 */
export function computeFitScale(chainBounds, safeBounds, preferredScale = 1) {
  const chainW = Math.max(1, chainBounds.width ?? chainBounds.maxX - chainBounds.minX);
  const chainH = Math.max(1, chainBounds.height ?? chainBounds.maxY - chainBounds.minY);
  const safeW = Math.max(1, safeBounds.maxX - safeBounds.minX);
  const safeH = Math.max(1, safeBounds.maxY - safeBounds.minY);
  const preferred = Math.max(
    EMERGENCY_MIN_SCALE,
    Number.isFinite(preferredScale) ? preferredScale : 1
  );
  return Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(preferred, safeW / chainW, safeH / chainH)
  );
}

/**
 * Uniform scale that keeps the layout anchor at the felt mid-point.
 * Each side of the chain must fit in the matching half of the safe felt.
 */
export function computeAnchorFitScale(
  chainBounds,
  safeBounds,
  preferredScale,
  anchorX,
  anchorY
) {
  const preferred = Math.max(
    EMERGENCY_MIN_SCALE,
    Number.isFinite(preferredScale) ? preferredScale : 1
  );
  const pad = 0.5;
  const midX = (safeBounds.minX + safeBounds.maxX) / 2;
  const midY = (safeBounds.minY + safeBounds.maxY) / 2;
  const roomL = Math.max(1, midX - safeBounds.minX - pad);
  const roomR = Math.max(1, safeBounds.maxX - midX - pad);
  const roomT = Math.max(1, midY - safeBounds.minY - pad);
  const roomB = Math.max(1, safeBounds.maxY - midY - pad);
  const leftExtent = Math.max(0, anchorX - chainBounds.minX);
  const rightExtent = Math.max(0, chainBounds.maxX - anchorX);
  const topExtent = Math.max(0, anchorY - chainBounds.minY);
  const botExtent = Math.max(0, chainBounds.maxY - anchorY);
  let scale = preferred;
  if (leftExtent > 0) scale = Math.min(scale, roomL / leftExtent);
  if (rightExtent > 0) scale = Math.min(scale, roomR / rightExtent);
  if (topExtent > 0) scale = Math.min(scale, roomT / topExtent);
  if (botExtent > 0) scale = Math.min(scale, roomB / botExtent);
  return Math.max(EMERGENCY_MIN_SCALE, scale);
}

function spinnerLaneOccupants(spinner, northCount, southCount, size, gap) {
  if (!spinner || (northCount <= 0 && southCount <= 0)) return [];
  const short = Math.min(size.w, size.h);
  const long = Math.max(size.w, size.h);
  const out = [];
  if (americanVerticalMain()) {
    const y = spinner.y + (spinner.h - short) / 2;
    for (let i = 0; i < northCount; i += 1) {
      out.push({
        id: `${RESERVE_PREFIX}n-${i}`,
        x: spinner.x - (i + 1) * (long + gap),
        y,
        w: long,
        h: short,
        double: false,
        isBridge: false,
        branch: BRANCH.SPINNER_TOP,
      });
    }
    for (let i = 0; i < southCount; i += 1) {
      out.push({
        id: `${RESERVE_PREFIX}s-${i}`,
        x: spinner.x + spinner.w + gap + i * (long + gap),
        y,
        w: long,
        h: short,
        double: false,
        isBridge: false,
        branch: BRANCH.SPINNER_BOTTOM,
      });
    }
    return out;
  }
  const x = spinner.x + (spinner.w - short) / 2;
  for (let i = 0; i < northCount; i += 1) {
    out.push({
      id: `${RESERVE_PREFIX}n-${i}`,
      x,
      y: spinner.y - (i + 1) * (long + gap),
      w: short,
      h: long,
      double: false,
      isBridge: true,
      branch: BRANCH.SPINNER_TOP,
    });
  }
  for (let i = 0; i < southCount; i += 1) {
    out.push({
      id: `${RESERVE_PREFIX}s-${i}`,
      x,
      y: spinner.y + spinner.h + gap + i * (long + gap),
      w: short,
      h: long,
      double: false,
      isBridge: true,
      branch: BRANCH.SPINNER_BOTTOM,
    });
  }
  return out;
}

function growSpinnerArm(
  map,
  spinner,
  tiles,
  startDir,
  size,
  gap,
  hard,
  force,
  minStraight = SPINNER_ARM_STRAIGHT,
  armRun = 0
) {
  const branch = startDir === "N" || startDir === "W" ? BRANCH.SPINNER_TOP : BRANCH.SPINNER_BOTTOM;
  const foldDir = spinnerArmFoldDir(startDir);
  const awayDir = startDir;
  const wrapRun = Number.isFinite(armRun) && armRun >= 2 ? Math.floor(armRun) : 0;
  const wrapBridge = wrapRun ? 1 : 0;
  let prev = spinner;
  let dir = startDir;
  let lastH = foldDir;
  let placedCount = 0;
  let horizRun = 0;
  let vertWrapRun = 0;
  let exitAfterWrap = false;
  let priorRail = null;
  for (const tile of tiles) {
    if (map.has(tile.id) && placedCount > 0) {
      prev = map.get(tile.id);
      dir = prev.travelDir || dir;
      if (dir === "E" || dir === "W") {
        lastH = dir;
        horizRun += 1;
      } else {
        horizRun = 0;
      }
      placedCount += 1;
      continue;
    }
    const occupied = [...map.values()].filter((p) => p.id !== tile.id);
    const collide = (cand) =>
      wrapRun && placedCount > minStraight
        ? findWrapCollision(cand, occupied, gap, prev.id)
        : findCollision(cand, occupied, gap, prev.id);
    const attempt = (d) => {
      if (!isLegalStep(prev, tile, d, size)) return null;
      const box = placeAgainst(prev, tile, d, size, gap, dir);
      const turning = Boolean(dir && dir !== d);
      box.isCorner = turning;
      box.isBridge = d === "N" || d === "S";
      if (!fitsSoft(box, hard)) return null;
      if (collide(box)) return null;
      return box;
    };
    const forcePlace = (d) => {
      const cand = routedBox(prev, tile, d, dir, size, gap);
      if (collide(cand) && !force) return null;
      return cand;
    };

    let chosen = null;
    let chosenDir = dir;
    const take = (d, required) => {
      chosen = attempt(d) || (force || required ? forcePlace(d) : null);
      chosenDir = d;
      return Boolean(chosen);
    };

    if (placedCount < minStraight) {
      if (!take(startDir, true)) return false;
    } else if (placedCount === minStraight) {
      if (!take(foldDir, true)) return false;
    } else if (exitAfterWrap) {
      const reverse = OPP[lastH] || OPP[foldDir];
      const wrapRail = (d) => {
        const cand = placeSpinnerWrapRail(
          prev,
          tile,
          d,
          size,
          gap,
          dir,
          awayDir,
          priorRail
        );
        if (!cand) return null;
        if (hard && !fitsSoft(cand, hard)) return null;
        if (collide(cand)) return null;
        return cand;
      };
      chosen = wrapRail(reverse);
      chosenDir = reverse;
      if (!chosen && !take(reverse, false) && !take(foldDir, false) && !take(dir, false)) {
        return false;
      }
    } else if (wrapRun && (vertWrapRun > 0 && vertWrapRun < wrapBridge)) {
      if (!take(awayDir, true)) return false;
    } else if (
      wrapRun &&
      horizRun >= wrapRun &&
      tiles.length - placedCount >= wrapBridge + 1
    ) {
      if (!take(awayDir, false)) {
        const order = [dir, foldDir, OPP[foldDir], OPP[dir], "E", "W", "N", "S"];
        const seen = new Set();
        for (const d of order) {
          if (seen.has(d)) continue;
          seen.add(d);
          if (take(d, false)) break;
        }
        if (!chosen && force) take(dir, true);
        if (!chosen) return false;
      }
    } else {
      const order = [dir, foldDir, OPP[foldDir], OPP[dir], "E", "W", "N", "S"];
      const seen = new Set();
      for (const d of order) {
        if (seen.has(d)) continue;
        seen.add(d);
        if (take(d, false)) break;
      }
      if (!chosen && force) take(dir, true);
      if (!chosen) return false;
    }

    const placed = {
      ...chosen,
      travelDir: chosenDir,
      branch,
      isCorner: chosenDir !== dir,
      isBridge: chosenDir === "N" || chosenDir === "S",
    };
    map.set(tile.id, placed);
    if (chosenDir === "E" || chosenDir === "W") {
      lastH = chosenDir;
      horizRun = chosenDir === dir && (dir === "E" || dir === "W") ? horizRun + 1 : 1;
      vertWrapRun = 0;
      exitAfterWrap = false;
      priorRail = placed;
    } else {
      horizRun = 0;
      if (wrapRun && chosenDir === awayDir && placedCount >= minStraight) {
        vertWrapRun += 1;
        exitAfterWrap = vertWrapRun >= wrapBridge;
      } else {
        vertWrapRun = 0;
        exitAfterWrap = false;
      }
    }
    prev = placed;
    dir = chosenDir;
    placedCount += 1;
  }
  return true;
}

function attachSpinnerBranches(
  map,
  spinnerId,
  northTiles,
  southTiles,
  size,
  gap,
  hard,
  force,
  minStraight = SPINNER_ARM_STRAIGHT,
  armRun = 0
) {
  if (!spinnerId) return { ok: true, armIds: [] };
  const north = Array.isArray(northTiles) ? northTiles : [];
  const south = Array.isArray(southTiles) ? southTiles : [];
  if (!north.length && !south.length) return { ok: true, armIds: [] };
  const spinner = map.get(spinnerId);
  if (!spinner) return { ok: false, armIds: [] };
  const arms = spinnerArmStartDirs();
  for (const tile of north) map.delete(tile.id);
  for (const tile of south) map.delete(tile.id);
  const northOk =
    !north.length ||
    growSpinnerArm(map, spinner, north, arms.top, size, gap, hard, force, minStraight, armRun);
  const southOk =
    !south.length ||
    growSpinnerArm(map, spinner, south, arms.bottom, size, gap, hard, force, minStraight, armRun);
  const armIds = [...north, ...south].map((t) => t.id).filter((id) => map.has(id));
  return {
    ok: Boolean(northOk && southOk && armIds.length === north.length + south.length),
    armIds,
  };
}

function completeMissingSpinnerArms(
  map,
  topology,
  size,
  gap,
  minStraight = SPINNER_ARM_STRAIGHT,
  armRun = 0
) {
  if (!topology?.spinnerId) return;
  const spinner = map.get(topology.spinnerId);
  if (!spinner) return;
  const north = topology.branches?.[BRANCH.SPINNER_TOP] || [];
  const south = topology.branches?.[BRANCH.SPINNER_BOTTOM] || [];
  attachSpinnerBranches(
    map,
    topology.spinnerId,
    north,
    south,
    size,
    gap,
    { minX: -1e5, maxX: 1e5, minY: -1e5, maxY: 1e5 },
    true,
    minStraight,
    armRun
  );
}

function completeMissingTiles(map, tiles, centerIndex, size, gap, opts = {}) {
  const opener = tiles[centerIndex];
  if (!opener) return;
  const linear = Boolean(opts.linear);
  const topology = opts.topology || null;
  if (!map.has(opener.id)) {
    const rails = mainRailDirs();
    const fp = footprintForTravel(opener, rails.right, size);
    map.set(opener.id, {
      id: opener.id,
      x: snap(-fp.w / 2),
      y: snap(-fp.h / 2),
      w: snap(fp.w),
      h: snap(fp.h),
      orientation: fp.orientation,
      rotation: fp.rotation,
      double: isDouble(opener),
      valueLeft: Number(opener.left),
      valueRight: Number(opener.right),
      branch: linear
        ? topology?.membership?.[opener.id] ?? BRANCH.MAIN_RIGHT
        : SPINNER_NODE,
      travelDir: rails.right,
    });
  }
  const rails = mainRailDirs();
  const fill = (from, to, step, startDir, branch) => {
    let prev = map.get(tiles[centerIndex].id);
    let dir = startDir;
    let straight = 0;
    const foldDir = branch === "right" || branch === BRANCH.MAIN_RIGHT
      ? opts.foldRight || rails.foldRight
      : opts.foldLeft || rails.foldLeft;
    for (let i = from; i !== to; i += step) {
      const tile = tiles[i];
      if (map.has(tile.id)) {
        prev = map.get(tile.id);
        dir = prev.travelDir || dir;
        if (dir === startDir) straight += 1;
        continue;
      }
      const occupied = [...map.values()];
      const firstRunCap = Math.max(
        1,
        Math.min(
          28,
          resolveFirstRunOverride(
            opts.firstRun,
            branch === "right" || branch === BRANCH.MAIN_RIGHT ? "right" : "left"
          ) ?? LEO_MAIN_STRAIGHT
        )
      );
      const allowed = linear
        ? americanVerticalMain()
          ? ["N", "S"]
          : ["E", "W"]
        : straight < firstRunCap
          ? [startDir]
          : [foldDir, startDir];
      let box = null;
      let chosenDir = allowed[0];
      for (const d of allowed) {
        if (!isLegalStep(prev, tile, d, size)) continue;
        const cand = placeAgainst(prev, tile, d, size, gap, dir);
        if (!findCollision(cand, occupied, gap, prev.id)) {
          box = cand;
          chosenDir = d;
          break;
        }
      }
      if (!box) {
        box = placeAgainst(prev, tile, allowed[0], size, gap, dir);
        chosenDir = allowed[0];
      }
      const placed = {
        ...box,
        travelDir: chosenDir,
        branch: topology?.membership?.[tile.id] ?? publicLayoutBranch(branch) ?? branch,
        isCorner: chosenDir !== dir,
        isBridge: !isMainAxisDir(chosenDir),
      };
      map.set(tile.id, placed);
      prev = placed;
      dir = chosenDir;
      straight = chosenDir === startDir ? straight + 1 : 0;
    }
  };
  fill(
    centerIndex + 1,
    tiles.length,
    1,
    rails.right,
    BRANCH.MAIN_RIGHT
  );
  fill(
    centerIndex - 1,
    -1,
    -1,
    rails.left,
    BRANCH.MAIN_LEFT
  );
  applyTopologyBranches(map, topology);
  if (!linear) {
    completeMissingSpinnerArms(
      map,
      topology,
      size,
      gap,
      opts.armStraight ?? SPINNER_ARM_STRAIGHT,
      opts.armRun ?? 0
    );
  }
}

/** Essential-only box: doubles keep their spinner halo; corner/bridge reserve
 * is dropped. Used as a graceful-degradation fallback at emergency-tiny
 * scales, where the full reserve set would make an already-tight chain
 * geometrically unplaceable. */
function essentialCollisionBox(p) {
  return collisionBox({ ...p, isCorner: false, isBridge: false });
}

function chainCollisionFree(placements, gap, tiles, minClear) {
  const required = minClear ?? layoutPolicy().runClear;
  const attach = new Map();
  if (tiles) {
    for (let i = 0; i < tiles.length - 1; i += 1) {
      const a = tiles[i].id;
      const b = tiles[i + 1].id;
      if (!attach.has(a)) attach.set(a, new Set());
      if (!attach.has(b)) attach.set(b, new Set());
      attach.get(a).add(b);
      attach.get(b).add(a);
    }
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const linked = attach.get(a.id)?.has(b.id);
      if (findCollision(a, [b], gap, linked ? b.id : null, required)) return false;
    }
  }
  return true;
}

function applyTopologyBranches(map, topology) {
  if (!map || !topology?.membership) return map;
  for (const [id, pos] of map) {
    const membership = topology.membership[id];
    if (!membership) continue;
    pos.branch = membership;
  }
  return map;
}

/**
 * Pre-spinner pack: board[0] … board[n] as one rail.
 * Classic/Haitian stay E–W. American grows N (vertical main chain).
 * A non-double is never given spinner/double orientation just because it
 * is the visual center of the felt. Branch comes from topology, not from
 * travel/rotation.
 */
function placeLinearMainChain(tiles, size, gap, topology = null) {
  const map = new Map();
  if (!tiles.length) return map;
  const first = tiles[0];
  const dir = americanVerticalMain() ? "N" : "E";
  const fp = footprintForTravel(first, dir, size);
  const firstBranch = topology?.membership?.[first.id] ?? BRANCH.MAIN_RIGHT;
  let prev = {
    id: first.id,
    x: snap(-fp.w / 2),
    y: snap(-fp.h / 2),
    w: snap(fp.w),
    h: snap(fp.h),
    orientation: fp.orientation,
    rotation: fp.rotation,
    double: isDouble(first),
    valueLeft: Number(first.left),
    valueRight: Number(first.right),
    branch: firstBranch,
    travelDir: dir,
  };
  map.set(first.id, prev);
  for (let i = 1; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const box = placeAgainst(prev, tile, dir, size, gap, dir);
    prev = {
      ...box,
      travelDir: dir,
      branch: topology?.membership?.[tile.id] ?? BRANCH.MAIN_RIGHT,
      orientation: box.orientation,
      rotation: box.rotation,
      isCorner: false,
      isBridge: false,
    };
    map.set(tile.id, prev);
  }
  applyTopologyBranches(map, topology);
  return map;
}

function placeGraph(
  tiles,
  centerIndex,
  size,
  gap,
  soft,
  bridgeTarget,
  foldRight,
  foldLeft,
  swapArms,
  hard = soft,
  packSize = null,
  targetRunOverride = null,
  extraOccupied = [],
  force = false,
  spinnerLayout = false,
  firstRunOverride = null,
  exitOutward = false
) {
  const opener = tiles[centerIndex];
  const rails = mainRailDirs();
  const fp = footprintForTravel(opener, rails.right, size);
  const origin = {
    id: opener.id,
    x: snap(-fp.w / 2),
    y: snap(-fp.h / 2),
    w: snap(fp.w),
    h: snap(fp.h),
    orientation: fp.orientation,
    rotation: fp.rotation,
    double: isDouble(opener),
    valueLeft: Number(opener.left),
    valueRight: Number(opener.right),
    branch: spinnerLayout ? SPINNER_NODE : BRANCH.MAIN_RIGHT,
    travelDir: rails.right,
  };
  const foldR = americanVerticalMain() ? rails.foldRight : foldRight;
  const foldL = americanVerticalMain() ? rails.foldLeft : foldLeft;
  // Opener itself must sit inside the hard playable table.
  if (!fitsSoft(origin, hard)) {
    return { map: new Map(), ok: false };
  }

  const bridgeLens = [Math.max(1, bridgeTarget)];
  for (const bridgeLen of bridgeLens) {
    const map = new Map([[opener.id, origin]]);
    for (const extra of extraOccupied) {
      if (extra?.id) map.set(extra.id, extra);
    }
    const growRight = () =>
      growArm(
        tiles,
        centerIndex + 1,
        tiles.length,
        1,
        origin,
        rails.right,
        foldR,
        size,
        gap,
        soft,
        map,
        BRANCH.MAIN_RIGHT,
        bridgeLen,
        hard,
        packSize,
        targetRunOverride,
        force,
        spinnerLayout,
        resolveFirstRunOverride(firstRunOverride, "right"),
        exitOutward
      );
    const growLeft = () =>
      growArm(
        tiles,
        centerIndex - 1,
        -1,
        -1,
        origin,
        rails.left,
        foldL,
        size,
        gap,
        soft,
        map,
        BRANCH.MAIN_LEFT,
        bridgeLen,
        hard,
        packSize,
        targetRunOverride,
        force,
        spinnerLayout,
        resolveFirstRunOverride(firstRunOverride, "left"),
        exitOutward
      );

    const first = swapArms ? growLeft() : growRight();
    if (!first) continue;
    const second = swapArms ? growRight() : growLeft();
    if (!second) continue;

    for (const id of [...map.keys()]) {
      if (isReserveId(id)) map.delete(id);
    }

    const list = [...map.values()];
    const insideHard = force || list.every((p) => fitsSoft(p, hard));
    if (
      map.size === tiles.length &&
      chainCollisionFree(list, gap, tiles) &&
      insideHard
    ) {
      return { map, ok: true };
    }
  }
  return { map: new Map([[opener.id, origin]]), ok: false };
}

/**
 * Map logical layout → screen: keep preferred size, translate the complete
 * AABB into the exclusive playable felt, then apply one uniform auto-fit
 * scale only if the packed bounding box still cannot fit.
 */
function toScreen(
  placements,
  viewport,
  padding = PADDING,
  openerId = null,
  margin = MARGIN,
  hudRight = null,
  focusTileId = null,
  hudLeft = null,
  maxScale = 1,
  hudBottom = 0
) {
  void padding;
  void focusTileId;
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const play = computePlayBounds(
    { width, height },
    margin,
    hudRight,
    hudLeft,
    hudBottom
  );
  const safe = computeSafeFeltBounds(play);
  const midX = (safe.minX + safe.maxX) / 2;
  const midY = (safe.minY + safe.maxY) / 2;
  const preferred = Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(1, Number.isFinite(maxScale) ? maxScale : 1)
  );

  const visible = placements.filter((p) => p && !isReserveId(p.id));

  if (!visible.length) {
    return {
      tiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: midX, y: midY },
      camera: {
        recentered: false,
        overflow: false,
        focusMode: "empty",
        x: midX,
        y: midY,
      },
      play,
      safe,
    };
  }

  const chain = computeChainBounds(visible);
  const anchor = openerId ? visible.find((p) => p.id === openerId) : null;
  const ax = anchor ? anchor.x + anchor.w / 2 : chain.cx;
  const ay = anchor ? anchor.y + anchor.h / 2 : chain.cy;
  // AABB fit (not half-extent-from-spinner). Translation uses unused felt
  // above a south branch before any shrink.
  let scale = computeFitScale(chain, safe, preferred);

  const project = (s) => {
    const sW = chain.width * s;
    const sH = chain.height * s;
    const safeW = Math.max(1, safe.maxX - safe.minX);
    const safeH = Math.max(1, safe.maxY - safe.minY);
    const ox = safe.minX + (safeW - sW) / 2;
    const oy = safe.minY + (safeH - sH) / 2;
    return visible.map((p, zIndex) => {
      const w = p.w * s;
      const h = p.h * s;
      const x = (p.x - chain.minX) * s + ox;
      const y = (p.y - chain.minY) * s + oy;
      return {
        tileId: p.id,
        valueLeft: p.valueLeft,
        valueRight: p.valueRight,
        x,
        y,
        w,
        h,
        rotation: p.rotation,
        orientation: p.orientation,
        zIndex,
        travelDir: p.travelDir,
        branch: publicLayoutBranch(p.branch) ?? p.branch,
        double: p.double,
        isCorner: p.isCorner,
        isBridge: p.isBridge,
      };
    });
  };

  let tiles = project(scale);
  let guard = 0;
  while (
    !screenTilesInsidePlay(tiles, safe, 0.5) &&
    scale > EMERGENCY_MIN_SCALE &&
    guard < 28
  ) {
    scale = Math.max(EMERGENCY_MIN_SCALE, scale * 0.96);
    tiles = project(scale);
    guard += 1;
  }
  const overflow = !screenTilesInsidePlay(tiles, safe, 0.75);

  return {
    tiles,
    scale,
    content: {
      width: chain.width,
      height: chain.height,
      minX: chain.minX,
      maxX: chain.maxX,
      minY: chain.minY,
      maxY: chain.maxY,
      cx: ax,
      cy: ay,
    },
    origin: { x: midX, y: midY },
    camera: {
      recentered: true,
      overflow,
      focusMode: "bbox",
      x: midX,
      y: midY,
      localFocus: { x: ax, y: ay },
    },
    play,
    safe,
  };
}

/**
 * Primary API — spatial layout for the full board chain.
 *
 * @param {BoardTile[]} boardGraph
 * @param {Viewport} viewportDimensions
 * @param {object} [options]
 * @returns {{
 *   tiles: Array<{tileId,valueLeft,valueRight,x,y,w,h,rotation,orientation,zIndex}>,
 *   scale: number,
 *   content: object,
 *   origin: {x:number,y:number},
 *   gap: number,
 * }}
 */
export function calculateBoardLayout(boardGraph, viewportDimensions, options = {}) {
  const tiles = Array.isArray(boardGraph) ? boardGraph : [];
  const width = Math.max(120, viewportDimensions?.width ?? 640);
  const height = Math.max(120, viewportDimensions?.height ?? 320);

  const marginEarly = options.margin ?? MARGIN;
  const hudRightEarly = options.hudRight ?? null;
  const hudLeftEarly = options.hudLeft ?? null;
  const hudBottomEarly = Number(options.hudBottom) || 0;
  const playEarly = computePlayBounds(
    { width, height },
    marginEarly,
    hudRightEarly,
    hudLeftEarly,
    hudBottomEarly
  );
  const midEarly = playMid(playEarly);

  if (!tiles.length) {
    return {
      tiles: [],
      armTiles: [],
      scale: 1,
      content: { width: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 },
      origin: { x: midEarly.x, y: midEarly.y },
      gap: CHAIN_GAP,
    };
  }

  const spinnerId =
    typeof options.spinnerId === "string" && options.spinnerId
      ? options.spinnerId
      : null;
  const topology =
    options.topology ||
    buildBoardTopology({
      board: tiles,
      spinnerId,
      spinnerNorth: options.spinnerNorth,
      spinnerSouth: options.spinnerSouth,
    });
  assertBoardTopology(topology);

  // Spinner arms are enabled only by the first-double id from game state.
  // American still packs the main chain vertically before that spinner exists.
  // Classic / Haitian stay E–W until a spinnerId is present.
  let centerIndex =
    options.centerIndex != null
      ? options.centerIndex
      : tiles.findIndex((t) => t.id === (topology.spinnerId || options.centerTileId));
  if (centerIndex < 0 || centerIndex >= tiles.length) centerIndex = 0;

  let spinnerIndex = -1;
  if (topology.spinnerId) {
    const spinIdx = tiles.findIndex((t) => t.id === topology.spinnerId);
    if (spinIdx >= 0) spinnerIndex = spinIdx;
  }
  const leoLayout = spinnerIndex >= 0;
  if (leoLayout) centerIndex = spinnerIndex;
  const layoutSpinnerId = leoLayout ? tiles[centerIndex].id : null;

  const baseW = Math.max(1, options.tileWidth ?? options.tileSize?.w ?? 40);
  const baseH = Math.max(1, options.tileHeight ?? options.tileSize?.h ?? baseW * TILE_ASPECT);
  const margin = marginEarly;
  const requestedGap = options.gap ?? CHAIN_GAP;
  // Optional, measured-live reserve for HUD chrome: scoreboard (left) and
  // reserve counter (right). Falls back to the built-in right estimate in
  // computePlayBounds when not supplied, so existing callers/tests are
  // unaffected.
  const hudRight = hudRightEarly;
  const hudLeft = hudLeftEarly;
  const hudBottom = hudBottomEarly;

  const size = { w: baseW, h: baseH };
  const gap = effectiveGap(size.w, size.h, requestedGap);
  const prevLayoutPolicy = activeLayoutPolicy;
  activeLayoutPolicy = createBoardLayoutPolicy(
    { ...options, spinnerId: layoutSpinnerId },
    size,
    gap
  );
  try {
  const scaleCap = Math.max(
    EMERGENCY_MIN_SCALE,
    Math.min(1, options.maxScale != null ? Number(options.maxScale) : 1)
  );

  const northTiles = leoLayout
    ? topology.branches[BRANCH.SPINNER_TOP]
    : [];
  const southTiles = leoLayout
    ? topology.branches[BRANCH.SPINNER_BOTTOM]
    : [];
  const northCount = Math.max(
    northTiles.length,
    leoLayout ? Number(options.spinnerNorthCount) || 0 : 0
  );
  const southCount = Math.max(
    southTiles.length,
    leoLayout ? Number(options.spinnerSouthCount) || 0 : 0
  );

  if (!leoLayout) {
    const map = placeLinearMainChain(tiles, size, gap, topology);
    completeMissingTiles(map, tiles, 0, size, gap, { linear: true, topology });
    fillMissingPlayedTiles(
      map,
      tiles,
      size,
      gap,
      americanVerticalMain() ? "N" : "E",
      (tile) => topology?.membership?.[tile.id]
    );
    applyTopologyBranches(map, topology);
    const mainList = tiles.map((t) => map.get(t.id)).filter(Boolean);
    const screen = toScreen(
      mainList,
      { width, height },
      options.padding ?? PADDING,
      null,
      margin,
      hudRight,
      null,
      hudLeft,
      scaleCap,
      hudBottom
    );
    const byId = new Map(screen.tiles.map((t) => [t.tileId, t]));
    const orderedMain = tiles.map((t, i) =>
      takeScreenTile(byId, t, tiles[i - 1], screen.origin, size, screen.scale, topology)
    );
    const screenGap = Math.max(MIN_SAFE_GAP_PX, Math.min(2, gap * screen.scale));
    const linearLayout = {
      ...screen,
      tiles: orderedMain,
      armTiles: [],
      scale: screen.scale,
      gap: screenGap,
    };
    if (layoutDevDiagnosticsEnabled() && !isCompletePicked(linearLayout, tiles, [], [])) {
      console.error(
        formatLayoutIntegrityError(
          inspectBoardLayoutIntegrity(linearLayout, tiles, {
            failureReason: "linear-complete-fallback",
          })
        )
      );
    }
    return linearLayout;
  }

  const openerFp = footprintForTravel(tiles[centerIndex], "E", size);
  const originProbe = {
    id: tiles[centerIndex].id,
    x: snap(-openerFp.w / 2),
    y: snap(-openerFp.h / 2),
    w: snap(openerFp.w),
    h: snap(openerFp.h),
  };
  const usableW = Math.max(1, playEarly.maxX - playEarly.minX);
  const safeEarly = computeSafeFeltBounds(playEarly);
  const safeW = Math.max(1, safeEarly.maxX - safeEarly.minX);
  const safeH = Math.max(1, safeEarly.maxY - safeEarly.minY);
  const laterRunDefault = packRunLimit(usableW, size.h, gap, RUN_CEILING);
  const firstRunFloor = packFirstRunLimit(
    americanVerticalMain() ? safeH : safeW,
    size.h,
    size.w,
    gap
  );
  const leftLen = Math.max(0, centerIndex);
  const rightLen = Math.max(0, tiles.length - centerIndex - 1);
  const maxArm = Math.max(leftLen, rightLen);
  const playedCount = tiles.length + northTiles.length + southTiles.length;
  const armStraight = packSpinnerArmLimit(
    americanVerticalMain() ? safeW : safeH,
    size.h,
    size.w,
    gap
  );
  const extraOccupied = spinnerLaneOccupants(
    originProbe,
    Math.min(northCount, armStraight),
    Math.min(southCount, armStraight),
    size,
    gap
  );
  const packSize = { w: baseW, h: baseH };
  const UNBOUNDED = { minX: -1e5, maxX: 1e5, minY: -1e5, maxY: 1e5 };
  let activeArmRun = 0;
  let activeFoldRight = FIRST_FOLD_RIGHT;
  let activeFoldLeft = FIRST_FOLD_LEFT;
  let activeExitOutward = false;

  const projectPack = (map, force, packBounds = null) => {
    const armHard = packBounds || UNBOUNDED;
    const attached = attachSpinnerBranches(
      map,
      layoutSpinnerId,
      northTiles,
      southTiles,
      size,
      gap,
      armHard,
      force,
      armStraight,
      activeArmRun
    );
    if (!attached.ok && !force) return null;
    completeMissingTiles(map, tiles, centerIndex, size, gap, {
      topology,
      armStraight,
      armRun: activeArmRun,
    });
    if ((!attached.ok || attached.armIds.length < northTiles.length + southTiles.length) && force) {
      attachSpinnerBranches(
        map,
        layoutSpinnerId,
        northTiles,
        southTiles,
        size,
        gap,
        UNBOUNDED,
        true,
        armStraight,
        activeArmRun
      );
    }
    applyTopologyBranches(map, topology);
    completeMissingSpinnerArms(map, topology, size, gap, armStraight, activeArmRun);
    fillMissingPlayedTiles(
      map,
      tiles,
      size,
      gap,
      americanVerticalMain() ? "N" : "E",
      (tile) => topology?.membership?.[tile.id]
    );
    const expectedArms = northTiles.length + southTiles.length;
    const mainList = tiles.map((t) => map.get(t.id)).filter(Boolean);
    if (mainList.length !== tiles.length) return null;
    let armList = [...northTiles, ...southTiles]
      .map((t) => map.get(t.id))
      .filter(Boolean);
    if (armList.length !== expectedArms) {
      completeMissingSpinnerArms(map, topology, size, gap, armStraight, activeArmRun);
      fillMissingPlayedTiles(
        map,
        northTiles,
        size,
        gap,
        spinnerArmStartDirs().top,
        (tile) => topology?.membership?.[tile.id],
        map.get(layoutSpinnerId)
      );
      fillMissingPlayedTiles(
        map,
        southTiles,
        size,
        gap,
        spinnerArmStartDirs().bottom,
        (tile) => topology?.membership?.[tile.id],
        map.get(layoutSpinnerId)
      );
      armList = [...northTiles, ...southTiles]
        .map((t) => map.get(t.id))
        .filter(Boolean);
    }
    if (armList.length !== expectedArms) return null;
    const combined = [...mainList, ...armList].filter((p) => p && !isReserveId(p.id));
    const linkTiles = [...tiles];
    if (layoutSpinnerId && northTiles[0]) {
      linkTiles.push({ id: layoutSpinnerId }, northTiles[0]);
      for (let i = 0; i < northTiles.length - 1; i += 1) {
        linkTiles.push(northTiles[i], northTiles[i + 1]);
      }
    }
    if (layoutSpinnerId && southTiles[0]) {
      linkTiles.push({ id: layoutSpinnerId }, southTiles[0]);
      for (let i = 0; i < southTiles.length - 1; i += 1) {
        linkTiles.push(southTiles[i], southTiles[i + 1]);
      }
    }
    if (!chainCollisionFree(combined, gap, linkTiles) && !force) return null;

    const screen = toScreen(
      combined,
      { width, height },
      options.padding ?? PADDING,
      tiles[centerIndex].id,
      margin,
      hudRight,
      null,
      hudLeft,
      scaleCap,
      hudBottom
    );
    const byId = new Map(screen.tiles.map((t) => [t.tileId, t]));
    const orderedMain = tiles.map((t) => byId.get(t.id)).filter(Boolean);
    if (orderedMain.length !== tiles.length) return null;
    const orderedArms = [...northTiles, ...southTiles]
      .map((t) => byId.get(t.id))
      .filter(Boolean);
    if (orderedArms.length !== northTiles.length + southTiles.length) {
      return null;
    }
    let aabbClear = true;
    for (let i = 0; i < screen.tiles.length && aabbClear; i += 1) {
      for (let j = i + 1; j < screen.tiles.length; j += 1) {
        if (overlaps(screen.tiles[i], screen.tiles[j])) {
          aabbClear = false;
          break;
        }
      }
    }
    if (!aabbClear && !force) return null;
    const screenGap = Math.max(MIN_SAFE_GAP_PX, Math.min(2, gap * screen.scale));
    return {
      ...screen,
      tiles: orderedMain,
      armTiles: orderedArms,
      scale: screen.scale,
      gap: screenGap,
    };
  };

  const clonePlacementMap = (source) => {
    const next = new Map();
    for (const [id, p] of source) next.set(id, { ...p });
    return next;
  };

  const bridgeOptions = [...new Set([1, BRIDGE_LEN])];

  const tryPack = (force, firstRun, bridgeLen, laterRunLen) =>
    placeGraph(
      tiles,
      centerIndex,
      size,
      gap,
      UNBOUNDED,
      bridgeLen,
      activeFoldRight,
      activeFoldLeft,
      false,
      UNBOUNDED,
      packSize,
      laterRunLen,
      extraOccupied,
      force,
      leoLayout,
      firstRun,
      activeExitOutward
    );

  const pickPacked = (map, firstRun) => {
    completeMissingTiles(map, tiles, centerIndex, size, gap, {
      topology,
      firstRun,
      armStraight,
      armRun: activeArmRun,
      foldRight: activeFoldRight,
      foldLeft: activeFoldLeft,
    });
    applyTopologyBranches(map, topology);
    let picked = projectPack(clonePlacementMap(map), false, UNBOUNDED);
    if (!picked) {
      picked = projectPack(clonePlacementMap(map), true, UNBOUNDED);
    }
    return picked;
  };

  const scorePicked = (picked, firstRun, laterRunLen) => {
    const slack = packingFittedSlack(picked, safeW, safeH);
    const left = resolveFirstRunOverride(firstRun, "left");
    const right = resolveFirstRunOverride(firstRun, "right");
    const key = Number.isFinite(firstRun)
      ? Math.floor(firstRun)
      : Math.max(left || 1, right || 1);
    return {
      picked,
      scale: picked.scale,
      firstRun: key,
      firstRunLeft: left ?? key,
      firstRunRight: right ?? key,
      laterRun: laterRunLen,
      armRun: activeArmRun,
      foldRight: activeFoldRight,
      foldLeft: activeFoldLeft,
      exitOutward: activeExitOutward,
      turns: countTurns([...picked.tiles, ...(picked.armTiles || [])]),
      ...slack,
    };
  };

  const considerPacked = (packed, firstRun, laterRunLen, bridgeLen, target) => {
    if (!packed.ok && packed.map.size !== tiles.length) return target;
    const picked = pickPacked(packed.map, firstRun);
    if (!isCompletePicked(picked, tiles, northTiles, southTiles)) return target;
    if (packingHasOverlap(picked)) return target;
    const candidate = scorePicked(picked, firstRun, laterRunLen);
    candidate.bridgeLen = bridgeLen;
    if (!target || isBetterPacking(candidate, target, laterRunDefault)) return candidate;
    return target;
  };

  const searchPackings = (laterRuns, minFirstRun = firstRunFloor, maxFirstRun = LEO_MAIN_STRAIGHT) => {
    let found = null;
    const firstMin = Math.max(1, Number(minFirstRun) || 1);
    const firstMax = Math.max(
      firstMin,
      Math.min(Math.max(1, maxArm), Math.floor(Number(maxFirstRun) || LEO_MAIN_STRAIGHT))
    );
    for (const laterRunLen of laterRuns) {
      for (let firstRun = firstMax; firstRun >= firstMin; firstRun -= 1) {
        for (const bridgeLen of bridgeOptions) {
          for (const force of [false, true]) {
            const packed = tryPack(force, firstRun, bridgeLen, laterRunLen);
            const next = considerPacked(packed, firstRun, laterRunLen, bridgeLen, found);
            if (next !== found) {
              found = next;
              break;
            }
          }
        }
      }
    }
    return found;
  };

  const restoreFoldsFrom = (candidate) => {
    if (!candidate) return;
    activeFoldRight = candidate.foldRight || FIRST_FOLD_RIGHT;
    activeFoldLeft = candidate.foldLeft || FIRST_FOLD_LEFT;
    activeExitOutward = Boolean(candidate.exitOutward);
  };

  let best = searchPackings([laterRunDefault]);
  if (
    best &&
    packingNeedsFullRunSearch(playedCount, best.scale)
  ) {
    const laterMax = packLaterRunSearchLimit(laterRunDefault, maxArm);
    const laterRuns = [];
    for (let r = 2; r <= laterMax; r += 1) laterRuns.push(r);
    const firstMax = packLaterRunSearchLimit(LEO_MAIN_STRAIGHT, maxArm);
    const minFirst = playedCount >= 18 ? 1 : Math.max(1, firstRunFloor);
    const searched = searchPackings(laterRuns, minFirst, firstMax);
    if (
      searched &&
      (searched.scale > best.scale ||
        isBetterPacking(searched, best, laterRunDefault))
    ) {
      best = searched;
    }
  }
  if (
    best &&
    Math.abs(leftLen - rightLen) >= 3 &&
    packingNeedsFullRunSearch(playedCount, best.scale)
  ) {
    const longIsLeft = leftLen >= rightLen;
    const longFirst = longIsLeft
      ? best.firstRunLeft ?? best.firstRun
      : best.firstRunRight ?? best.firstRun;
    const shortMax = Math.max(1, longIsLeft ? rightLen : leftLen);
    const laterRuns = [...new Set([best.laterRun, laterRunDefault, 2, 3, 4, 5, 6])]
      .filter((r) => r >= 2)
      .sort((a, b) => a - b);
    for (const laterRunLen of laterRuns) {
      for (let shortFirst = shortMax; shortFirst >= 1; shortFirst -= 1) {
        const pair = longIsLeft
          ? { left: longFirst, right: shortFirst }
          : { left: shortFirst, right: longFirst };
        for (const bridgeLen of bridgeOptions) {
          for (const force of [false, true]) {
            const packed = tryPack(force, pair, bridgeLen, laterRunLen);
            const next = considerPacked(packed, pair, laterRunLen, bridgeLen, best);
            if (next !== best) {
              best = next;
              break;
            }
          }
        }
      }
    }
  }
  if (
    best &&
    packingNeedsTighterRunSearch(
      playedCount,
      best.scale,
      best.slackFracW,
      best.slackFracH
    )
  ) {
    const laterRuns = [];
    for (let r = laterRunDefault; r >= 2; r -= 1) laterRuns.push(r);
    const minFirst = playedCount >= 18 ? 1 : Math.max(1, firstRunFloor);
    const tightened = searchPackings(laterRuns, minFirst);
    if (tightened && tightened.scale > best.scale + PACK_SCALE_TIE) best = tightened;
  }
  if (
    best &&
    packingNeedsSameDirFoldSearch(
      playedCount,
      best.scale,
      best.slackFracW,
      best.slackFracH,
      maxArm
    )
  ) {
    const laterMax = Math.min(8, packLaterRunSearchLimit(laterRunDefault, maxArm));
    const laterRuns = [];
    for (let r = 2; r <= laterMax; r += 1) laterRuns.push(r);
    const firstMax = Math.min(8, packLaterRunSearchLimit(LEO_MAIN_STRAIGHT, maxArm));
    const foldSpecs = [
      { right: "S", left: "S", outward: true },
      { right: "N", left: "N", outward: true },
    ];
    for (const spec of foldSpecs) {
      activeFoldRight = spec.right;
      activeFoldLeft = spec.left;
      activeExitOutward = spec.outward;
      const searched = searchPackings(laterRuns, 1, firstMax);
      if (
        searched &&
        (searched.scale > best.scale ||
          isBetterPacking(searched, best, laterRunDefault))
      ) {
        best = searched;
      }
    }
    restoreFoldsFrom(best);
  }
  if (
    best &&
    packingNeedsBalancedFirstRunSearch(
      playedCount,
      best.scale,
      best.slackFracW,
      best.slackFracH,
      leftLen,
      rightLen
    )
  ) {
    restoreFoldsFrom(best);
    const leftMax = Math.max(1, Math.min(leftLen || 1, 6));
    const rightMax = Math.max(1, Math.min(rightLen || 1, 6));
    const laterRuns = [...new Set([best.laterRun, 4, 5, 6])]
      .filter((r) => r >= 2)
      .sort((a, b) => a - b);
    for (const laterRunLen of laterRuns) {
      for (let leftFirst = leftMax; leftFirst >= 1; leftFirst -= 1) {
        for (let rightFirst = rightMax; rightFirst >= 1; rightFirst -= 1) {
          if (leftFirst === rightFirst) continue;
          const pair = { left: leftFirst, right: rightFirst };
          for (const force of [false, true]) {
            const packed = tryPack(force, pair, BRIDGE_LEN, laterRunLen);
            const next = considerPacked(packed, pair, laterRunLen, BRIDGE_LEN, best);
            if (next !== best) {
              best = next;
              break;
            }
          }
        }
      }
    }
  }

  restoreFoldsFrom(best);

  if (
    best &&
    packingNeedsSpinnerArmSearch(
      northTiles.length,
      southTiles.length,
      best.scale,
      best.slackFracW,
      best.slackFracH
    )
  ) {
    const defaultArm = best;
    const armRuns = spinnerArmRunCandidates(
      armStraight,
      Math.max(northTiles.length, southTiles.length)
    );
    let armBest = { ...defaultArm, armRun: 0 };
    for (const armRun of armRuns) {
      if (armRun === 0) continue;
      activeArmRun = armRun;
      const packed = searchPackings([defaultArm.laterRun ?? laterRunDefault]);
      if (packed && isBetterArmCandidate(packed, armBest)) armBest = packed;
    }
    activeArmRun = 0;
    if (armBest && armBest.scale >= defaultArm.scale + PACK_ARM_SCALE_GAIN) {
      best = armBest;
    }
  }

  const materializeComplete = (sourceMap, failureReason) => {
    const map = sourceMap ? clonePlacementMap(sourceMap) : new Map();
    completeMissingTiles(map, tiles, centerIndex, size, gap, {
      topology,
      firstRun: firstRunFloor,
      armStraight,
      armRun: activeArmRun,
      foldRight: activeFoldRight,
      foldLeft: activeFoldLeft,
    });
    completeMissingSpinnerArms(map, topology, size, gap, armStraight, activeArmRun);
    fillMissingPlayedTiles(
      map,
      tiles,
      size,
      gap,
      americanVerticalMain() ? "N" : "E",
      (tile) => topology?.membership?.[tile.id]
    );
    fillMissingPlayedTiles(
      map,
      northTiles,
      size,
      gap,
      spinnerArmStartDirs().top,
      (tile) => topology?.membership?.[tile.id],
      map.get(layoutSpinnerId)
    );
    fillMissingPlayedTiles(
      map,
      southTiles,
      size,
      gap,
      spinnerArmStartDirs().bottom,
      (tile) => topology?.membership?.[tile.id],
      map.get(layoutSpinnerId)
    );
    applyTopologyBranches(map, topology);
    const mainList = tiles.map((t) => map.get(t.id)).filter(Boolean);
    const armList = [...northTiles, ...southTiles]
      .map((t) => map.get(t.id))
      .filter(Boolean);
    const screen = toScreen(
      [...mainList, ...armList],
      { width, height },
      options.padding ?? PADDING,
      tiles[centerIndex].id,
      margin,
      hudRight,
      null,
      hudLeft,
      scaleCap,
      hudBottom
    );
    const byId = new Map(screen.tiles.map((t) => [t.tileId, t]));
    const orderedMain = tiles.map((t, i) =>
      takeScreenTile(byId, t, tiles[i - 1], screen.origin, size, screen.scale, topology)
    );
    const armChain = [...northTiles, ...southTiles];
    const orderedArms = armChain.map((t, i) =>
      takeScreenTile(
        byId,
        t,
        armChain[i - 1] || tiles[centerIndex],
        screen.origin,
        size,
        screen.scale,
        topology
      )
    );
    const complete = {
      ...screen,
      tiles: orderedMain,
      armTiles: orderedArms,
      scale: screen.scale,
      gap: Math.max(MIN_SAFE_GAP_PX, Math.min(2, gap * screen.scale)),
    };
    if (layoutDevDiagnosticsEnabled() && !isCompletePicked(complete, tiles, northTiles, southTiles)) {
      console.error(
        formatLayoutIntegrityError(
          inspectBoardLayoutIntegrity(complete, playedTableTiles(tiles, northTiles, southTiles), {
            failureReason,
            packing: best?.picked?.packing || null,
            routingCandidate: {
              firstRun: best?.firstRun,
              laterRun: best?.laterRun,
              foldRight: best?.foldRight,
              foldLeft: best?.foldLeft,
            },
          })
        )
      );
    }
    return complete;
  };

  let picked = best?.picked || null;
  if (!isCompletePicked(picked, tiles, northTiles, southTiles)) {
    picked = projectPack(new Map(), true);
  }
  if (!isCompletePicked(picked, tiles, northTiles, southTiles)) {
    picked = materializeComplete(null, "guaranteed-complete-fallback");
  }

  const result = best
    ? {
        ...picked,
        packing: {
          firstRun: best.firstRun,
          firstRunLeft: best.firstRunLeft,
          firstRunRight: best.firstRunRight,
          laterRun: best.laterRun,
          foldRight: best.foldRight,
          foldLeft: best.foldLeft,
          bridgeLen: best.bridgeLen,
          slackFracW: best.slackFracW,
          slackFracH: best.slackFracH,
        },
      }
    : picked;
  if (!isCompletePicked(result, tiles, northTiles, southTiles)) {
    return materializeComplete(null, "result-incomplete");
  }
  return result;
  } finally {
    activeLayoutPolicy = prevLayoutPolicy;
  }
}

/* ---------- Compatibility shims for legacy layoutBoard callers ---------- */

/**
 * Resolve the unscaled board tile base from the CSS probe and the current
 * felt. Preferred size comes from the universal gameplay composition
 * (`capPlayedShortPx`); the probe is only a measurement of `--played-tile-*`.
 * Independent vw/vh heuristics are not used — those made phone bones dominate
 * a short felt while tablet bones stayed modest.
 *
 * @param {Viewport} viewport - Board stage size in CSS px
 * @param {{ w: number, h: number }} measured - Probe tile at scale 1
 * @returns {{ w: number, h: number }}
 */
export function resolveBoardTileBase(viewport, measured) {
  const mw = Math.max(1, Number(measured?.w) || 40);
  const mh = Math.max(1, Number(measured?.h) || mw * TILE_ASPECT);
  const ratio = mh / mw;
  const cssShort = Math.min(mw, mh);
  const vw = Math.max(120, Number(viewport?.width) || 640);
  const vh = Math.max(120, Number(viewport?.height) || 320);
  // Cap from the universal composition: one vertical bone vs usable felt,
  // not an independent vw/vh heuristic that lets phone tiles dominate.
  const fromComposition = capPlayedShortPx({
    width: vw,
    height: vh,
    hudBottom: viewport?.hudBottom,
  });
  const short = Math.min(
    BOARD_BASE_SHORT_MAX_PX,
    Math.max(28, Math.min(cssShort, fromComposition))
  );
  return { w: short, h: short * ratio };
}

/**
 * @param {Viewport} viewport
 * @param {number} [margin]
 * @param {number|null} [hudRightOverride] - Measured right HUD footprint (px)
 *   from BoardContainer when a right-side HUD occupied the felt.
 *   Live GamePage keeps reserve outside the green table (hudRight = 0).
 * @param {number|null} [hudLeftOverride] - Optional measured left HUD
 *   footprint (px). Unused by the live GamePage (scoreboard is outside the
 *   green table); kept for layout engine tests / tooling.
 *   When omitted (e.g. every existing test/caller), falls back to the
 *   original width-based estimate below so behavior is unchanged.
 * @param {number} [hudBottomOverride] - Extra bottom carve-out (px) when
 *   a HUD still overlaps the board stage. Live GamePage keeps the Player 1
 *   dock outside the felt, so this is 0. Non-zero keeps historical callers
 *   and exclusion tests working.
 */
export function computePlayBounds(
  viewport,
  margin = MARGIN,
  hudRightOverride = null,
  hudLeftOverride = null,
  hudBottomOverride = 0
) {
  const width = Math.max(120, viewport.width);
  const height = Math.max(120, viewport.height);
  const estimate =
    width < 500
      ? Math.min(52, Math.max(32, width * 0.12))
      : Math.min(112, Math.max(56, width * 0.16));
  // Never let an oversized measured HUD footprint collapse the playable
  // width below a sane floor — routing still needs room for early turns.
  // Empirically, usable widths under ~200px on phone felt (with a mid-game
  // 12-tile chain + real HUD) make placement search fail closed. Keep ≥220px.
  const MIN_PLAYABLE_WIDTH = 220;
  const maxHudSide = Math.max(estimate, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  // Prefer the live measured HUD carve-out when supplied — do NOT inflate it
  // up to the width-based estimate (that falsely shrinks the green table).
  // Default estimate stays on the right for backward-compatible callers/tests.
  const hudRight =
    hudRightOverride != null && Number.isFinite(hudRightOverride)
      ? Math.min(Math.max(0, hudRightOverride), maxHudSide)
      : estimate;
  const hudLeft =
    hudLeftOverride != null && Number.isFinite(hudLeftOverride)
      ? Math.min(Math.max(0, hudLeftOverride), maxHudSide)
      : 0;
  // Keep a usable playable width even if both sides report large footprints.
  const combined = hudLeft + hudRight;
  const maxCombined = Math.max(0, width - margin * 2 - MIN_PLAYABLE_WIDTH);
  let left = hudLeft;
  let right = hudRight;
  if (combined > maxCombined && combined > 0) {
    const scale = maxCombined / combined;
    left *= scale;
    right *= scale;
  }
  const hudBottomRaw =
    hudBottomOverride != null && Number.isFinite(hudBottomOverride)
      ? Math.max(0, hudBottomOverride)
      : 0;
  const maxHudBottom = Math.max(0, height - margin * 2 - MIN_PLAYABLE_HEIGHT);
  const hudBottom = Math.min(hudBottomRaw, maxHudBottom);
  return {
    minX: margin + left,
    minY: margin,
    maxX: width - margin - right,
    maxY: height - margin - hudBottom,
    width,
    height,
    hudRight: right,
    hudLeft: left,
    hudBottom,
  };
}

export function computeLayoutMetrics(viewport, tileSize, margin, tileCount = 0) {
  const short = Math.max(1, tileSize.w);
  const long = Math.max(short + 1, tileSize.h);
  const bounds = computePlayBounds(viewport, margin);
  const usableW = Math.max(1, bounds.maxX - bounds.minX);
  const step = long + CHAIN_GAP;
  const maxRun = Math.max(3, Math.floor(usableW / step) - 1);
  void tileCount;
  return {
    short,
    long,
    chainGap: CHAIN_GAP,
    rowClear: Math.max(short * 0.55, 2 * long + 2 * CHAIN_GAP - short),
    maxRun,
    usableW,
    usableH: Math.max(1, bounds.maxY - bounds.minY),
    laneExtraFor: () => 0,
    bridgeLen: BRIDGE_LEN,
  };
}

/**
 * Planned scale hint: preferred size unless a packed full-match AABB would
 * miss the safe felt. Same planned length (28) keeps this stable mid-match.
 */
export function computeStableFitScale(viewport, tileSize, margin, tileCount) {
  const planned = Math.max(tileCount, 28);
  const metrics = computeLayoutMetrics(viewport, tileSize, margin, planned);
  const play = computePlayBounds(viewport, margin);
  const safe = computeSafeFeltBounds(play);
  const step = metrics.long + CHAIN_GAP;
  const tilesPerRow = Math.max(
    3,
    Math.min(RUN_CEILING, Math.floor(metrics.usableW / 2 / step) - 1)
  );
  const perArm = Math.ceil(planned / 2);
  const folds = Math.max(0, Math.ceil(perArm / tilesPerRow) - 1);
  const bridgeH =
    BRIDGE_LEN * metrics.long + (BRIDGE_LEN + 1) * CHAIN_GAP + metrics.short * 0.25;
  const contentH = (folds + 1) * metrics.short + folds * bridgeH;
  const contentW = tilesPerRow * step + metrics.short * 0.5 + PADDING;
  return computeFitScale(
    { width: contentW, height: contentH, minX: 0, minY: 0, maxX: contentW, maxY: contentH },
    safe,
    1
  );
}

export function measureMinRowClearance(placements) {
  let minClear = Infinity;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const bothH = a.w >= a.h - 0.5 && b.w >= b.h - 0.5;
      const bothV = a.h > a.w + 0.5 && b.h > b.w + 0.5;
      if (bothH) {
        const xOverlap = a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1;
        if (xOverlap) {
          const clear = a.y >= b.y ? a.y - (b.y + b.h) : b.y - (a.y + a.h);
          if (clear >= 0) minClear = Math.min(minClear, clear);
        }
      } else if (bothV) {
        const yOverlap = a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
        if (yOverlap) {
          const clear = a.x >= b.x ? a.x - (b.x + b.w) : b.x - (a.x + a.w);
          if (clear >= 0) minClear = Math.min(minClear, clear);
        }
      }
    }
  }
  return minClear === Infinity ? null : minClear;
}

export function countTurns(placements) {
  let turns = 0;
  for (let i = 1; i < placements.length; i += 1) {
    const a = placements[i - 1].travelDir;
    const b = placements[i].travelDir;
    if (a && b && a !== b) turns += 1;
  }
  return turns;
}

export function measureVerticalBridges(placements) {
  const lengths = [];
  let run = 0;
  for (const p of placements) {
    const d = p.travelDir;
    if (d === "N" || d === "S") run += 1;
    else if (run > 0) {
      lengths.push(run);
      run = 0;
    }
  }
  if (run > 0) lengths.push(run);
  return lengths;
}

/**
 * Legacy-compatible layoutBoard — wraps calculateBoardLayout.
 * If the caller does not pass spinnerId, a double at centerIndex is treated
 * as the first-double anchor (historical API). New code should pass spinnerId
 * explicitly; calculateBoardLayout never infers a spinner from the center tile.
 */
export function layoutBoard(tiles, centerIndex, viewport, tileSize, options = {}) {
  if (!tiles?.length || centerIndex < 0 || centerIndex >= tiles.length) {
    return {
      placements: [],
      armPlacements: [],
      scale: 1,
      tileScale: 1,
      content: { width: 0, height: 0 },
      center: { x: 0, y: 0 },
      metrics: null,
      debug: { boxes: [], path: [], turnPoints: [] },
      gap: CHAIN_GAP,
    };
  }

  const center = tiles[centerIndex];
  const spinnerId =
    options.spinnerId ??
    (center && Number(center.left) === Number(center.right) ? center.id : null);

  const result = calculateBoardLayout(tiles, viewport, {
    ...options,
    centerIndex,
    spinnerId,
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
  });

  const placements = result.tiles.map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    rotation: t.rotation ?? rotationForOrientation(t.orientation),
    travelDir: t.travelDir,
    branch: t.branch,
    double: t.double,
    isCorner: t.isCorner,
    isBridge: t.isBridge,
  }));
  const armPlacements = (result.armTiles || []).map((t) => ({
    id: t.tileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    orientation: t.orientation,
    rotation: t.rotation ?? rotationForOrientation(t.orientation),
    travelDir: t.travelDir,
    branch: t.branch,
    double: t.double,
    isCorner: t.isCorner,
    isBridge: t.isBridge,
  }));

  return {
    placements,
    armPlacements,
    scale: 1,
    tileScale: result.scale,
    content: result.content ?? {
      width: viewport.width,
      height: viewport.height,
    },
    center: result.origin,
    camera: result.camera ?? null,
    metrics: computeLayoutMetrics(viewport, tileSize, options.margin ?? MARGIN, tiles.length),
    debug: {
      boxes: placements.map((p, index) => {
        const col = collisionBox(p);
        return {
          index,
          id: p.id,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          cx: p.x + p.w / 2,
          cy: p.y + p.h / 2,
          rotation: p.rotation,
          travelDir: p.travelDir,
          branch: p.branch,
          double: !!p.double,
          collision: { x: col.x, y: col.y, w: col.w, h: col.h },
        };
      }),
      path: placements.map((p) => ({
        id: p.id,
        x: p.x + p.w / 2,
        y: p.y + p.h / 2,
      })),
      turnPoints: placements
        .map((p, index, arr) => {
          if (index === 0) return null;
          const a = arr[index - 1];
          if (!a.travelDir || !p.travelDir || a.travelDir === p.travelDir) return null;
          return {
            index,
            id: p.id,
            x: p.x + p.w / 2,
            y: p.y + p.h / 2,
            from: a.travelDir,
            to: p.travelDir,
          };
        })
        .filter(Boolean),
    },
    gap: result.gap,
  };
}

/** @deprecated Prefer layoutBoard / calculateBoardLayout */
export function layoutSnakeFromCenter(
  tiles,
  centerIndex,
  maxWidth,
  sizes,
  gap = CHAIN_GAP,
  maxHeight = 400,
  options = {}
) {
  const result = layoutBoard(
    tiles,
    centerIndex,
    { width: maxWidth, height: maxHeight },
    sizes,
    { ...options, gap }
  );
  return { positions: result.placements, zoom: result.tileScale };
}

export function layoutHeight() {
  return 0;
}

export function layoutWidth() {
  return 0;
}
