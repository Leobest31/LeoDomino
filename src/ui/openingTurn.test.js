/**
 * Forced-opening HUD / hand UX — Classic, Haitian, American.
 * Display only. Does not change engine legality or timeout skipTurn.
 *
 * Run: node src/ui/openingTurn.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { translate } from "../i18n/translate.js";
import { loadAllCatalogs } from "../i18n/locales/loadCatalog.js";
import { SUPPORTED_LOCALES } from "../i18n/config.js";
import {
  forcedOpeningTileId,
  handTileIsInteractable,
  openingTurnStatus,
} from "./openingTurn.js";
import {
  HAITIAN_OPENING_TILE_ID,
  applyOnlineAction,
  dealOnlineGame,
  projectGameView,
  ONLINE_ACTION_PLAY,
} from "../online/gameAuthority.js";
import { asViewerSnapshot, draggableTileIds, onlineDragGate } from "../online/onlineTable.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function tFor(catalogs, code) {
  const messages = catalogs[code];
  return (key, vars) =>
    translate({
      messages,
      fallbacks: [catalogs.ht],
      key,
      vars,
      intlLocale: code,
    });
}

function viewerOf(state, seat, version = 0) {
  return asViewerSnapshot(projectGameView(state, { matchId: "open-1", viewerSeat: seat, version }));
}

function deal(rulesetId, seed = 2001) {
  return dealOnlineGame({
    rulesetId,
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed,
  }).state;
}

function playForcedOpen(state) {
  const tileId = state.mustPlayTileId;
  assert.ok(tileId, "expected a forced opening tile");
  const move = { type: ONLINE_ACTION_PLAY, tileId, end: "right" };
  return applyOnlineAction(state, { seat: state.currentPlayer, action: move }).state;
}

{
  assert.equal(forcedOpeningTileId({ isTurn: false, mustPlayTileId: "2-2" }), null);
  assert.equal(forcedOpeningTileId({ isTurn: true, mustPlayTileId: null }), null);
  assert.equal(forcedOpeningTileId({ isTurn: true, mustPlayTileId: "2-2" }), "2-2");
  assert.equal(
    handTileIsInteractable({ isTurn: true, mustPlayTileId: "2-2", tileId: "2-2" }),
    true
  );
  assert.equal(
    handTileIsInteractable({ isTurn: true, mustPlayTileId: "2-2", tileId: "3-6" }),
    false
  );
  assert.equal(
    handTileIsInteractable({ isTurn: true, mustPlayTileId: null, tileId: "3-6" }),
    true,
    "after mustPlayTileId clears, this helper does not restrict later-turn tiles"
  );
  assert.equal(
    handTileIsInteractable({
      isTurn: true,
      mustPlayTileId: "2-2",
      tileId: "2-2",
      legalMoves: [{ tileId: "0-0", end: "right" }],
    }),
    false,
    "required tile is not interactable unless it is in the returned legalMoves"
  );
}

const catalogs = await loadAllCatalogs();
const expectedCopy = {
  en: { tile: "2-2", text: "Play 2-2 to open the round." },
  ht: { tile: "2-2", text: "Jwe 2-2 pou louvri wo a." },
  fr: { tile: "2-2", text: "Jouez 2-2 pour ouvrir la manche." },
  es: { tile: "2-2", text: "Juega 2-2 para abrir la ronda." },
  pt: { tile: "2-2", text: "Jogue 2-2 para abrir a rodada." },
};

for (const { code } of SUPPORTED_LOCALES) {
  const t = tFor(catalogs, code);
  const text = openingTurnStatus(t, { isTurn: true, mustPlayTileId: "2-2" });
  assert.equal(text, expectedCopy[code].text, `${code} opening copy`);
  assert.ok(text.includes("2-2"), `${code} interpolates the required tile`);
  assert.equal(openingTurnStatus(t, { isTurn: false, mustPlayTileId: "2-2" }), null);
  assert.equal(openingTurnStatus(t, { isTurn: true, mustPlayTileId: null }), null);
  console.log(`  ✓ ${code} — ${text}`);
}

function assertForcedOpening(rulesetId, expectedTile = null) {
  const state = deal(rulesetId);
  const starter = state.currentPlayer;
  const other = starter === 0 ? 1 : 0;
  const must = state.mustPlayTileId;
  assert.ok(must, `${rulesetId} opening has mustPlayTileId`);
  if (expectedTile) assert.equal(must, expectedTile);
  assert.ok(state.players[starter].hand.includes(must), `${rulesetId} opener holds ${must}`);

  const starterView = viewerOf(state, starter);
  const otherView = viewerOf(state, other);
  assert.equal(starterView.mustPlayTileId, must);
  assert.equal(otherView.mustPlayTileId, null, `${rulesetId} opponent view hides mustPlayTileId`);

  const t = tFor(catalogs, "en");
  assert.equal(
    openingTurnStatus(t, { isTurn: true, mustPlayTileId: starterView.mustPlayTileId }),
    `Play ${must} to open the round.`
  );
  assert.equal(
    openingTurnStatus(t, { isTurn: true, mustPlayTileId: otherView.mustPlayTileId }),
    null
  );

  for (const tileId of starterView.myHand) {
    const interactable = handTileIsInteractable({
      isTurn: true,
      mustPlayTileId: starterView.mustPlayTileId,
      tileId,
      legalMoves: starterView.legalMoves,
    });
    if (tileId === must) {
      assert.equal(interactable, true, `${rulesetId} required ${must} remains playable`);
      assert.equal(
        onlineDragGate({
          isHumanTurn: true,
          busy: false,
          legalMoves: starterView.legalMoves,
          tileId,
        }),
        "ok"
      );
    } else {
      assert.equal(interactable, false, `${rulesetId} ${tileId} is not interactable`);
      assert.equal(
        onlineDragGate({
          isHumanTurn: true,
          busy: false,
          legalMoves: starterView.legalMoves,
          tileId,
        }),
        "not_legal"
      );
    }
  }
  assert.deepEqual(draggableTileIds(starterView), [must]);
  assert.deepEqual(draggableTileIds(otherView), []);
  assert.equal(
    starterView.legalMoves.every((move) => move.tileId === must),
    true,
    `${rulesetId} legalMoves stay limited to the required tile (server legality unchanged)`
  );

  const opened = playForcedOpen(state);
  assert.equal(opened.mustPlayTileId, null, `${rulesetId} lock clears after the required play`);
  const nextSeat = opened.currentPlayer;
  const nextView = viewerOf(opened, nextSeat, 1);
  assert.equal(nextView.mustPlayTileId, null);
  assert.equal(
    openingTurnStatus(t, { isTurn: true, mustPlayTileId: nextView.mustPlayTileId }),
    null,
    `${rulesetId} HUD returns to Your turn after mustPlayTileId clears`
  );
  for (const tileId of nextView.myHand) {
    assert.equal(
      handTileIsInteractable({
        isTurn: true,
        mustPlayTileId: nextView.mustPlayTileId,
        tileId,
        legalMoves: nextView.legalMoves,
      }),
      true,
      `${rulesetId} later-turn ${tileId} is not opening-restricted`
    );
  }
  console.log(`  ✓ ${rulesetId} forced opening ${must}`);
}

assertForcedOpening("legacy");
assertForcedOpening("haitian", HAITIAN_OPENING_TILE_ID);
assertForcedOpening("american");

{
  const online = read("pages/OnlineGamePage.jsx");
  const game = read("pages/GamePage.jsx");
  const panel = read("components/PlayerPanel.jsx");
  const table = read("components/GameTable.jsx");
  assert.match(online, /openingTurnStatus/);
  assert.match(online, /mustPlayTileId=\{mustPlayTileId\}/);
  assert.match(game, /openingTurnStatus/);
  assert.match(game, /mustPlayTileId=\{mustPlayTileId\}/);
  assert.match(read("ui/openingTurn.js"), /playToOpenRound/);
  assert.match(panel, /handTileIsInteractable/);
  assert.match(panel, /data-hand-interactable/);
  assert.match(panel, /data-must-play/);
  assert.match(panel, /playable=\{playable\}/);
  assert.match(table, /data-opening-must-play/);
  assert.doesNotMatch(read("game/rules/drawDominoes.js"), /playToOpenRound/);
  assert.doesNotMatch(read("online/gameAuthority.js"), /playToOpenRound/);
}

console.log("  ✓ opening-turn UX (Classic / Haitian / American)");
