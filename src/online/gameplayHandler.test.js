/**
 * Online gameplay handler tests — seating, one session, hidden info, CAS.
 * Run: node src/online/gameplayHandler.test.js
 */
import assert from "node:assert/strict";
import { applyOnlineForfeit, applyOnlineAction, getAvailableActions, dealOnlineGame } from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleAdvanceOnlineRound,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
} from "./gameplayHandler.js";
import { TURN_TIMEOUT_MS } from "./turnTimeout.js";

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
  const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(viewB.matchWinnerSeat, 1);
  assert.equal(viewA.matchWinnerSeat, 1);
  assert.equal(viewB.roundResult.reason, "forfeit");
  assert.equal(viewA.roundResult.reason, "forfeit");
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

function expireTurn(store) {
  const session = store.sessions.get(MATCH_ID);
  session.turnDeadlineAt = new Date(Date.now() - 25).toISOString();
}

{
  const { store, view } = await seated();
  assert.ok(view.turnDeadlineAt);
  const remaining = Date.parse(view.turnDeadlineAt) - Date.parse(view.serverNow);
  assert.ok(remaining > 55_000 && remaining <= TURN_TIMEOUT_MS + 50);
  assert.deepEqual(view.timeoutStrikes, [0, 0]);
  const actor = view.currentSeat === 0 ? PLAYER_A : PLAYER_B;
  const move = view.legalMoves[0];
  const shortDeadline = new Date(Date.now() + 30_000).toISOString();
  store.sessions.get(MATCH_ID).turnDeadlineAt = shortDeadline;
  const played = await handleSubmitGameAction({
    userId: actor,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    action: { type: "play", tileId: move.tileId, end: move.end },
    store,
  });
  assert.notEqual(played.currentSeat, view.currentSeat);
  assert.notEqual(played.turnDeadlineAt, shortDeadline);
  const afterPlayRemaining = Date.parse(played.turnDeadlineAt) - Date.parse(played.serverNow);
  assert.ok(afterPlayRemaining > 55_000 && afterPlayRemaining <= TURN_TIMEOUT_MS + 50);
  console.log("  ✓ turn starts with 60s deadline; legal play resets next player's deadline");
}

{
  const { store, view } = await seated();
  let current = view;
  let guard = 0;
  while (current.phase === "playing" && !current.canDraw && guard < 80) {
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
    const shortDeadline = new Date(Date.now() + 40_000).toISOString();
    store.sessions.get(MATCH_ID).turnDeadlineAt = shortDeadline;
    const actor = current.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    const drawn = await handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: current.version,
      action: { type: "draw" },
      store,
    });
    assert.equal(drawn.currentSeat, current.currentSeat);
    assert.equal(drawn.turnDeadlineAt, shortDeadline);
    console.log("  ✓ draw on the same seat keeps the existing deadline");
  } else {
    console.log("  ✓ draw on the same seat keeps the existing deadline (no draw in this deal)");
  }
}

{
  const { store, view } = await seated();
  const refreshed = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  assert.equal(refreshed.turnDeadlineAt, view.turnDeadlineAt);
  console.log("  ✓ refresh/reconnect keeps the same server deadline");
}

{
  const { store, view } = await seated();
  const seat = view.currentSeat;
  async function timeoutCurrentSeat(expectedVersion) {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = {
      ...secret.engineState,
      currentPlayer: seat,
      phase: "playing",
    };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    session.status = "playing";
    expireTurn(store);
    return handleResolveTurnTimeout({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion,
      store,
    });
  }
  const first = await timeoutCurrentSeat(view.version);
  assert.equal(store.actions.at(-1).actionType, "timeout");
  assert.equal(first.roundResult.reason, "timeout_pass");
  assert.equal(first.roundResult.timedOutSeat, seat);
  assert.equal(first.timeoutStrikes[seat], 1);
  const second = await timeoutCurrentSeat(first.version);
  assert.equal(second.roundResult.reason, "timeout_pass");
  assert.equal(second.timeoutStrikes[seat], 2);
  const third = await timeoutCurrentSeat(second.version);
  assert.equal(third.phase, "matchOver");
  assert.equal(third.roundResult.reason, "timeout");
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(store.matches.get(MATCH_ID).status, "finished");
  assert.equal(store.matches.get(MATCH_ID).finish_reason, "timeout");
  assert.equal(third.matchWinnerSeat, seat === 0 ? 1 : 0);
  await assert.rejects(
    () =>
      handleResolveTurnTimeout({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: third.version,
        store,
      }),
    (err) => err.code === "MATCH_NOT_ELIGIBLE"
  );
  console.log("  ✓ third timeout is an authoritative loss; completed match cannot timeout again");
}

{
  const ratedStore = createMemoryGameStore([{ ...readyMatch(), rated: true }]);
  const ratedView = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store: ratedStore,
    createSeed: () => 1001,
  });
  const seat = ratedView.currentSeat;
  async function timeoutSeat(expectedVersion) {
    const secret = ratedStore.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = ratedStore.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    session.status = "playing";
    expireTurn(ratedStore);
    return handleResolveTurnTimeout({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion,
      store: ratedStore,
    });
  }
  const first = await timeoutSeat(ratedView.version);
  const second = await timeoutSeat(first.version);
  const current = await timeoutSeat(second.version);
  assert.equal(current.roundResult.reason, "timeout");
  assert.equal(ratedStore.matches.get(MATCH_ID).finish_reason, "timeout");
  assert.equal(ratedStore.matches.get(MATCH_ID).rated, true);
  assert.equal(
    JSON.stringify(ratedStore.actions.at(-1).payload).includes("newRp"),
    false
  );
  console.log("  ✓ rated timeout loss reuses match finish_reason; no client RP payload");
}

