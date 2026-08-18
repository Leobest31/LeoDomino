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
  const setup = read("pages/GameSetupPage.jsx");
  const settings = read("components/SettingsPanel.jsx");
  const page = read("pages/GamePage.jsx");
  assert.doesNotMatch(app, /GameSetupPage/, "App no longer mounts Setup as the hub");
  assert.match(app, /HomePage/, "App mounts Home after splash");
  assert.match(app, /onPlayVsLeoBest/, "Home Play vs LeoBest opens Game Style");
  assert.match(app, /setPhase\("gameStyle"\)/, "PLAY does not start a match immediately");
  assert.doesNotMatch(home, /PLAYER_COUNTS/, "Home has no 3/4 player chips");
  assert.doesNotMatch(style, /PLAYER_COUNTS/, "Game Style has no player-count selector");
  assert.doesNotMatch(style, /t\("game\.playersN"/, "Game Style does not list player counts");
  assert.doesNotMatch(setup, /PLAYER_COUNTS/, "setup has no 3/4 player chips");
  assert.doesNotMatch(setup, /t\("game\.playersN"/, "setup does not list player counts");
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
    assert.ok(tileSize.w >= 40, `${vp.name} preferred short ${tileSize.w} stays readable`);
    assert.ok(L.playerHandShort >= 26, `${vp.name} hand stays touchable`);
  }
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

console.log("V1 portrait layout + reserve + 1v1 tests passed.");
