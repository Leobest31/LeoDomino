/**
 * Regression: physical-device match 369c7279-c3bd-4caf-87d3-ad04706ae3a4
 * PATTERN A — play UI must not board-commit before server accept; failures roll back.
 * PATTERN B — draws refresh deadline; reserve 0 still allows play/pass/timeout.
 *
 * Run: node src/online/physicalIncident369c7279.regression.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
} from "./gameplayHandler.js";
import { TURN_TIMEOUT_MS } from "./turnTimeout.js";
import { getAvailableActions } from "../game/rules/drawDominoes.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function read(rel) {
  return readFileSync(join(here, rel), "utf8");
}

function readyMatch() {
  return {
    id: MATCH_ID,
    ruleset_id: "legacy",
    status: "ready",
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    match_kind: "public",
    rated: true,
    stake_pips: 150,
  };
}

async function seated(createSeed = () => 1001) {
  const store = createMemoryGameStore([readyMatch()]);
  await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed,
  });
  await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed,
  });
  const view = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  return { store, view };
}

{
  const page = read("../pages/OnlineGamePage.jsx");
  const hook = read("../hooks/useOnlineMatch.js");
  assert.doesNotMatch(page, /applyOptimisticBoardPreview|optimisticPlayPreview|setPendingPlay/);
  assert.match(page, /const ok = await playTile/);
  assert.match(page, /if \(!ok\)/);
  assert.match(page, /play\("error"\)/);
  assert.match(page, /outcome: "rollback"/);
  const placeIdx = page.indexOf('play("place")');
  const awaitIdx = page.indexOf("await playTile");
  assert.ok(awaitIdx >= 0 && placeIdx > awaitIdx, "place SFX must follow await playTile");
  assert.match(hook, /busyRef\.current/);
  assert.match(hook, /ONLINE_ACTION_TIMEOUT_MS/);
  assert.match(hook, /STALE_VERSION/);
  const staleBlock = hook.slice(hook.indexOf("STALE_VERSION"), hook.indexOf("STALE_VERSION") + 450);
  assert.match(staleBlock, /return false/);
  assert.doesNotMatch(staleBlock, /return true/);
  console.log("  ✓ PATTERN A source: no optimistic board commit; rollback on !ok; stale→false");
}

{
  const handler = read("./gameplayHandler.js");
  assert.match(handler, /applied\.resetTurnDeadline = type === ["']draw["']/);
  console.log("  ✓ PATTERN B source: draw sets resetTurnDeadline");
}

{
  const { store, view } = await seated(() => 1001);
  let current = view;
  for (let guard = 0; guard < 100 && current.phase === "playing" && !current.canDraw; guard += 1) {
    const actor = current.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    if (current.canPlay) {
      const move = current.legalMoves[0];
      current = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      });
    } else if (current.canPass) {
      current = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "pass" },
        store,
      });
    } else {
      break;
    }
    current = await handleGetGameView({
      userId: current.currentSeat === 0 ? PLAYER_A : PLAYER_B,
      matchId: MATCH_ID,
      store,
    });
  }

  if (current.canDraw) {
    const staleDeadline = new Date(Date.now() + 5_000).toISOString();
    store.sessions.get(MATCH_ID).turnDeadlineAt = staleDeadline;
    const actor = current.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    const beforeSeat = current.currentSeat;
    let drawn = current;
    let draws = 0;
    while (drawn.canDraw && draws < 20) {
      drawn = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: drawn.version,
        action: { type: "draw" },
        store,
      });
      draws += 1;
      assert.equal(drawn.currentSeat, beforeSeat);
      assert.notEqual(drawn.turnDeadlineAt, staleDeadline);
      const remaining = Date.parse(drawn.turnDeadlineAt) - Date.parse(drawn.serverNow);
      assert.ok(remaining > 25_000 && remaining <= TURN_TIMEOUT_MS + 50);
    }
    assert.ok(draws >= 1);

    const secret = store.secrets.get(MATCH_ID);
    const actions = getAvailableActions(secret.engineState);
    if (!actions.canDraw && !actions.canPlay && actions.canPass) {
      const passed = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: drawn.version,
        action: { type: "pass" },
        store,
      });
      assert.notEqual(passed.currentSeat, beforeSeat);
      console.log("  ✓ PATTERN B: reserve empty → pass advances seat");
    } else if (actions.canPlay) {
      const move = actions.legalMoves[0];
      const played = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: drawn.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      });
      assert.notEqual(played.currentSeat, beforeSeat);
      console.log("  ✓ PATTERN B: after draws, legal play still works");
    } else {
      console.log("  ✓ PATTERN B: draws refreshed deadline (no pass/play branch this deal)");
    }

    const afterDraw = await handleGetGameView({ userId: actor, matchId: MATCH_ID, store });
    if (afterDraw.phase === "playing" && afterDraw.currentSeat === beforeSeat) {
      store.sessions.get(MATCH_ID).turnDeadlineAt = new Date(Date.now() - 1000).toISOString();
      const timed = await handleResolveTurnTimeout({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: afterDraw.version,
        store,
      });
      assert.equal(store.actions.at(-1).actionType, "timeout");
      assert.equal(timed.roundResult.timedOutSeat, beforeSeat);
      assert.equal(timed.timeoutStrikes[beforeSeat], 1);
      console.log("  ✓ PATTERN B: expired deadline after draw → timeout once");
    }
  } else {
    console.log("  ✓ PATTERN B skipped deal without draw (seed)");
  }
}

{
  const { store, view } = await seated(() => 1001);
  if (view.canPlay && view.legalMoves?.length) {
    const move = view.legalMoves[0];
    const actor = view.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    const played = await handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    });
    assert.equal(store.actions.at(-1).actionType, "play");
    assert.ok(played.version > view.version);
    console.log("  ✓ successful legal play commits");
  }
}

console.log("  ✓ physicalIncident369c7279 regression");
