/**
 * Universal gameplay composition.
 *
 * One reference canvas (1280×800 landscape). Every device derives a single
 * uiScale from its safe viewport; chrome, felt, played tiles, hand, and
 * actions all come from that scale. Aspect ratio may add breathing room;
 * it must not invent a second layout.
 *
 * Vertical stack (no overlays):
 *   top chrome  →  green felt  →  bottom hand/control dock
 */

/**
 * Preferred played-tile scale vs the previous 99×186 reference.
 * One multiplier — auto-fit still shrinks the complete chain when needed.
 * Short/wide (phone landscape) canvases get an extra readable-size boost;
 * tablet/reference sizing stays on this multiplier alone.
 */
export const PLAYED_PREFERRED_SCALE = 1.2;
/** Phone-landscape only. Tablet preferred size is unchanged. */
export const PHONE_PLAYED_SIZE_BOOST = 1.15;
/**
 * Phone preferred bones are computed from this safe-height ceiling (CSS px).
 * Extra landscape felt on taller phones is used to keep this size longer,
 * not to inflate the unscaled tile past the approved Android phone band.
 */
export const PHONE_PLAYED_SIZE_SAFE_H = 412;
const PLAYED_SHORT_REF_PX = 99;
const PLAYED_LONG_REF_PX = 186;
const PLAYED_LONG_MAX_OF_FELT_H_REF = 0.42;
const PLAYED_SHORT_MAX_PX_REF = 114;

export const GAMEPLAY_REF = Object.freeze({
  width: 1280,
  height: 800,
  chrome: 132,
  dock: 78,
  regionGap: 6,
  felt: 578,
  playedShort: PLAYED_SHORT_REF_PX * PLAYED_PREFERRED_SCALE,
  playedLong: PLAYED_LONG_REF_PX * PLAYED_PREFERRED_SCALE,
  handShort: 33,
  handLong: 60,
  action: 44,
  menu: 40,
  statusBand: 14,
});

/** Played short side as a fraction of inner felt width on the reference canvas. */
export const PLAYED_SHORT_OF_FELT_W = GAMEPLAY_REF.playedShort / 1151;
/** Played long side as a fraction of the exclusive felt (dock is not part of felt). */
export const PLAYED_LONG_OF_FELT_H = GAMEPLAY_REF.playedLong / GAMEPLAY_REF.felt;
/** Short-canvas occupancy ceiling so phone bones stay readable on exclusive felt. */
export const PLAYED_LONG_MAX_OF_FELT_H =
  PLAYED_LONG_MAX_OF_FELT_H_REF * PLAYED_PREFERRED_SCALE;
/** Short landscape occupancy: keep preferred readable size until auto-fit. Tablet stays on PLAYED_LONG_MAX_OF_FELT_H. */
export const PLAYED_LONG_MAX_OF_FELT_H_SHORT = 0.72;
/** Hard ceiling for the unscaled played short side (px). */
export const PLAYED_SHORT_MAX_PX = PLAYED_SHORT_MAX_PX_REF * PLAYED_PREFERRED_SCALE;
export const PLAYED_SHORT_MIN_PX = 28;
/** @deprecated Felt is exclusive of the dock; alias kept for callers. */
export const PLAYED_LONG_OF_USABLE_H = PLAYED_LONG_OF_FELT_H;

export const UI_SCALE_MIN = 0.42;
export const UI_SCALE_MAX = 1.12;
export const CHROME_MIN_PX = 96;
export const CHROME_MAX_PX = 148;
export const DOCK_MIN_PX = 48;
export const DOCK_MAX_PX = 136;
/** Vertical pad inside the dock — not empty space above the hand. */
export const DOCK_PAD_PX = 4;
/** Felt-to-hand gap after unused dock reservation is removed. */
export const FELT_HAND_GAP_MIN_PX = 4;
export const FELT_HAND_GAP_MAX_PX = 8;
/** 4-player phone landscape: small Rival 1 → table-frame gap. Bottom edge stays put. */
export const FOUR_PLAYER_PHONE_CHROME_FELT_GAP_PX = 2;
export const FOUR_PLAYER_PHONE_CHROME_MIN_PX = 64;
/** @deprecated Same values as FOUR_PLAYER_PHONE_* — kept for existing tests. */
export const AMERICAN_4P_PHONE_CHROME_FELT_GAP_PX = FOUR_PLAYER_PHONE_CHROME_FELT_GAP_PX;
export const AMERICAN_4P_PHONE_CHROME_MIN_PX = FOUR_PLAYER_PHONE_CHROME_MIN_PX;
/**
 * Phone-landscape height ceiling (CSS px). Covers short/wide safes after
 * notch/home-indicator insets, without treating tablet landscape (~768+) as
 * a phone. Aspect still qualifies very wide canvases.
 */
