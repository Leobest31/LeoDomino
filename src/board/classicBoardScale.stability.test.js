/**
 * Classic board tile size stays stable across Realtime / get_game_view /
 * optimistic preview. Long chains wrap instead of emergency-shrinking.
 * Run: node src/board/classicBoardScale.stability.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOptimisticBoardPreview,
  coalescePublicSpinner,
  keepAuthoritativeView,
  optimisticPlayPreview,
} from "../online/onlineTable.js";
import { calculateBoardLayout, countTurns } from "./layoutEngine.js";
import { resolveGameplayLayout } from "../ui/gameplayLayout.js";
import { stabilizeBoardStageSize } from "./boardStageSize.js";

const here = dirname(fileURLToPath(import.meta.url));
const boardJsx = readFileSync(join(here, "BoardContainer.jsx"), "utf8");
const tableJsx = readFileSync(join(here, "../online/onlineTable.js"), "utf8");
const hook = readFileSync(join(here, "../hooks/useOnlineMatch.js"), "utf8");

function tile(id, left, right) {
  return { id, left, right };
}
function dbl(id, pip) {
  return { id, left: pip, right: pip };
}

function classicChain(n) {
  const board = [dbl("6-6", 6)];
  let leftPip = 6;
  const leftN = Math.floor((n - 1) / 2);
  const rightN = n - 1 - leftN;
  for (let i = 1; i <= leftN; i += 1) {
    const next = (leftPip + 1) % 7;
    board.unshift(tile(`L${i}`, next, leftPip));
    leftPip = next;
  }
  let rightPip = 6;
  for (let i = 1; i <= rightN; i += 1) {
    const next = (rightPip + 2) % 7;
    board.push(tile(`R${i}`, rightPip, next));
    rightPip = next;
  }
  return board;
}

function layoutClassic(board, stage, extra = {}) {
  return calculateBoardLayout(board, stage, {
    centerTileId: "6-6",
    spinnerId: "6-6",
    tileWidth: extra.tileWidth ?? 72,
    tileHeight: extra.tileHeight ?? 136,
    hudRight: 0,
    hudLeft: 0,
    hudBottom: extra.hudBottom ?? 0,
    spinnerNorth: extra.north ?? [],
    spinnerSouth: extra.south ?? [],
    rulesetId: extra.rulesetId ?? "legacy",
  });
}

const iphone = resolveGameplayLayout({ width: 390, height: 844 });
const android = resolveGameplayLayout({ width: 412, height: 915 });
const felt = {
  w: Math.round(iphone.feltWidth * 0.97),
  h: Math.round(iphone.feltHeight),
};

{
  const board = classicChain(8);
  const normal = layoutClassic(board, { width: felt.w, height: felt.h });
  const collapsed = layoutClassic(board, { width: 120, height: 120 });
  assert.ok(normal.scale >= 0.55, `normal Classic scale ${normal.scale}`);
  assert.ok(
    collapsed.scale + 0.08 < normal.scale,
    `a 120px stage would shrink tiles (${collapsed.scale} vs ${normal.scale})`
  );
  const kept = stabilizeBoardStageSize(felt, { w: 120, h: 120 });
  const recovered = layoutClassic(board, { width: kept.w, height: kept.h });
  assert.equal(recovered.scale, normal.scale, "rejecting the 120px flash keeps the normal scale");
}

{
  const board = classicChain(8);
  const urlBar = stabilizeBoardStageSize(felt, { w: felt.w, h: felt.h - 64 });
  const a = layoutClassic(board, { width: felt.w, height: felt.h });
  const b = layoutClassic(board, { width: urlBar.w, height: urlBar.h });
  assert.equal(a.scale, b.scale, "URL-bar height drop does not change Classic tile scale");
}

{
  const board = classicChain(8);
  const north = [tile("N1", 6, 1), tile("N2", 1, 4)];
  const withArms = layoutClassic(board, { width: felt.w, height: felt.h }, { north });
  const lostArms = layoutClassic(board, { width: felt.w, height: felt.h }, { north: [] });
  const spinner = coalescePublicSpinner(
    { id: "6-6", north, south: [] },
    { id: "6-6", north: [], south: [] },
    board
  );
  const coalesced = layoutClassic(board, { width: felt.w, height: felt.h }, {
    north: spinner.north,
  });
  assert.ok(
    Math.abs(withArms.scale - lostArms.scale) > 0.001 || withArms.tiles.length !== lostArms.armTiles.length,
    "dropping spinner arms changes the packed board"
  );
  assert.equal(
    coalesced.scale,
    withArms.scale,
    "Realtime empty-spinner coalesce keeps Classic scale"
  );
}

{
  const board = classicChain(7);
  const preview = optimisticPlayPreview({
    tileId: "0-3",
    end: "left",
    left: 3,
    right: 0,
    orientation: "horizontal",
    destination: "MAIN_LEFT",
  });
  const optimistic = applyOptimisticBoardPreview(board, preview);
  const a = layoutClassic(board, { width: felt.w, height: felt.h });
  const b = layoutClassic(optimistic, { width: felt.w, height: felt.h });
  assert.ok(b.scale <= a.scale + 0.02, "optimistic insert does not inflate global scale");
  assert.ok(
    a.scale - b.scale < 0.22,
    `optimistic left insert must not globally shrink the board (${a.scale} → ${b.scale})`
  );
}

{
  const board = classicChain(8);
  const realtime = {
    matchId: "m1",
    version: 4,
    board,
    spinner: { id: "6-6", north: [], south: [] },
    interactionSource: "public",
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
  };
  const viewer = keepAuthoritativeView(realtime, {
    ...realtime,
    version: 4,
    spinner: { id: "6-6", north: [tile("N1", 6, 1)], south: [] },
    interactionSource: "viewer",
    legalMoves: [{ tileId: "1-2" }],
    canPlay: true,
    myHand: ["1-2"],
  });
  const pubLayout = layoutClassic(board, { width: felt.w, height: felt.h }, {
    north: coalescePublicSpinner(
      { id: "6-6", north: [tile("N1", 6, 1)], south: [] },
      realtime.spinner,
      board
    ).north,
  });
  const viewLayout = layoutClassic(board, { width: felt.w, height: felt.h }, {
    north: viewer.spinner.north,
  });
  assert.ok(
    Math.abs(pubLayout.scale - viewLayout.scale) < 0.08,
    "get_game_view must not cause a whole-board size jump after Realtime"
  );
}

{
  const long = classicChain(16);
  const layout = layoutClassic(long, { width: felt.w, height: felt.h });
  const androidFelt = {
    width: Math.round(android.feltWidth * 0.97),
    height: Math.round(android.feltHeight),
  };
  const androidLayout = layoutClassic(long, androidFelt);
  const turns = countTurns([...layout.tiles, ...(layout.armTiles || [])]);
  assert.ok(layout.scale > 0.2 && layout.scale <= 1, `long Classic scale ${layout.scale}`);
  assert.ok(androidLayout.scale > 0.2 && androidLayout.scale <= 1);
  assert.ok(
    turns >= 1 || layout.scale >= 0.72,
    `long Classic chain must wrap or stay near preferred size (turns=${turns} scale=${layout.scale})`
  );
}

{
  const haitian = resolveGameplayLayout({ width: 390, height: 844 }, { rulesetId: "haitian" });
  const american = resolveGameplayLayout({ width: 390, height: 844 }, { rulesetId: "american" });
  const haitianBoard = layoutClassic(classicChain(6), {
    width: Math.round(haitian.feltWidth * 0.97),
    height: Math.round(haitian.feltHeight),
  }, { rulesetId: "haitian" });
  const americanBoard = layoutClassic(classicChain(6), {
    width: Math.round(american.feltWidth * 0.97),
    height: Math.round(american.feltHeight),
  }, { rulesetId: "american" });
  assert.ok(haitianBoard.scale > 0.2, `Haitian scale ${haitianBoard.scale}`);
  assert.ok(americanBoard.scale > 0.2, `American scale ${americanBoard.scale}`);
}

{
  assert.match(boardJsx, /stabilizeBoardStageSize/);
  assert.match(tableJsx, /coalescePublicSpinner/);
  assert.match(hook, /planRealtimeSessionEvent/);
  assert.match(hook, /paintPublicBoard/);
  // Online play must not board-commit before server accept (incident 369c7279).
  assert.doesNotMatch(
    readFileSync(join(here, "../pages/OnlineGamePage.jsx"), "utf8"),
    /applyOptimisticBoardPreview/
  );
}

console.log("  ✓ Classic board scale stays stable across sync and wraps long chains");
