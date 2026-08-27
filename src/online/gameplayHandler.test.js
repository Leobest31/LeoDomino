/**
 * Online gameplay handler tests — seating, one session, hidden info, CAS.
 * Run: node src/online/gameplayHandler.test.js
 */
import assert from "node:assert/strict";
import { applyOnlineForfeit, getAvailableActions, dealOnlineGame } from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleAdvanceOnlineRound,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleSubmitGameAction,
} from "./gameplayHandler.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function readyMatch(rulesetId = "legacy") {
  return {
    id: MATCH_ID,
    ruleset_id: rulesetId,
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    status: "ready",
  };
}

async function seated(rulesetId = "legacy", createSeed = () => 1001) {
  const store = createMemoryGameStore([readyMatch(rulesetId)]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed,
  });
  return { store, view };
}

{
  const { store, view } = await seated();
  assert.equal(view.viewerSeat, 0);
  assert.equal(view.myHand.length, 7);
  const again = await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 999999,
    body: { seed: 999999 },
  });
  assert.equal(again.version, 0);
  assert.deepEqual(again.handCounts, view.handCounts);
  assert.equal(store.sessions.size, 1);
  assert.equal(store.secrets.get(MATCH_ID).seed, 1001);
  console.log("  ✓ only seated players; one session; client seed ignored");
}

{
  const store = createMemoryGameStore([readyMatch()]);
  await assert.rejects(
    () => handleEnterOnlineMatch({ userId: STRANGER, matchId: MATCH_ID, store }),
    (err) => err.code === "NOT_A_PLAYER"
  );
  await handleEnterOnlineMatch({ userId: PLAYER_A, matchId: MATCH_ID, store, createSeed: () => 1001 });
  await assert.rejects(
    () => handleGetGameView({ userId: STRANGER, matchId: MATCH_ID, store }),
    (err) => err.code === "NOT_A_PLAYER"
  );
  console.log("  ✓ non-player access rejected");
}

{
  const { store } = await seated("legacy");
  const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  const secret = store.secrets.get(MATCH_ID);
  assert.deepEqual(viewA.myHand, secret.engineState.players[0].hand);
  assert.deepEqual(viewB.myHand, secret.engineState.players[1].hand);
  for (const tileId of secret.engineState.players[1].hand) {
    if (!viewA.board || JSON.stringify(viewA.board).includes(tileId)) continue;
    assert.equal(viewA.myHand.includes(tileId), false);
  }
  assert.equal(JSON.stringify(viewA).includes('"reserve":['), false);
  assert.equal(JSON.stringify(viewA).includes(JSON.stringify(secret.engineState.reserve)), false);
  console.log("  ✓ own hand visible; opponent hand and reserve ids hidden");
}

{
  const { store, view } = await seated("legacy");
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer;
  const actor = seat === 0 ? PLAYER_A : PLAYER_B;
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  const next = await handleSubmitGameAction({
    userId: actor,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    action: { type: "play", tileId: move.tileId, end: move.end },
    store,
  });
  assert.equal(next.version, 1);
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].payload.tileId, move.tileId);
  await assert.rejects(
    () =>
      handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: 0,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      }),
    (err) => err.code === "STALE_VERSION"
  );
  console.log("  ✓ version increments once; stale expected_version rejected");
}

{
  const { store, view } = await seated("legacy");
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer;
  const actor = seat === 0 ? PLAYER_A : PLAYER_B;
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
  ]);
  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STALE_VERSION");
  assert.equal(store.actions.length, 1);
  assert.equal(store.sessions.get(MATCH_ID).version, 1);
  console.log("  ✓ concurrent actions cannot both commit");
}

{
  const { store, view } = await seated("legacy");
  const secret = store.secrets.get(MATCH_ID);
  const current = secret.engineState.currentPlayer;
  const other = current === 0 ? PLAYER_B : PLAYER_A;
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  await assert.rejects(
    () =>
      handleSubmitGameAction({
        userId: other,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      }),
    (err) => err.code === "WRONG_TURN"
  );
  console.log("  ✓ handler rejects wrong-turn");
}