export const PHONE_LANDSCAPE_MAX_H = 480;
export const PHONE_LANDSCAPE_MIN_AR = 2.05;
/** Portrait occupancy: played short side as a fraction of felt width. */
export const PLAYED_SHORT_OF_FELT_W_PORTRAIT = 0.165;
/** One vertical bone may occupy this fraction of portrait felt height before wrap. */
export const PLAYED_LONG_MAX_OF_FELT_H_PORTRAIT = 0.28;
export const PORTRAIT_CHROME_MIN_PX = 88;
export const PORTRAIT_CHROME_MAX_PX = 128;
export const PORTRAIT_DOCK_MIN_PX = 92;
export const PORTRAIT_DOCK_MAX_PX = 148;
export const HAND_LONG_MIN_PX = 36;
export const HAND_LONG_MAX_PX = 64;
/** Player 1 unplayed tiles only — does not change dock/felt reservation. */
export const PLAYER_HAND_SCALE = 1.2;
export const PLAYER_HAND_GAP_PX = 6;
export const PLAYER_HAND_OVERLAP_MIN_PX = -8;
export const ACTION_MIN_PX = 36;
export const ACTION_MAX_PX = 48;
export const ACTION_COL_MIN_PX = 110;
export const DOCK_COL_GAP_PX = 10;
export const COMPOSITION_GAP_PX = 8;

const TILE_RATIO = GAMEPLAY_REF.playedLong / GAMEPLAY_REF.playedShort;
const HAND_RATIO = GAMEPLAY_REF.handLong / GAMEPLAY_REF.handShort;

/**
 * Fit seven scaled Player 1 tiles into the dock center without changing
 * felt/dock geometry. Prefer a small gap; allow a controlled overlap on
 * narrow widths.
 */
