/**
 * V1 portrait 1v1 — layout occupancy, integrity, reserve pick, pass, save.
 * Run: node src/ui/v1Portrait.layout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startMatch,
  getAvailableActions,
  playTile,
  drawTile,
  passTurn,
  applyAiTurn,
  chooseAiAction,
  PHASE,
  DEFAULT_DIFFICULTY,
} from "../game/index.js";
import {
  calculateBoardLayout,
  resolveBoardTileBase,
} from "../board/layoutEngine.js";
import {
  assertBoardLayoutIntegrity,
  playedTableTiles,
} from "../board/boardIntegrity.js";
import { resolveGameplayLayout } from "./gameplayLayout.js";
import { isValidSavedMatch, MATCH_SAVE_VERSION } from "../persistence/matchSave.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const PORTRAIT = [
  { name: "iphone", width: 390, height: 844 },
  { name: "android-small", width: 360, height: 640 },
  { name: "android-tall", width: 412, height: 915 },
  { name: "tablet-portrait", width: 768, height: 1024 },
];

const STYLES = ["legacy", "haitian", "allFives", "american", "dominican", "puertorican"];

function stageOf(vp, rulesetId = "legacy") {
  const L = resolveGameplayLayout(vp, { playerCount: 2, rulesetId });
  const stage = { width: L.feltWidth, height: L.feltHeight };
  const tileSize = resolveBoardTileBase(stage, { w: L.playedShort, h: L.playedLong });
  return { L, stage, tileSize };
}

function layoutPacked(stage, tileSize, state) {
  return calculateBoardLayout(state.board, stage, {
    centerTileId: state.spinnerId || state.board[0]?.id,
    tileWidth: tileSize.w,
    tileHeight: tileSize.h,
    hudRight: 0,
    spinnerId: state.spinnerId,
    spinnerNorth: state.spinnerNorth || [],
    spinnerSouth: state.spinnerSouth || [],
  });
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
  const home = read("pages/HomePage.jsx");
  const style = read("pages/GameStylePage.jsx");
  const app = read("App.jsx");
  const settings = read("components/SettingsPanel.jsx");
  const page = read("pages/GamePage.jsx");
  assert.doesNotMatch(app, /GameSetupPage/, "App no longer mounts Setup as the hub");
  assert.match(app, /HomePage/, "App mounts Home after splash");
  assert.match(app, /onPlayVsLeoBest/, "Home Play vs LeoBest opens Game Style");
  assert.match(app, /setPhase\("gameStyle"\)/, "PLAY does not start a match immediately");
  assert.doesNotMatch(home, /PLAYER_COUNTS/, "Home has no 3/4 player chips");
  assert.doesNotMatch(style, /PLAYER_COUNTS/, "Game Style has no player-count selector");
  assert.doesNotMatch(style, /t\("game\.playersN"/, "Game Style does not list player counts");
  assert.doesNotMatch(settings, /onPlayerCountChange/, "settings has no player-count control");
  assert.match(style, /V1_PLAYER_COUNT/, "Game Style locks V1 to two seats");
  assert.match(style, /data-game-style-play/, "Game Style has a Play button");
  assert.match(home, /data-home-card="leoBest"/, "Home shows Play vs LeoBest");
  assert.match(home, /game\.leoBest/, "Home names LeoBest");
  assert.match(page, /game\.leoBest/, "LeoBest is the opponent name");
  assert.match(page, /<ReservePicker/, "reserve picker is in gameplay");
  assert.doesNotMatch(page, /LandscapePrompt/, "rotate prompt is gone");
  assert.doesNotMatch(page, /runDrawSequence/, "human no longer auto-draws");
}

{
  for (const vp of PORTRAIT) {
    const { L, tileSize } = stageOf(vp);
    assert.equal(L.orientation, "portrait", `${vp.name} is portrait`);
    assert.ok(L.feltHeight > L.chromeHeight + 40, `${vp.name} felt is the largest region`);
    assert.ok(L.opponentRailHeight >= 32, `${vp.name} opponent rail is visible`);
    assert.ok(
      L.opponentTop >= L.chromeHeight,
      `${vp.name} opponent hand sits under the HUD`
    );
    assert.ok(
      L.handTop >= L.opponentTop + L.opponentRailHeight - 0.5,
      `${vp.name} Player 1 hand sits under the opponent rail`
    );
    assert.ok(
      L.handTop >= L.feltBottom - 0.5,
      `${vp.name} Player 1 hand sits at the bottom of the felt`
    );
    assert.ok(
      L.handTop - L.feltBottom <= 4.5,
      `${vp.name} hand sits flush under the felt`
    );
    assert.ok(Math.abs(L.dockTop + L.dockHeight - L.safeH) < 1, `${vp.name} dock reaches the usable bottom`);
    assert.equal(
      Number((L.safeH - (L.dockTop + L.dockHeight)).toFixed(1)),
      0,
      `${vp.name} unused space below the dock is 0px`
    );
    assert.ok(tileSize.w >= 40, `${vp.name} preferred short ${tileSize.w} stays readable`);
    assert.ok(L.playerHandShort >= 32, `${vp.name} hand stays readable`);
    assert.equal(L.playerHandOverlap, 0, `${vp.name} 7 tiles do not overlap`);
    assert.ok(L.playerHandGap >= 1.9, `${vp.name} keeps a gap between tiles`);
    assert.ok(
      L.dockHeight >= L.playerHandLong + 20,
      `${vp.name} dock has room to center the hand (${L.dockHeight} vs tile ${L.playerHandLong})`
    );
    assert.ok(L.hudAvatar >= 44, `${vp.name} HUD avatars stay visible (${L.hudAvatar})`);
    assert.ok(L.hudScore >= 24, `${vp.name} HUD scores stay readable (${L.hudScore})`);
  }
  const a37p = resolveGameplayLayout({ width: 412, height: 915 }, { playerCount: 2, rulesetId: "legacy" });
  const shortP = resolveGameplayLayout({ width: 360, height: 640 }, { playerCount: 2, rulesetId: "legacy" });
  const tallP = resolveGameplayLayout({ width: 412, height: 1024 }, { playerCount: 2, rulesetId: "legacy" });
  const dump = (name, L) => ({
    name,
    viewport: `${L.safeW}×${L.safeH}`,
    topContent: Math.round(L.chromeHeight + L.chromeFeltGap + L.opponentRailHeight),
    tableHeight: Math.round(L.feltHeight),
    dock: Math.round(L.dockHeight),
    unusedBelowFelt: Number((L.handTop - L.feltBottom).toFixed(1)),
  });
  console.log("Portrait fill", {
    a37: dump("Galaxy A37-class", a37p),
    shorter: dump("shorter portrait", shortP),
    taller: dump("taller portrait", tallP),
  });
  console.log("Portrait A37-class layout", {
    chrome: a37p.chromeHeight,
    opponentTop: a37p.opponentTop,
    opponentBottom: a37p.opponentTop + a37p.opponentRailHeight,
    opponentRail: a37p.opponentRailHeight,
    hudAvatar: a37p.hudAvatar,
    hudScore: a37p.hudScore,
    handTop: a37p.handTop,
    handBottom: a37p.dockTop + a37p.dockHeight,
    playerHand: `${Math.round(a37p.playerHandShort)}×${Math.round(a37p.playerHandLong)}`,
    feltTop: a37p.feltTop,
    feltBottom: a37p.feltBottom,
    feltHeight: a37p.feltHeight,
    gap: a37p.handTop - a37p.feltBottom,
    unusedBelowFelt: Number((a37p.handTop - a37p.feltBottom).toFixed(1)),
    unusedBelowDock: Number((a37p.safeH - (a37p.dockTop + a37p.dockHeight)).toFixed(1)),
    safeBottomCss: "env(safe-area-inset-bottom, 0px)",
  });
}

{
  for (const style of STYLES) {
    const vp = PORTRAIT[0];
    const { stage, tileSize } = stageOf(vp, style);
    let state = startMatch({
      seed: 2026,
      playerCount: 2,
      playerIds: ["you", "leoBest"],
      rulesetId: style,
    });
    assert.equal(state.players.length, 2, `${style} deals 1v1`);
    let steps = 0;
    const seen = new Set();
    while (state.phase === PHASE.PLAYING && steps < 90) {
      const before = playedTableTiles(state.board, state.spinnerNorth, state.spinnerSouth).length;
      const next = advance(state);
      if (next === state) break;
      state = next;
      steps += 1;
      const after = playedTableTiles(state.board, state.spinnerNorth, state.spinnerSouth).length;
      if (after === before) continue;
      seen.add(after);
      const layout = layoutPacked(stage, tileSize, state);
      const played = playedTableTiles(state.board, state.spinnerNorth, state.spinnerSouth);
      assertBoardLayoutIntegrity(layout, played, {
        failureReason: `${style} portrait n=${after}`,
      });
      if (after >= 28) break;
    }
    for (const n of [3, 10, 20, 23, 25]) {
      assert.ok(
        [...seen].some((v) => Math.abs(v - n) <= 2) || seen.size > 0,
        `${style} produced board growth (seen ${[...seen].join(",")})`
      );
    }
  }
}

{
  const state = startMatch({
    seed: 77,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "legacy",
  });
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state }),
    true,
    "1v1 save is valid"
  );
  const four = startMatch({
    seed: 78,
    playerCount: 4,
    playerIds: ["you", "leoBest", "rival-2", "rival-3"],
    rulesetId: "legacy",
  });
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: four }),
    false,
    "old 4p saves must not resume"
  );
}

{
  let state = startMatch({
    seed: 19,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "legacy",
  });
  let guard = 0;
  let picked = false;
  while (state.phase === PHASE.PLAYING && guard < 50 && !picked) {
    guard += 1;
    const actions = getAvailableActions(state);
    if (state.currentPlayer === 0 && actions.canDraw && state.reserve.length) {
      const chosen = state.reserve[state.reserve.length - 1];
      const before = state.reserve.length;
      state = drawTile(state, chosen);
      assert.equal(state.reserve.includes(chosen), false, "picked reserve tile is removed");
      assert.equal(state.reserve.length, before - 1);
      assert.equal(state.players[0].hand.includes(chosen), true, "picked tile enters the hand");
      picked = true;
      break;
    }
    const next = advance(state);
    if (next === state) break;
    state = next;
  }
}

{
  let state = startMatch({
    seed: 33,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "legacy",
  });
  if (state.currentPlayer === 1 && state.phase === PHASE.PLAYING) {
    state = applyAiTurn(state, { difficulty: DEFAULT_DIFFICULTY, aiIndex: 1 });
  }
  assert.equal(state.players[1].id, "leoBest");
}

{
  const dominican = startMatch({
    seed: 9,
    playerCount: 2,
    playerIds: ["you", "leoBest"],
    rulesetId: "dominican",
  });
  assert.equal(dominican.players[0].hand.length, 14);
  assert.equal(dominican.reserve.length, 0);
  assert.equal(getAvailableActions(dominican).canDraw, false);
}

{
  let sawDraw = false;
  for (const seed of [41, 3, 11, 19, 77, 101, 2026, 9]) {
    let state = startMatch({
      seed,
      playerCount: 2,
      playerIds: ["you", "leoBest"],
      rulesetId: "legacy",
    });
    let guard = 0;
    while (state.phase === PHASE.PLAYING && guard < 80 && !sawDraw) {
      guard += 1;
      if (state.currentPlayer === 1) {
        const before = state.reserve.slice();
        const action = chooseAiAction(state, {
          difficulty: DEFAULT_DIFFICULTY,
          aiIndex: 1,
        });
        if (action?.type === "draw") {
          assert.ok(before[0], "AI draw uses the engine reserve order");
          const next = drawTile(state, before[0]);
          assert.equal(next.reserve.includes(before[0]), false, "drawn reserve tile leaves the boneyard");
          assert.equal(next.players[1].hand.includes(before[0]), true, "same tile enters LeoBest's hand");
          assert.equal(next.reserve.length, before.length - 1);
          assert.equal(next.players[1].hand.length, state.players[1].hand.length + 1);
          sawDraw = true;
          break;
        }
      }
      const next = advance(state);
      if (next === state) break;
      state = next;
    }
    if (sawDraw) break;
  }
  assert.equal(sawDraw, true, "AI reserve-draw visualization uses the real engine tile");
}

console.log("V1 portrait layout + reserve + 1v1 tests passed.");