{
  let view;
  for (const rulesetId of ["legacy", "haitian", "american"]) {
    const seatedMatch = await seated(rulesetId);
    view = seatedMatch.view;
    assert.equal(view.rulesetId, rulesetId);
    assert.equal(view.reserveCount, 14);
    if (rulesetId === "haitian") {
      assert.equal(view.mustPlayTileId, "6-6");
    }
  }
  void view;
  console.log("  ✓ enter deals Classic / Haitian / American");
}

{
  const { store, view } = await seated("legacy", () => 3);
  let current = view;
  let guard = 0;
  while (current.phase === "playing" && guard < 500) {
    guard += 1;
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
    } else if (current.canDraw) {
      current = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "draw" },
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
  }
  if (current.phase === "roundOver") {
    const advanced = await handleAdvanceOnlineRound({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion: current.version,
      store,
    });
    assert.ok(advanced.phase === "playing" || advanced.phase === "matchOver");
  }
  assert.ok(current.scores);
  console.log("  ✓ play/draw/pass loop and optional advance_round");
}

async function playUntilNotPlaying(store, startView) {
  let current = startView;
  let guard = 0;
  while (current.phase === "playing" && guard < 800) {
    guard += 1;
    const actor = current.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    const actorView = await handleGetGameView({
      userId: actor,
      matchId: MATCH_ID,
      store,
    });
    if (actorView.phase !== "playing") {
      current = actorView;
      break;
    }
    if (actorView.canPlay) {
      const move = actorView.legalMoves[0];
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      });
    } else if (actorView.canDraw) {
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: "draw" },
        store,
      });
    } else if (actorView.canPass) {
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: "pass" },
        store,
      });
    } else {
      break;
    }
    current = await handleGetGameView({
      userId: actor,
      matchId: MATCH_ID,
      store,
    });
  }
  return current;
}

{
  const { store, view } = await seated("legacy", () => 3);
  const ended = await playUntilNotPlaying(store, view);
  assert.equal(ended.phase, "roundOver");
  assert.ok(ended.board.length > 0);
  const scores = ended.scores.slice();
  store.enableCommitYield();
  const raced = await Promise.allSettled([
    handleAdvanceOnlineRound({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion: ended.version,
      store,
    }),
    handleAdvanceOnlineRound({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: ended.version,
      store,
    }),
  ]);
  const fulfilled = raced.filter((row) => row.status === "fulfilled");
  const rejected = raced.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STALE_VERSION");
  const advanced = fulfilled[0].value;
  assert.equal(advanced.phase, "playing");
  assert.equal(advanced.round, ended.round + 1);
  assert.deepEqual(advanced.board, []);
  assert.equal(advanced.spinner?.id ?? null, null);
  assert.deepEqual(advanced.scores, scores);
  const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(viewA.version, advanced.version);
  assert.equal(viewB.version, advanced.version);
  assert.deepEqual(viewA.board, []);
  assert.deepEqual(viewB.board, []);
  assert.deepEqual(viewA.scores, scores);
  assert.deepEqual(viewB.scores, scores);
  await assert.rejects(
    () =>
      handleAdvanceOnlineRound({
        userId: PLAYER_B,
        matchId: MATCH_ID,
        expectedVersion: ended.version,
        store,
      }),
    (err) => err.code === "STALE_VERSION"
  );
  await assert.rejects(
    () =>
      handleAdvanceOnlineRound({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: advanced.version,
        store,
      }),
    (err) => err.code === "ADVANCE_NOT_ALLOWED"
  );
  const still = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  assert.equal(still.version, advanced.version);
  assert.deepEqual(still.board, []);
  console.log("  ✓ next round clears board for both seats; duplicate advance rejected");
}

