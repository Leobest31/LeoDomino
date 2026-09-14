/**
 * Regression for testers freeze 2026-09-02 match 49c608c6.
 * Haitian rated: after drawUntilPlayable the actor had a legal play, no play
 * was persisted, timeout skipTurned, then the waiter forfeited.
 * Run: node src/online/onlineMatchFreeze.incident.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOnlineAction,
  applyTimeoutResolution,
  dealOnlineGame,
  getAvailableActions,
  ONLINE_ACTION_DRAW,
  ONLINE_ACTION_PLAY,
} from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleAdvanceOnlineRound,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
} from "./gameplayHandler.js";
import { onlineActionDiag } from "./onlineActionDiag.js";
import {
  asViewerSnapshot,
  keepAuthoritativeView,
  mergeRealtimeSessionView,
  shouldRefreshViewerAfterRealtime,
} from "./onlineTable.js";
import { planPlayingHydrateTick } from "./playingHydrate.js";
import { TURN_TIMEOUT_MS } from "./turnTimeout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(join(root, "hooks/useOnlineMatch.js"), "utf8");
const handler = readFileSync(join(root, "online/gameplayHandler.js"), "utf8");

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "49c608c6-394f-45d3-969b-380290d15eb7";

function readyMatch() {
  return {
    id: MATCH_ID,
    ruleset_id: "haitian",
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    status: "ready",
  };
}

function realtimePayload(session) {
  return {
    table: "game_sessions",
    new: {
      version: session.version,
      current_seat: session.currentSeat ?? session.current_seat,
      phase: session.phase,
      status: session.status,
      round: session.round,
      board: session.board,
      spinner: session.spinner,
      hand_counts: session.handCounts ?? session.hand_counts,
      reserve_count: session.reserveCount ?? session.reserve_count,
      scores: session.scores,
    },
  };
}

async function playUntil(store, userId, predicate, limit = 80) {
  for (let i = 0; i < limit; i += 1) {
    const view = await handleGetGameView({ userId, matchId: MATCH_ID, store });
    if (view.phase === "matchOver" || view.status === "match_over") return view;
    if (view.phase === "roundOver" || view.status === "round_over") {
      await handleAdvanceOnlineRound({
        userId,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        store,
      });
      continue;
    }
    if (view.phase !== "playing") return view;
    if (predicate(view)) return view;
    const actor = view.currentSeat === 0 ? PLAYER_A : PLAYER_B;
    const actorView = await handleGetGameView({ userId: actor, matchId: MATCH_ID, store });
    if (actorView.canPlay && actorView.legalMoves[0]) {
      const move = actorView.legalMoves[0];
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
        store,
      });
      continue;
    }
    if (actorView.canDraw) {
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: ONLINE_ACTION_DRAW },
        store,
      });
      continue;
    }
    if (actorView.canPass) {
      await handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: actorView.version,
        action: { type: "pass" },
        store,
      });
      continue;
    }
    throw new Error("no legal action while trying to reach freeze shape");
  }
  throw new Error("did not reach freeze shape");
}

{
  const row = onlineActionDiag("rejected", {
    matchId: MATCH_ID,
    playerId: PLAYER_A,
    expectedVersion: 71,
    serverVersion: 71,
    serverTurn: 0,
    actionType: "play",
    failureStage: "rejected",
  });
  assert.equal(row.match_id, MATCH_ID);
  assert.equal(row.player_id, PLAYER_A);
  assert.equal(row.expected_version, 71);
  assert.equal(row.server_version, 71);
  assert.equal(row.client_known_version, 71);
  assert.equal(row.server_turn, 0);
  assert.equal(row.action_type, "play");
  assert.equal(row.failure_stage, "rejected");
  assert.equal(JSON.stringify(row).includes("1-2"), false);
  assert.match(handler, /onlineActionDiag/);
  console.log("  ✓ freeze diagnostics carry match/player/version/turn/stage without secrets");
}

{
  const { state } = dealOnlineGame({
    rulesetId: "haitian",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 721450492,
  });
  let next = state;
  let draws = 0;
  for (let i = 0; i < 40; i += 1) {
    const available = getAvailableActions(next);
    if (available.canPlay && draws >= 1) break;
    if (available.canDraw) {
      next = applyOnlineAction(next, { seat: next.currentPlayer, action: { type: ONLINE_ACTION_DRAW } }).state;
      draws += 1;
      continue;
    }
    if (available.canPlay) {
      const move = available.legalMoves[0];
      next = applyOnlineAction(next, {
        seat: next.currentPlayer,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }).state;
      draws = 0;
      continue;
    }
    break;
  }
  const afterDraws = getAvailableActions(next);
  if (afterDraws.canPlay) {
    const beforeSeat = next.currentPlayer;
    const beforeMoves = afterDraws.legalMoves.length;
    assert.ok(beforeMoves > 0, "drawUntilPlayable left a legal play");
    const timed = applyTimeoutResolution(next, { timeoutStrikes: [0, 0] });
    assert.equal(timed.safePayload.timedOutSeat, beforeSeat);
    assert.equal(timed.safePayload.strike, 1);
    assert.ok(timed.safePayload.autoPlay || timed.safePayload.autoPass || timed.safePayload.autoDraw >= 1);
    const after = getAvailableActions(timed.state);
    if (timed.state.phase === "playing") {
      assert.equal(timed.state.currentPlayer, beforeSeat === 0 ? 1 : 0);
      assert.ok(
        after.canPlay || after.canDraw || after.canPass,
        "timeout auto-complete must let the next seat act"
      );
    }
  }
  console.log("  ✓ Haitian legal-play timeout auto-completes and hands the next seat a playable turn");
}

{
  const store = createMemoryGameStore([readyMatch()]);
  const first = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 721450492,
  });
  assert.equal(first.rulesetId, "haitian");
  await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 999,
  });

  const afterDraws = await playUntil(
    store,
    PLAYER_A,
    (view) => view.canDraw === false && view.canPlay === true && view.round >= 1 && (view.board?.length || 0) >= 1
  );
  const actorId = afterDraws.currentSeat === 0 ? PLAYER_A : PLAYER_B;
  const waiterId = actorId === PLAYER_A ? PLAYER_B : PLAYER_A;
  const actorView = await handleGetGameView({ userId: actorId, matchId: MATCH_ID, store });
  const waiterBefore = await handleGetGameView({ userId: waiterId, matchId: MATCH_ID, store });
  assert.equal(actorView.canPlay, true);
  assert.ok(actorView.legalMoves.length > 0);
  const versionBeforePlay = actorView.version;

  const waiterStale = asViewerSnapshot({
    ...waiterBefore,
    version: Math.max(0, versionBeforePlay - 1),
  });
  const session = store.sessions.get(MATCH_ID);
  const missed = mergeRealtimeSessionView(waiterStale, realtimePayload(session));
  assert.equal(
    shouldRefreshViewerAfterRealtime(waiterStale, missed, { busy: true, inFlightBaseVersion: versionBeforePlay - 1 }),
    false,
    "busy +1 still skips the echo fetch (HTTP is supposed to supply it)"
  );
  const hydrate = planPlayingHydrateTick(missed, { busy: false });
  assert.equal(hydrate.action, "refresh", "poll must recover after busy skip / missed Realtime");

  const waiterHydrated = await handleGetGameView({ userId: waiterId, matchId: MATCH_ID, store });
  const waiterKept = keepAuthoritativeView(missed, waiterHydrated);
  assert.equal(waiterKept.version, actorView.version);
  assert.equal(waiterKept.currentSeat, actorView.currentSeat);

  const move = actorView.legalMoves[0];
  const played = await handleSubmitGameAction({
    userId: actorId,
    matchId: MATCH_ID,
    expectedVersion: actorView.version,
    action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
    store,
  });
  assert.equal(played.version, versionBeforePlay + 1);
  const plays = store.actions.filter((row) => row.actionType === ONLINE_ACTION_PLAY && row.version === played.version);
  assert.equal(plays.length, 1, "a valid move advances authoritative state exactly once");

  const actorAfter = await handleGetGameView({ userId: actorId, matchId: MATCH_ID, store });
  const waiterAfter = await handleGetGameView({ userId: waiterId, matchId: MATCH_ID, store });
  assert.equal(actorAfter.version, waiterAfter.version);
  assert.equal(actorAfter.currentSeat, waiterAfter.currentSeat);
  assert.ok(
    actorAfter.phase !== "playing" || actorAfter.currentSeat !== afterDraws.currentSeat,
    "next player can act"
  );

  const staleHydrate = keepAuthoritativeView(waiterAfter, waiterHydrated);
  assert.equal(staleHydrate.version, waiterAfter.version);
  assert.equal(staleHydrate.version > waiterHydrated.version, true);

  const nextActor = actorAfter.currentSeat === 0 ? PLAYER_A : PLAYER_B;
  const nextView = await handleGetGameView({ userId: nextActor, matchId: MATCH_ID, store });
  if (nextView.phase === "playing") {
    assert.equal(
      Boolean(nextView.canPlay || nextView.canDraw || nextView.canPass),
      true,
      "no permanent waiting/frozen state"
    );
  }

  console.log("  ✓ valid Haitian play after draws converges both seats; hydrate recovers missed Realtime");
}

{
  const store = createMemoryGameStore([readyMatch()]);
  await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 721450492,
  });
  const view = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const session = store.sessions.get(MATCH_ID);
  session.turnDeadlineAt = new Date(Date.now() - 1000).toISOString();
  store.sessions.set(MATCH_ID, session);
  const timed = await handleResolveTurnTimeout({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    store,
  });
  assert.ok(timed.version > view.version);
  const next = await handleGetGameView({
    userId: timed.currentSeat === 0 ? PLAYER_A : PLAYER_B,
    matchId: MATCH_ID,
    store,
  });
  if (next.phase === "playing") {
    assert.equal(Boolean(next.canPlay || next.canDraw || next.canPass), true);
  }
  console.log("  ✓ reconnect/hydrate after timeout is a live turn, not a freeze");
}

{
  assert.ok(TURN_TIMEOUT_MS === 30_000);
  assert.match(hook, /planPlayingHydrateTick/);
  assert.match(hook, /hasCoherentInteraction\(viewRef\.current\)/);
  assert.match(hook, /refreshView\(\{ force: true \}\)/);
  console.log("  ✓ playing hydrate poll is wired; 30s timeout unchanged");
}