{
  const friendStore = createMemoryGameStore([{ ...readyMatch(), rated: false }]);
  const friendView = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store: friendStore,
    createSeed: () => 1001,
  });
  const seat = friendView.currentSeat;
  async function timeoutSeat(expectedVersion) {
    const secret = friendStore.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = friendStore.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    session.status = "playing";
    expireTurn(friendStore);
    return handleResolveTurnTimeout({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion,
      store: friendStore,
    });
  }
  const first = await timeoutSeat(friendView.version);
  const second = await timeoutSeat(first.version);
  await timeoutSeat(second.version);
  assert.equal(friendStore.matches.get(MATCH_ID).rated, false);
  assert.equal(friendStore.matches.get(MATCH_ID).finish_reason, "timeout");
  console.log("  ✓ unrated/friend timeout loss does not invent an RP path");
}

{
  const { store, view } = await seated();
  expireTurn(store);
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleResolveTurnTimeout({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      store,
    }),
    handleResolveTurnTimeout({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      store,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STALE_VERSION");
  assert.equal(store.actions.filter((row) => row.actionType === "timeout").length, 1);
  await assert.rejects(
    () =>
      handleResolveTurnTimeout({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        store,
      }),
    (err) => err.code === "STALE_VERSION"
  );
  console.log("  ✓ simultaneous timeout requests are idempotent; stale duplicate is rejected");
}

{
  const { store, view } = await seated();
  await assert.rejects(
    () =>
      handleResolveTurnTimeout({
        userId: PLAYER_A,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        store,
      }),
    (err) => err.code === "TIMEOUT_NOT_DUE"
  );
  console.log("  ✓ timeout before the server deadline is a no-op");
}

{
  const { store, view } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  let state = applyOnlineAction(secret.engineState, {
    seat: secret.engineState.currentPlayer,
    action: { type: "play", tileId: move.tileId, end: move.end },
  }).state;
  const seat = state.currentPlayer;
  const candidates = ["0-0", "0-1", "0-2", "1-1", "1-2", "2-2"];
  let blocked = null;
  for (const tileId of candidates) {
    const next = {
      ...state,
      mustPlayTileId: null,
      reserve: [],
      players: state.players.map((player, index) =>
        index === seat ? { ...player, hand: [tileId] } : player
      ),
    };
    if (!getAvailableActions(next).canPlay) {
      blocked = next;
      break;
    }
  }
  assert.ok(blocked, "expected an unplayable constructed hand");
  secret.engineState = blocked;
  store.sessions.get(MATCH_ID).currentSeat = seat;
  store.sessions.get(MATCH_ID).phase = "playing";
  expireTurn(store);
  const resolved = await handleResolveTurnTimeout({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    store,
  });
  assert.deepEqual(resolved.timeoutStrikes, [0, 0]);
  assert.notEqual(resolved.roundResult?.reason, "timeout_pass");
  console.log("  ✓ no legal move timeout does not add a strike");
}

{
  const ONLINE_RULESETS = ["legacy", "haitian", "american"];
  for (const rulesetId of ONLINE_RULESETS) {
    const { store, view } = await seated(rulesetId);
    const starterSeat = view.currentSeat;
    const starterId = starterSeat === 0 ? PLAYER_A : PLAYER_B;
    const nextSeat = starterSeat === 0 ? 1 : 0;
    const nextId = nextSeat === 0 ? PLAYER_A : PLAYER_B;
    assert.ok(store.secrets.get(MATCH_ID).engineState.mustPlayTileId);
    expireTurn(store);
    const timed = await handleResolveTurnTimeout({
      userId: starterId,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      store,
    });
    assert.equal(timed.roundResult.reason, "timeout_pass");
    assert.equal(timed.currentSeat, nextSeat);
    assert.equal(timed.mustPlayTileId, null);
    assert.ok(Date.parse(timed.turnDeadlineAt) > Date.parse(timed.serverNow));
    const remaining = Date.parse(timed.turnDeadlineAt) - Date.parse(timed.serverNow);
    assert.ok(remaining > 55_000 && remaining <= TURN_TIMEOUT_MS + 50);

    const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
    const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
    assert.equal(viewA.version, timed.version);
    assert.equal(viewB.version, timed.version);
    assert.equal(viewA.currentSeat, nextSeat);
    assert.equal(viewB.currentSeat, nextSeat);
    assert.equal(store.secrets.get(MATCH_ID).engineState.mustPlayTileId, null);

    const nextView = nextSeat === 0 ? viewA : viewB;
    const waiterView = nextSeat === 0 ? viewB : viewA;
    assert.equal(nextView.mustPlayTileId, null);
    assert.equal(nextView.canPlay, true);
    assert.ok(nextView.legalMoves.length > 0);
    assert.equal(waiterView.canPlay, false);
    assert.deepEqual(waiterView.legalMoves, []);

    const move = nextView.legalMoves[0];
    const played = await handleSubmitGameAction({
      userId: nextId,
      matchId: MATCH_ID,
      expectedVersion: timed.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    });
    assert.equal(played.version, timed.version + 1);
    assert.ok(played.board.length > 0);
    assert.notEqual(store.actions.at(-1).actionType, "timeout");
  }
  console.log("  ✓ opener timeout → next seat playable; getGameView converges; legal play accepted");
}

console.log("  ✓ gameplayHandler");