{
  let seed = 0;
  let opener = 0;
  let other = 1;
  for (let s = 1; s <= 400; s += 1) {
    const { state } = dealOnlineGame({
      rulesetId: "legacy",
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
      seed: s,
    });
    if (state.mustPlayTileId !== "6-6") continue;
    opener = state.currentPlayer;
    other = opener === 0 ? 1 : 0;
    if (!state.players[other].hand.includes("2-6")) continue;
    seed = s;
    break;
  }
  assert.ok(seed, "need Classic seed with 6-6 opener and 2-6 in the other hand");
  const { store } = await seated("legacy", () => seed);
  const openerId = opener === 0 ? PLAYER_A : PLAYER_B;
  const otherId = other === 0 ? PLAYER_A : PLAYER_B;
  const before = await handleGetGameView({ userId: openerId, matchId: MATCH_ID, store });
  const afterSix = await handleSubmitGameAction({
    userId: openerId,
    matchId: MATCH_ID,
    expectedVersion: before.version,
    action: { type: "play", tileId: "6-6", end: "right" },
    store,
  });
  assert.equal(afterSix.board[0].id, "6-6");
  assert.equal(afterSix.canPlay, false);
  const otherView = await handleGetGameView({ userId: otherId, matchId: MATCH_ID, store });
  assert.equal(otherView.currentSeat, other);
  assert.equal(otherView.viewerSeat, other);
  assert.equal(otherView.canPlay, true);
  assert.ok(otherView.legalMoves.some((move) => move.tileId === "2-6"));
  const afterTwo = await handleSubmitGameAction({
    userId: otherId,
    matchId: MATCH_ID,
    expectedVersion: otherView.version,
    action: { type: "play", tileId: "2-6", end: "right" },
    store,
  });
  assert.ok(afterTwo.board.some((tile) => tile.id === "2-6"));
  const againA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const againB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(againA.version, againB.version);
  assert.deepEqual(
    againA.board.map((tile) => tile.id),
    againB.board.map((tile) => tile.id)
  );
  console.log("  ✓ handler 6-6 then 2-6: turn, legal moves, both views match");
}

{
  const { store, view } = await seated("legacy", () => 2001);
  const started = Date.now();
  const move = view.legalMoves[0];
  const played = await handleSubmitGameAction({
    userId: view.currentSeat === 0 ? PLAYER_A : PLAYER_B,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    action: { type: "play", tileId: move.tileId, end: move.end },
    store,
    trace: true,
  });
  const elapsed = Date.now() - started;
  assert.ok(played._timings, "trace timings attached");
  assert.ok(played._timings.edgeTotalMs <= elapsed + 5);
  assert.ok(played.board.some((tile) => tile.id === move.tileId));
  console.log(
    `  ✓ in-process play timings edgeTotalMs=${played._timings.edgeTotalMs} validation=${played._timings.edgeReceivedToValidatedMs} commit=${played._timings.edgeValidatedToCommitMs}`
  );
}

{
  const { store, view } = await seated("legacy", () => 2001);
  let current = view;
  let moves = 0;
  while (current.phase === "playing" && moves < 20) {
    const actor = current.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    let result;
    if (current.canPlay) {
      const move = current.legalMoves[0];
      result = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      });
    } else if (current.canDraw) {
      result = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "draw" },
        store,
      });
    } else if (current.canPass) {
      result = await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: current.version,
        action: { type: "pass" },
        store,
      });
    } else {
      break;
    }
    moves += 1;
    if (result.phase === "roundOver" && moves < 15) {
      const advanced = await handleAdvanceOnlineRound({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: result.version,
        store,
      });
      const starter = advanced.currentSeat === 0 ? PLAYER_A : PLAYER_B;
      current = await handleGetGameView({ userId: starter, matchId: MATCH_ID, store });
      continue;
    }
    const nextActor = result.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    current = await handleGetGameView({ userId: nextActor, matchId: MATCH_ID, store });
    assert.equal(current.version, result.version);
    assert.deepEqual(
      current.board.map((tile) => tile.id),
      result.board.map((tile) => tile.id)
    );
  }
  assert.ok(moves >= 15, `15+ alternating actions using submit result, got ${moves}`);
  console.log("  ✓ 15+ handler moves reuse submit snapshot; seats share public version/board");
}

{
  const { store, view } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const applied = applyOnlineForfeit(secret.engineState, 0);
  secret.engineState = applied.state;
  store.matches.get(MATCH_ID).status = "finished";
  const session = store.sessions.get(MATCH_ID);
  session.status = "match_over";
  session.phase = "matchOver";
  session.matchWinnerSeat = 1;
  session.roundResult = applied.state.roundResult;
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(viewB.matchWinnerSeat, 1);
  assert.equal(viewB.roundResult.reason, "forfeit");
  const move = view.legalMoves[0];
  await assert.rejects(
    () =>
      handleSubmitGameAction({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      }),
    (err) => err.code === "MATCH_NOT_ELIGIBLE"
  );
  console.log("  ✓ forfeit ends match; later gameplay is rejected");
}

console.log("  ✓ gameplayHandler");