export function fitPlayerHandRow(tileShort, budget) {
  const n = 7;
  const width = Math.max(18, Number(tileShort) || 0);
  const room = Math.max(80, Number(budget) || 0);
  let gap = PLAYER_HAND_GAP_PX;
  let overlap = 0;
  const withGap = n * width + (n - 1) * gap;
  if (withGap > room) {
    gap = (room - n * width) / (n - 1);
    if (gap >= 2) {
      overlap = 0;
    } else {
      gap = 0;
      overlap = clamp((room - n * width) / (n - 1), PLAYER_HAND_OVERLAP_MIN_PX, 0);
    }
  }
  let short = width;
  const used = n * short + (n - 1) * (gap + overlap);
  if (used > room + 0.5) {
    short = Math.max(18, (room - (n - 1) * PLAYER_HAND_OVERLAP_MIN_PX) / n);
    gap = 0;
    overlap = PLAYER_HAND_OVERLAP_MIN_PX;
  }
  return { short, gap, overlap };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function occupancyLongCap(usableH, usableW) {
  const h = Math.max(1, Number(usableH) || 0);
  const w = Math.max(1, Number(usableW) || 0);
  if (h > w) return h * PLAYED_LONG_MAX_OF_FELT_H_PORTRAIT;
  return h * (isPhoneLandscapeBox(w, h) ? PLAYED_LONG_MAX_OF_FELT_H_SHORT : PLAYED_LONG_MAX_OF_FELT_H);
}

/** True when the safe box is taller than it is wide. */
export function isPortraitBox(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  return h > w;
}

/** True for short/wide phone-landscape safes — never a device name. */
export function isPhoneLandscapeBox(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (h < 1) return false;
  return h <= PHONE_LANDSCAPE_MAX_H || w / h >= PHONE_LANDSCAPE_MIN_AR;
}

/**
 * Phone-landscape 4-player: grow felt upward under Rival 1.
 * Tablet keeps the shared chrome reservation. Classic 2-player and 3-player
 * phone use the same upward hug; other 2p/3p rulesets do not.
 */
export function isFourPlayerPhoneLayout(layout, options = {}) {
  const w = Number(layout?.safeW ?? layout?.width) || 0;
  const h = Number(layout?.safeH ?? layout?.height) || 0;
  return (
    gameplayDensityClass({ safeW: w, safeH: h }) === "short" &&
    Number(options.playerCount) === 4
  );
}

/** @deprecated Use isFourPlayerPhoneLayout. */
export function isAmericanFourPhoneLayout(layout, options = {}) {
  return isFourPlayerPhoneLayout(layout, options);
}

/** Engine id for Classic. UI never shows this string. */
export function isClassicRulesetId(rulesetId) {
  return String(rulesetId || "") === "legacy";
}

/**
 * Classic 2-player phone-landscape: same Rival 1 upward hug as 4-player
 * phone. Derived from the short/wide safe box, never a device name.
 */
export function isClassicTwoPlayerPhoneLayout(layout, options = {}) {
  const w = Number(layout?.safeW ?? layout?.width) || 0;
  const h = Number(layout?.safeH ?? layout?.height) || 0;
  return (
    gameplayDensityClass({ safeW: w, safeH: h }) === "short" &&
    Number(options.playerCount) === 2 &&
    isClassicRulesetId(options.rulesetId)
  );
}

/**
 * Classic 3-player phone-landscape: same Rival 1 upward hug as Classic 2p.
 * Tablet and other rulesets keep the shared chrome reservation.
 */
export function isClassicThreePlayerPhoneLayout(layout, options = {}) {
  const w = Number(layout?.safeW ?? layout?.width) || 0;
  const h = Number(layout?.safeH ?? layout?.height) || 0;
  return (
    gameplayDensityClass({ safeW: w, safeH: h }) === "short" &&
    Number(options.playerCount) === 3 &&
    isClassicRulesetId(options.rulesetId)
  );
}

/**
 * @param {{ width: number, height: number }} viewport
 *   Safe gameplay box in CSS px (padding/safe-area already applied).
 * @param {{ playerCount?: number, rulesetId?: string }} [options]
 */
export function resolveGameplayLayout(viewport, options = {}) {
  const safeW = Math.max(160, Number(viewport?.width) || 0);
  const safeH = Math.max(160, Number(viewport?.height) || 0);
  const portrait = isPortraitBox(safeW, safeH);
  const uiScale = clamp(
    Math.min(safeW / GAMEPLAY_REF.width, safeH / GAMEPLAY_REF.height),
    UI_SCALE_MIN,
    UI_SCALE_MAX
  );
  const heightScale = clamp(safeH / GAMEPLAY_REF.height, UI_SCALE_MIN, UI_SCALE_MAX);

  let chromeHeight = clamp(GAMEPLAY_REF.chrome * heightScale, CHROME_MIN_PX, CHROME_MAX_PX);
  const regionGap = clamp(Math.round(GAMEPLAY_REF.regionGap * uiScale), 4, 10);
  let chromeFeltGap = regionGap;
  const feltDockGap = clamp(regionGap, FELT_HAND_GAP_MIN_PX, FELT_HAND_GAP_MAX_PX);
  const menuHeight = clamp(GAMEPLAY_REF.menu * uiScale, 32, 44);
  const statusBand = clamp(GAMEPLAY_REF.statusBand * uiScale, 12, 18);

  let handLong = clamp(GAMEPLAY_REF.handLong * uiScale, HAND_LONG_MIN_PX, HAND_LONG_MAX_PX);
  let handShort = handLong / HAND_RATIO;
  const passWidth = Math.max(ACTION_COL_MIN_PX, 116 * uiScale);
  const matchWidth = Math.max(ACTION_COL_MIN_PX, 122 * uiScale);
  const handBudget = Math.max(
    120,
    safeW - passWidth - matchWidth - 2 * DOCK_COL_GAP_PX
  );
  const maxHandShort = (handBudget - 6 * 6) / 7;
  if (!portrait && handShort > maxHandShort) {
    handShort = Math.max(18, maxHandShort);
    handLong = handShort * HAND_RATIO;
  }
  const handPip = Math.max(3, 5.5 * uiScale);
  let playerRow = fitPlayerHandRow(handShort * PLAYER_HAND_SCALE, handBudget);
  if (portrait) {
    const readable = clamp(handShort * PLAYER_HAND_SCALE, 28, 40);
    playerRow = { short: readable, gap: PLAYER_HAND_GAP_PX, overlap: 0 };
  }
  let playerHandShort = playerRow.short;
  let playerHandLong = playerHandShort * HAND_RATIO;
  let playerHandPip = Math.max(3.2, handPip * (playerHandShort / Math.max(handShort, 1)));
  const actionHeight = clamp(GAMEPLAY_REF.action * uiScale, ACTION_MIN_PX, ACTION_MAX_PX);
  const headerHeight = clamp(GAMEPLAY_REF.chrome * 0.38 * uiScale, 36, 56);

  const dockFromHand = handLong + statusBand + DOCK_PAD_PX;
  const dockFromActions = actionHeight + DOCK_PAD_PX;
  let dockHeight = clamp(
    Math.max(dockFromHand, dockFromActions),
    DOCK_MIN_PX,
    DOCK_MAX_PX
  );
  // Keep the +20% hand inside the existing dock so the felt cannot move.
  if (!portrait) {
    const maxPlayerLong = Math.max(HAND_LONG_MIN_PX, dockHeight - 8);
    if (playerHandLong > maxPlayerLong) {
      const fit = maxPlayerLong / playerHandLong;
      playerHandLong = maxPlayerLong;
      playerHandShort *= fit;
      playerHandPip = Math.max(3.2, playerHandPip * fit);
    }
  }

  const scoreRowHeight = clamp(Math.round(28 * uiScale + 10), 28, 42);
  const menuGap = clamp(Math.round(GAMEPLAY_REF.regionGap * uiScale), 3, 6);
  const fourPlayerPhone = !portrait && isFourPlayerPhoneLayout({ safeW, safeH }, options);
  const classicTwoPhone = !portrait && isClassicTwoPlayerPhoneLayout({ safeW, safeH }, options);
  const classicThreePhone = !portrait && isClassicThreePlayerPhoneLayout({ safeW, safeH }, options);
  if (fourPlayerPhone || classicTwoPhone || classicThreePhone) {
    // Hug Rival 1 / HUD content. Dock and feltDockGap stay put so the
    // felt BOTTOM and Player 1 hand do not move. Top edge rises; bottom
    // does not translate.
    const menuStack = headerHeight + menuGap + menuHeight;
    const rivalTray = Math.round(handLong * 0.52) + 20;
    const centerStack = headerHeight + rivalTray;
    const contentChrome = Math.max(menuStack, centerStack, scoreRowHeight);
    chromeHeight = clamp(
      Math.ceil(contentChrome),
      FOUR_PLAYER_PHONE_CHROME_MIN_PX,
      chromeHeight
    );
    chromeFeltGap = FOUR_PLAYER_PHONE_CHROME_FELT_GAP_PX;
  }
  if (portrait) {
    chromeHeight = clamp(
      Math.round(safeH * 0.155),
      PORTRAIT_CHROME_MIN_PX,
      PORTRAIT_CHROME_MAX_PX
    );
    chromeFeltGap = 4;
    dockHeight = clamp(
      Math.max(playerHandLong + statusBand + 12, actionHeight + 12, PORTRAIT_DOCK_MIN_PX),
      PORTRAIT_DOCK_MIN_PX,
      PORTRAIT_DOCK_MAX_PX
    );
  }

  const feltHeight = Math.max(
    160,
    safeH - chromeHeight - dockHeight - chromeFeltGap - feltDockGap
  );
  const feltWidth = safeW;
  const usableBoardHeight = feltHeight;

  let playedLong = GAMEPLAY_REF.playedLong * heightScale;
  let playedShort = playedLong / TILE_RATIO;
  if (gameplayDensityClass({ safeW, safeH }) === "short") {
    const phoneH = Math.min(safeH, PHONE_PLAYED_SIZE_SAFE_H);
    const phoneHeightScale = clamp(
      phoneH / GAMEPLAY_REF.height,
      UI_SCALE_MIN,
      UI_SCALE_MAX
    );
    playedLong = GAMEPLAY_REF.playedLong * phoneHeightScale * PHONE_PLAYED_SIZE_BOOST;
    playedShort = playedLong / TILE_RATIO;
  }
  const maxLongUsable = occupancyLongCap(usableBoardHeight, feltWidth);
  if (playedLong > maxLongUsable) {
    playedLong = maxLongUsable;
    playedShort = playedLong / TILE_RATIO;
  }
  const maxOneTile = usableBoardHeight * 0.92;
  if (playedLong > maxOneTile) {
    playedLong = maxOneTile;
    playedShort = playedLong / TILE_RATIO;
  }
  const maxShort = feltWidth * (portrait ? PLAYED_SHORT_OF_FELT_W_PORTRAIT : PLAYED_SHORT_OF_FELT_W);
  if (playedShort > maxShort) {
    playedShort = maxShort;
    playedLong = playedShort * TILE_RATIO;
  }
  playedShort = clamp(playedShort, PLAYED_SHORT_MIN_PX, PLAYED_SHORT_MAX_PX);
  playedLong = playedShort * TILE_RATIO;

  const feltTop = chromeHeight + chromeFeltGap;
  const feltBottom = feltTop + feltHeight;
  const dockTop = feltBottom + feltDockGap;
  const menuTop = headerHeight + menuGap;
  const menuBottom = Math.min(chromeHeight, menuTop + menuHeight);

  return {
    uiScale,
    safeW,
    safeH,
    chromeHeight,
    dockHeight,
    feltHeight,
    feltWidth,
    usableBoardHeight,
    playedShort,
    playedLong,
    handShort,
    handLong,
    handPip,
    playerHandShort,
    playerHandLong,
    playerHandPip,
    playerHandGap: playerRow.gap,
    playerHandOverlap: playerRow.overlap,
    actionHeight,
    headerHeight,
    regionGap,
    chromeFeltGap,
    feltDockGap,
    menuHeight,
    statusBand,
    passWidth,
    matchWidth,
    handBudget,
    feltTop,
    feltBottom,
    dockTop,
    scoreBottom: scoreRowHeight,
    menuBottom,
    menuTop,
    // Status ("Se tou ou") lives inside the dock with the hand — not a
    // second dark band between the gold table edge and the tiles.
    handTop: dockTop,
    passLeft: 0,
    passRight: passWidth,
    matchLeft: safeW - matchWidth,
    matchRight: safeW,
    handLeft: passWidth + DOCK_COL_GAP_PX,
    handRight: safeW - matchWidth - DOCK_COL_GAP_PX,
    handExclusion: 0,
    density: gameplayDensityClass({ safeW, safeH }),
    orientation: portrait ? "portrait" : "landscape",
  };
}

/**
 * Axis-aligned regions for the universal stack. Origin is the safe gameplay
 * box (padding / safe-area already removed). Used by layout contract tests.
 */
export function gameplayComposition(layout) {
  const L = layout;
  const gap = COMPOSITION_GAP_PX;
  return {
    score: {
      left: 0,
      right: Math.min(420, L.safeW * 0.46),
      top: 0,
      bottom: L.scoreBottom,
    },
    menu: {
      left: L.safeW - Math.max(110, L.matchWidth),
      right: L.safeW,
      top: L.menuTop,
      bottom: L.menuBottom,
    },
    felt: { left: 0, right: L.feltWidth, top: L.feltTop, bottom: L.feltBottom },
    hand: {
      left: L.handLeft,
      right: L.handRight,
      top: L.handTop,
      bottom: L.dockTop + L.dockHeight,
    },
    pass: {
      left: L.passLeft,
      right: L.passRight,
      top: L.dockTop + L.dockHeight - L.actionHeight,
      bottom: L.dockTop + L.dockHeight,
    },
    newMatch: {
      left: L.matchLeft,
      right: L.matchRight,
      top: L.dockTop + L.dockHeight - L.actionHeight,
      bottom: L.dockTop + L.dockHeight,
    },
    gap,
  };
}

export function rectsOverlap(a, b, slop = 0) {
  return (
    a.left < b.right - slop &&
    a.right > b.left + slop &&
    a.top < b.bottom - slop &&
    a.bottom > b.top + slop
  );
}

/** Layout-behavior class — aspect/height, never a device name. */
export function gameplayDensityClass(layout) {
  const w = Number(layout?.safeW) || 0;
  const h = Number(layout?.safeH) || 0;
  if (h < 1) return "standard";
  if (isPhoneLandscapeBox(w, h)) return "short";
  if (w / h < 1.45) return "square";
  return "standard";
}

/** Cap for resolveBoardTileBase — one vertical bone vs usable stage. */
export function capPlayedShortPx(stage) {
  const w = Math.max(120, Number(stage?.width) || 0);
  const h = Math.max(120, Number(stage?.height) || 0);
  const hudBottom = Math.max(0, Number(stage?.hudBottom) || 0);
  const usableH = Math.max(120, h - hudBottom);
  const occupancyCap = occupancyLongCap(usableH, w) / TILE_RATIO;
  const maxOneTile = (usableH * 0.92) / TILE_RATIO;
  const maxFromW = isPortraitBox(w, h)
    ? w * PLAYED_SHORT_OF_FELT_W_PORTRAIT
    : w * PLAYED_SHORT_OF_FELT_W;
  return Math.max(
    PLAYED_SHORT_MIN_PX,
    Math.min(PLAYED_SHORT_MAX_PX, occupancyCap, maxOneTile, maxFromW)
  );
}

export function gameplayLayoutCssVars(layout) {
  const px = (n, digits = 2) => `${Number(n).toFixed(digits)}px`;
  return {
    "--game-ui-scale": String(Number(layout.uiScale.toFixed(4))),
    "--game-hud-scale": String(Number(layout.uiScale.toFixed(4))),
    "--game-action-scale": String(Number(layout.uiScale.toFixed(4))),
    "--game-chrome-height": px(layout.chromeHeight, 0),
    "--game-dock-height": px(layout.dockHeight, 0),
    "--game-region-gap": px(layout.regionGap, 0),
    "--game-chrome-felt-gap": px(layout.chromeFeltGap, 0),
    "--game-felt-dock-gap": px(layout.feltDockGap, 0),
    "--felt-width": px(layout.feltWidth, 0),
    "--felt-height": px(layout.feltHeight, 0),
    "--played-tile-w": px(layout.playedShort),
    "--played-tile-h": px(layout.playedLong),
    "--domino-hand-w": px(layout.handShort),
    "--domino-hand-h": px(layout.handLong),
    "--domino-hand-pip": px(layout.handPip),
    "--player-hand-w": px(layout.playerHandShort),
    "--player-hand-h": px(layout.playerHandLong),
    "--player-hand-pip": px(layout.playerHandPip),
    "--player-hand-gap": px(layout.playerHandGap),
    "--player-hand-overlap": px(layout.playerHandOverlap),
    "--domino-w": px(layout.handShort),
    "--domino-h": px(layout.handLong),
    "--domino-pip": px(layout.handPip),
    "--game-action-height": px(layout.actionHeight, 0),
    "--game-hand-exclusion": px(layout.handExclusion, 0),
    "--game-safe-bottom": "env(safe-area-inset-bottom, 0px)",
    "--header-height": px(layout.headerHeight, 0),
    "--bottom-bar-height": px(layout.actionHeight + 8, 0),
    "--game-pass-col": px(layout.passWidth, 0),
    "--game-match-col": px(layout.matchWidth, 0),
  };
}

export function applyGameplayLayoutVars(element, layout) {
  if (!element || !layout) return;
  const vars = gameplayLayoutCssVars(layout);
  for (const [key, value] of Object.entries(vars)) {
    element.style.setProperty(key, value);
  }
}

export function measureSafeGameplayBox(element) {
  if (!element) {
    return { width: 1280, height: 800 };
  }
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
  const pl = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
  const pr = cs ? parseFloat(cs.paddingRight) || 0 : 0;
  const pt = cs ? parseFloat(cs.paddingTop) || 0 : 0;
  const pb = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
  return {
    width: Math.max(160, (element.clientWidth || 0) - pl - pr),
    height: Math.max(160, (element.clientHeight || 0) - pt - pb),
  };
}

/**
 * Usable gameplay box inside the environment viewport after CSS safe-area
 * insets. No extra application gutters — the composition then fills this box.
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [insets]
 */
export function usableGameplayViewport(viewport, insets = {}) {
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const top = Math.max(0, Number(insets.top) || 0);
  const right = Math.max(0, Number(insets.right) || 0);
  const bottom = Math.max(0, Number(insets.bottom) || 0);
  const left = Math.max(0, Number(insets.left) || 0);
  return {
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - top - bottom),
    top,
    right,
    bottom,
    left,
  };
}
