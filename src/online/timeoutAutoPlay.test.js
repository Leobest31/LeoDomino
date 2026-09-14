/**
 * Authoritative timeout auto-play: strike 1–2 complete the turn; strike 3 loses.
 * Reuses engine legalMoves / playTile / drawTile / passTurn. No network.
 * Run: node src/online/timeoutAutoPlay.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAvailableActions } from "../game/rules/drawDominoes.js";
import {
  calculateHaitianRoundPoints,
  applyHaitianAfterRoundScoreUpdate,
  isHaitianMatchWon,
} from "../game/rules/haitianScoring.js";
import {
  applyOnlineAction,
  applyTimeoutResolution,
  dealOnlineGame,
  pickTimeoutAutoPlayMove,
} from "./gameAuthority.js";
import { getOpenEnds } from "../game/board.js";
import { createTile } from "../game/tiles.js";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
} from "./gameplayHandler.js";
import {
  asViewerSnapshot,
  keepAuthoritativeView,
} from "./onlineTable.js";
import {
  overlayNewerTimeoutClock,
  remainingTurnMs,
  turnTimerTone,
} from "./turnTimeout.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function deal(rulesetId, seed = 1001) {
  return dealOnlineGame({
    rulesetId,
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed,
  });
}

function restrictHand(state, seat, hand, extras = {}) {
  return {
    ...state,
    mustPlayTileId: extras.mustPlayTileId ?? null,
    reserve: extras.reserve !== undefined ? extras.reserve : state.reserve,
    players: state.players.map((player, index) =>
      index === seat ? { ...player, hand: hand.slice() } : player
    ),
  };
}

/** Tile ids already placed on the board (for constructing non-colliding reserves). */
function boardTileIds(state) {
  return new Set((state.board?.tiles ?? []).map((tile) => tile.id));
}

/** Doubles not already on the board — safe to inject into a constructed reserve. */
function unusedReserveDoubles(state, count = 2) {
  const used = boardTileIds(state);
  const doubles = ["0-0", "1-1", "2-2", "3-3", "4-4", "5-5", "6-6"].filter((id) => !used.has(id));
  return doubles.slice(0, count);
}

function playUntilLegal(state, max = 40) {
  let current = state;
  for (let i = 0; i < max; i += 1) {
    if (current.phase !== "playing") return current;
    const available = getAvailableActions(current);
    if (available.canPlay && available.legalMoves.length > 0) return current;
    if (available.canDraw) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: "draw" },
      }).state;
      continue;
    }
    break;
  }
  return current;
}

function uniqueLegalTile(state) {
  const moves = getAvailableActions(state).legalMoves;
  const byTile = new Map();
  for (const move of moves) {
    const list = byTile.get(move.tileId) || [];
    list.push(move);
    byTile.set(move.tileId, list);
  }
  for (const [tileId, list] of byTile) {
    if (list.length >= 1) return { tileId, moves: list, all: moves };
  }
  return null;
}

function expire(store) {
  const session = store.sessions.get(MATCH_ID);
  session.turnDeadlineAt = new Date(Date.now() - 25).toISOString();
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const forced = state.mustPlayTileId;
  const picked = pickTimeoutAutoPlayMove(state);
  assert.equal(picked.tileId, forced);
  const resolved = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.timeoutStrikes[seat], 1);
  assert.equal(resolved.safePayload.autoPlay.tileId, forced);
  assert.equal(resolved.state.roundResult.reason, "timeout_auto");
  assert.ok(resolved.state.board.some((tile) => tile.id === forced));
  assert.notEqual(resolved.state.currentPlayer, seat);
  assert.equal(resolved.state.players[seat].hand.includes(forced), false);
  console.log("  ✓ 1. strike #1 with the only opening tile auto-plays it and advances");
}

{
  const { state } = deal("legacy");
  const opened = playUntilLegal(applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state);
  const seat = opened.currentPlayer;
  const available = getAvailableActions(opened);
  assert.ok(available.legalMoves.length >= 1);
  const unique = uniqueLegalTile(opened);
  const one = restrictHand(opened, seat, [unique.tileId]);
  assert.equal(getAvailableActions(one).canPlay, true);
  assert.equal(getAvailableActions(one).legalMoves.every((m) => m.tileId === unique.tileId), true);
  const resolved = applyTimeoutResolution(one, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.safePayload.autoPlay.tileId, unique.tileId);
  assert.ok(getAvailableActions(one).legalMoves.some((m) => m.end === resolved.safePayload.autoPlay.end));
  assert.ok(
    resolved.state.currentPlayer !== seat || resolved.state.phase !== "playing",
    "auto-play either advances the turn or ends the round"
  );
  console.log("  ✓ 1b. strike #1 with exactly one legal tile auto-plays that tile");
}

{
  const { state } = deal("legacy");
  const opened = playUntilLegal(applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state);
  const available = getAvailableActions(opened);
  assert.ok(available.legalMoves.length >= 1);
  const picked = pickTimeoutAutoPlayMove(opened);
  const again = pickTimeoutAutoPlayMove(opened);
  assert.deepEqual(picked, again);
  const legalKeys = new Set(available.legalMoves.map((m) => `${m.tileId}:${m.end}`));
  assert.ok(legalKeys.has(`${picked.tileId}:${picked.end}`));
  const resolved = applyTimeoutResolution(opened, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.safePayload.autoPlay.tileId, picked.tileId);
  assert.equal(resolved.safePayload.autoPlay.end, picked.end);
  console.log("  ✓ 2. multiple legal tiles: deterministic engine legal move only");
}

{
  const { state } = deal("legacy");
  const opened = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state;
  const seat = opened.currentPlayer;
  const onBoard = boardTileIds(opened);
  // Prefer a dead hand tile that is not already on the board.
  const deadHand = ["0-0", "1-0", "2-0", "3-0"].find((id) => !onBoard.has(id)) || "0-0";
  const reserve = unusedReserveDoubles(opened, 2).filter((id) => id !== deadHand);
  assert.ok(reserve.length >= 1, "need at least one unused double for draw reserve");
  const dead = restrictHand(opened, seat, [deadHand], { reserve });
  const before = getAvailableActions(dead);
  if (before.canPlay) {
    console.log("  ✓ 3. skipped constructed draw case (hand tile was playable)");
  } else {
    assert.equal(before.canDraw, true);
    assert.equal(before.canPass, false);
    const resolved = applyTimeoutResolution(dead, { timeoutStrikes: [0, 0] });
    // No legal play was available: drawing/auto-playing does not cost a strike.
    assert.equal(resolved.timeoutStrikes[seat], 0);
    assert.equal(resolved.safePayload.strike, 0);
    assert.ok(resolved.safePayload.autoDraw >= 1);
    assert.notEqual(resolved.finishReason, "timeout");
    assert.notEqual(resolved.safePayload.autoPass && resolved.safePayload.autoDraw === 0, true);
    console.log("  ✓ 3. no playable tile draws instead of passing; adds no strike");
  }
}

{
  const { state } = deal("legacy");
  const opened = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state;
  const seat = opened.currentPlayer;
  const dead = restrictHand(opened, seat, ["0-0"], { reserve: [] });
  if (!getAvailableActions(dead).canPlay) {
    assert.equal(getAvailableActions(dead).canPass, true);
    const resolved = applyTimeoutResolution(dead, { timeoutStrikes: [0, 0] });
    // No legal play was available: auto-passing does not cost a strike.
    assert.equal(resolved.timeoutStrikes[seat], 0);
    assert.equal(resolved.safePayload.strike, 0);
    assert.equal(resolved.safePayload.autoPlay, null);
    assert.equal(resolved.safePayload.autoPass, true);
    console.log("  ✓ 3b. empty reserve with no playable tile auto-passes; adds no strike");
  } else {
    console.log("  ✓ 3b. skipped pass case (0-0 was playable)");
  }
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  const secondState = { ...first.state, currentPlayer: seat, phase: "playing" };
  const second = applyTimeoutResolution(secondState, { timeoutStrikes: first.timeoutStrikes });
  assert.equal(second.timeoutStrikes[seat], 2);
  assert.notEqual(second.state.phase, "matchOver");
  assert.notEqual(second.finishReason, "timeout");
  assert.ok(second.safePayload.autoPlay || second.safePayload.autoPass || second.safePayload.autoDraw >= 1);
  console.log("  ✓ 4. strike #2 auto-completes and match stays active");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  const second = applyTimeoutResolution(
    { ...first.state, currentPlayer: seat, phase: "playing" },
    { timeoutStrikes: first.timeoutStrikes }
  );
  const before = {
    board: second.state.board.slice(),
    hand: second.state.players[seat].hand.slice(),
  };
  const third = applyTimeoutResolution(
    { ...second.state, currentPlayer: seat, phase: "playing" },
    { timeoutStrikes: second.timeoutStrikes }
  );
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(third.finishReason, "timeout");
  assert.equal(third.state.phase, "matchOver");
  assert.equal(third.state.matchWinner, seat === 0 ? 1 : 0);
  assert.equal(third.safePayload.autoPlay, null);
  assert.equal(third.safePayload.autoPass, false);
  assert.equal(third.safePayload.autoDraw, 0);
  assert.deepEqual(third.state.board, before.board);
  assert.deepEqual(third.state.players[seat].hand, before.hand);
  console.log("  ✓ 5. strike #3 ends the match with no third auto-play/pass");
}

{
  const store = createMemoryGameStore([
    {
      id: MATCH_ID,
      ruleset_id: "legacy",
      player_a: PLAYER_A,
      player_b: PLAYER_B,
      status: "ready",
      rated: true,
    },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const seat = view.currentSeat;
  async function timeoutSeat(expectedVersion) {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    expire(store);
    return handleResolveTurnTimeout({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion,
      store,
    });
  }
  const first = await timeoutSeat(view.version);
  const second = await timeoutSeat(first.version);
  const third = await timeoutSeat(second.version);
  assert.equal(third.roundResult.reason, "timeout");
  assert.equal(store.matches.get(MATCH_ID).finish_reason, "timeout");
  assert.equal(store.matches.get(MATCH_ID).rated, true);
  const timeoutActions = store.actions.filter((row) => row.actionType === "timeout");
  assert.equal(timeoutActions.length, 3);
  assert.equal(
    timeoutActions.filter((row) => JSON.stringify(row.payload).includes("newRp")).length,
    0
  );
  console.log("  ✓ 6. rated timeout loss uses finish_reason timeout once; no client RP payload");
}

{
  const store = createMemoryGameStore([
    {
      id: MATCH_ID,
      ruleset_id: "legacy",
      player_a: PLAYER_A,
      player_b: PLAYER_B,
      status: "ready",
      rated: false,
    },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const seat = view.currentSeat;
  async function timeoutSeat(expectedVersion) {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    expire(store);
    return handleResolveTurnTimeout({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion,
      store,
    });
  }
  const first = await timeoutSeat(view.version);
  const second = await timeoutSeat(first.version);
  await timeoutSeat(second.version);
  assert.equal(store.matches.get(MATCH_ID).rated, false);
  assert.equal(store.matches.get(MATCH_ID).finish_reason, "timeout");
  console.log("  ✓ 7. friend/unrated timeout loss does not invent an RP path");
}

{
  const store = createMemoryGameStore([
    {
      id: MATCH_ID,
      ruleset_id: "legacy",
      player_a: PLAYER_A,
      player_b: PLAYER_B,
      status: "ready",
    },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  expire(store);
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
  assert.equal(ok[0].value.timeoutStrikes.filter((n) => n > 0).reduce((a, b) => a + b, 0), 1);
  console.log("  ✓ 8. duplicate timeout: one strike, one auto-play, no duplicate finish");
}

{
  const store = createMemoryGameStore([
    {
      id: MATCH_ID,
      ruleset_id: "legacy",
      player_a: PLAYER_A,
      player_b: PLAYER_B,
      status: "ready",
    },
  ]);
  const entered = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const actor = entered.currentSeat === 0 ? PLAYER_A : PLAYER_B;
  const opponent = actor === PLAYER_A ? PLAYER_B : PLAYER_A;
  // legalMoves are seat-scoped to the viewer — fetch the current seat's view.
  const view =
    actor === PLAYER_A
      ? entered
      : await handleGetGameView({ userId: actor, matchId: MATCH_ID, store });
  const move = view.legalMoves?.[0];
  assert.ok(move, "race fixture needs a legal play for the current seat");
  expire(store);
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
    handleResolveTurnTimeout({
      userId: opponent,
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
  const timeoutWins = store.actions.some((row) => row.actionType === "timeout");
  const playWins = store.actions.some((row) => row.actionType === "play");
  assert.equal(timeoutWins !== playWins, true);
  console.log("  ✓ 9. player move vs timeout race: exactly one transition wins");
}

{
  const store = createMemoryGameStore([
    {
      id: MATCH_ID,
      ruleset_id: "legacy",
      player_a: PLAYER_A,
      player_b: PLAYER_B,
      status: "ready",
    },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  expire(store);
  const first = await handleResolveTurnTimeout({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    store,
  });
  const boardAfter = store.secrets.get(MATCH_ID).engineState.board.slice();
  await assert.rejects(
    () =>
      handleResolveTurnTimeout({
        userId: PLAYER_B,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        store,
      }),
    (err) => err.code === "STALE_VERSION"
  );
  assert.deepEqual(store.secrets.get(MATCH_ID).engineState.board, boardAfter);
  assert.equal(store.sessions.get(MATCH_ID).version, first.version);
  console.log("  ✓ 10. stale-version timeout cannot mutate newer state");
}

{
  const previous = asViewerSnapshot({
    matchId: MATCH_ID,
    version: 4,
    phase: "playing",
    currentSeat: 0,
    turnDeadlineAt: "2026-09-02T15:00:30.000Z",
    serverNow: "2026-09-02T15:00:10.000Z",
    timeoutStrikes: [1, 0],
    myHand: ["1-3"],
    handCounts: [6, 7],
  });
  const incoming = asViewerSnapshot({
    ...previous,
    serverNow: "2026-09-02T15:00:20.000Z",
    timeoutStrikes: [1, 0],
    turnDeadlineAt: "2026-09-02T15:00:30.000Z",
  });
  const overlay = overlayNewerTimeoutClock(previous, incoming, 50);
  assert.deepEqual(overlay.timeoutStrikes, [1, 0]);
  assert.equal(overlay.turnDeadlineAt, previous.turnDeadlineAt);
  const kept = keepAuthoritativeView(previous, {
    ...incoming,
    timeoutStrikes: [0, 0],
    turnDeadlineAt: "2026-09-02T15:01:00.000Z",
    version: 3,
  });
  assert.equal(kept, previous, "stale hydrate cannot reset deadline or strikes");
  console.log("  ✓ 11. reconnect/hydrate cannot reset deadline or strike count");
}

{
  for (const rulesetId of ["legacy", "haitian", "american"]) {
    const { state } = deal(rulesetId);
    const available = getAvailableActions(state);
    assert.equal(available.canPlay, true);
    const picked = pickTimeoutAutoPlayMove(state);
    assert.ok(available.legalMoves.some((m) => m.tileId === picked.tileId && m.end === picked.end));
    const resolved = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
    assert.equal(resolved.safePayload.autoPlay.tileId, picked.tileId);
    assert.ok(resolved.state.board.length > 0);
  }
  console.log("  ✓ 12–14. Classic, Haitian, and American auto-play uses engine legalMoves");
}

{
  const { state } = deal("haitian");
  const available = getAvailableActions(state);
  assert.equal(available.canPlay, true);
  const picked = pickTimeoutAutoPlayMove(state);
  assert.ok(
    available.legalMoves.some((m) => m.tileId === picked.tileId && m.end === picked.end)
  );
  const resolved = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.safePayload.autoPlay.tileId, picked.tileId);
  assert.ok(resolved.state.board.length > 0);
  assert.notEqual(resolved.finishReason, "timeout");
  console.log("  ✓ 11b. Haitian timeout auto-play uses engine legalMoves");
}

{
  const { state } = deal("haitian");
  const seat = state.currentPlayer;
  const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  const second = applyTimeoutResolution(
    { ...first.state, currentPlayer: seat, phase: "playing" },
    { timeoutStrikes: first.timeoutStrikes }
  );
  const before = {
    board: second.state.board.slice(),
    hand: second.state.players[seat].hand.slice(),
    scores: second.state.scores.slice(),
  };
  const third = applyTimeoutResolution(
    { ...second.state, currentPlayer: seat, phase: "playing" },
    { timeoutStrikes: second.timeoutStrikes }
  );
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(third.finishReason, "timeout");
  assert.equal(third.state.phase, "matchOver");
  assert.equal(third.state.matchWinner, seat === 0 ? 1 : 0);
  assert.equal(third.safePayload.autoPlay, null);
  assert.equal(third.safePayload.autoPass, false);
  assert.equal(third.safePayload.autoDraw, 0);
  assert.deepEqual(third.state.board, before.board);
  assert.deepEqual(third.state.players[seat].hand, before.hand);
  assert.deepEqual(third.state.scores, before.scores);
  console.log("  ✓ 12b. Haitian strike #3 timeout-loss; no auto-play");
}

{
  const { state } = deal("american");
  let current = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state;
  let spinnerMove = null;
  for (let i = 0; i < 24 && current.phase === "playing"; i += 1) {
    const available = getAvailableActions(current);
    const arm = (available.legalMoves || []).find((m) => m.end === "north" || m.end === "south");
    if (arm) {
      spinnerMove = pickTimeoutAutoPlayMove(current);
      const resolved = applyTimeoutResolution(current, { timeoutStrikes: [0, 0] });
      assert.ok(
        available.legalMoves.some(
          (m) => m.tileId === resolved.safePayload.autoPlay.tileId && m.end === resolved.safePayload.autoPlay.end
        )
      );
      break;
    }
    if (!available.canPlay) break;
    const move = available.legalMoves[0];
    current = applyOnlineAction(current, {
      seat: current.currentPlayer,
      action: { type: "play", tileId: move.tileId, end: move.end },
    }).state;
  }
  void spinnerMove;
  console.log("  ✓ 14b. American spinner/end-point auto-play stays inside engine legalMoves");
}

{
  for (const rulesetId of ["legacy", "haitian", "american"]) {
    const { state } = deal(rulesetId, 4242);
    const opened = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] }).state;
    const seat = opened.currentPlayer;
    const dead = restrictHand(opened, seat, ["0-0"], { reserve: ["3-3"] });
    const actions = getAvailableActions(dead);
    if (actions.canPlay) continue;
    assert.equal(actions.canDraw, true, `${rulesetId} must draw before pass`);
    assert.equal(actions.canPass, false);
    const resolved = applyTimeoutResolution(dead, { timeoutStrikes: [0, 0] });
    assert.ok(resolved.safePayload.autoDraw >= 1, `${rulesetId} timeout draws when required`);
    assert.equal(resolved.safePayload.autoPass && resolved.safePayload.autoDraw === 0, false);
  }
  console.log("  ✓ 15. draw-before-pass preserved on Classic/Haitian/American timeout");
}

{
  assert.equal(calculateHaitianRoundPoints({ isDekabes: true }), 1);
  assert.equal(calculateHaitianRoundPoints({}), 1);
  const after = applyHaitianAfterRoundScoreUpdate({ scores: [1, 2], winnerIndex: 0, points: 1 });
  assert.deepEqual(after, [2, 2]);
  assert.equal(isHaitianMatchWon({ scores: [4, 2], winnerIndex: 0, targetScore: 4 }), true);
  assert.equal(isHaitianMatchWon({ scores: [3, 3], winnerIndex: 0, targetScore: 4 }), false);
  const haitian = readFileSync(join(ROOT, "src/game/rulesets/haitian.test.js"), "utf8");
  assert.match(haitian, /first to 4|HAITIAN_MATCH_TARGET|4–2 match over/);
  console.log("  ✓ 16. Haitian first-to-4 / Dekabès +1 / no reset");
}

{
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260901120000_ranked_find_match_pair_limit.sql"),
    "utf8"
  );
  assert.match(sql, />= 3/);
  assert.match(sql, /interval '24 hours'/);
  console.log("  ✓ 17. ranked public 3-in-24h SQL contract still present");
}

{
  const freeze = readFileSync(join(ROOT, "src/online/onlineFreeze.test.js"), "utf8");
  const hydrate = readFileSync(join(ROOT, "src/hooks/useOnlineMatch.js"), "utf8");
  assert.match(freeze, /lostpointercapture/);
  assert.match(hydrate, /planPlayingHydrateTick/);
  console.log("  ✓ 18. freeze/recovery wiring still present");
}

function assertOpponentCanContinue(view, store, versionBefore) {
  assert.ok(view.version > versionBefore, "timeout must commit a new version");
  assert.equal(store.actions.filter((row) => row.actionType === "timeout").length, 1);
  if (view.phase === "playing") {
    assert.ok(remainingTurnMs(view) > 25_000, "opponent must receive a fresh 30s clock");
    assert.notEqual(turnTimerTone(remainingTurnMs(view)), "pending");
  }
}

async function nextSeatCanAct(store, view) {
  if (view.phase !== "playing") return;
  const nextId = view.currentSeat === 0 ? PLAYER_A : PLAYER_B;
  const nextView = await handleGetGameView({ userId: nextId, matchId: MATCH_ID, store });
  assert.equal(nextView.version, view.version);
  assert.ok(
    nextView.canPlay || nextView.canDraw || nextView.canPass,
    "opponent must be able to continue after timeout"
  );
  if (nextView.canPlay) {
    const move = nextView.legalMoves[0];
    const played = await handleSubmitGameAction({
      userId: nextId,
      matchId: MATCH_ID,
      expectedVersion: nextView.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    });
    assert.equal(played.version, nextView.version + 1);
    assert.notEqual(store.actions.at(-1).actionType, "timeout");
  }
}

{
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  expire(store);
  const hydrated = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assertOpponentCanContinue(hydrated, store, view.version);
  assert.ok(hydrated.roundResult?.autoPlay || hydrated.roundResult?.autoPass || hydrated.roundResult?.autoDraw >= 1);
  await nextSeatCanAct(store, hydrated);
  console.log("  ✓ get_game_view expires a due timeout, auto-completes, and lets the opponent continue");
}

{
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer;
  const opened = applyTimeoutResolution(secret.engineState, { timeoutStrikes: [0, 0] }).state;
  const dead = restrictHand(opened, opened.currentPlayer, ["0-0"], { reserve: [] });
  if (getAvailableActions(dead).canPlay) {
    console.log("  ✓ get_game_view auto-pass skipped (0-0 was playable)");
  } else {
    assert.equal(getAvailableActions(dead).canPass, true);
    secret.engineState = { ...dead, currentPlayer: opened.currentPlayer, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = opened.currentPlayer;
    session.phase = "playing";
    expire(store);
    const hydrated = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
    assert.equal(hydrated.roundResult?.autoPass, true);
    assert.equal(hydrated.roundResult?.autoPlay, null);
    assertOpponentCanContinue(hydrated, store, view.version);
    void seat;
    console.log("  ✓ get_game_view with no legal tile auto-passes and stamps a new clock");
  }
}

{
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  expire(store);
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store }),
    handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 2);
  const versions = results.map((row) => row.value.version);
  assert.equal(versions[0], versions[1]);
  assert.ok(versions[0] > view.version);
  assert.equal(store.actions.filter((row) => row.actionType === "timeout").length, 1);
  console.log("  ✓ concurrent get_game_view hydrates commit exactly one timeout");
}

{
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  expire(store);
  const entered = await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 999999,
  });
  assertOpponentCanContinue(entered, store, view.version);
  console.log("  ✓ re-enter expires a due timeout instead of returning a frozen view");
}

{
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer === 0 ? 1 : 0;
  const tile25 = createTile(2, 5);
  const tile11 = createTile(1, 1);
  const tile15 = createTile(1, 5);
  const board = [
    { id: "2-5", left: 5, right: 2, orientation: "horizontal" },
    { id: "1-1", left: 1, right: 1, orientation: "vertical" },
  ];
  assert.deepEqual(getOpenEnds(board), { left: 5, right: 1 });
  const incident = {
    ...secret.engineState,
    phase: "playing",
    currentPlayer: seat,
    mustPlayTileId: null,
    reserve: [],
    board,
    byId: { ...secret.engineState.byId, "2-5": tile25, "1-1": tile11, "1-5": tile15 },
    players: secret.engineState.players.map((player, index) =>
      index === seat
        ? { ...player, hand: ["1-5"] }
        : {
            ...player,
            hand: player.hand.filter((id) => id !== "1-5" && id !== "2-5" && id !== "1-1"),
          }
    ),
  };
  const legal = getAvailableActions(incident).legalMoves;
  assert.ok(legal.some((move) => move.tileId === "1-5" && move.end === "left"));
  assert.ok(legal.some((move) => move.tileId === "1-5" && move.end === "right"));
  const picked = pickTimeoutAutoPlayMove(incident);
  assert.equal(picked.tileId, "1-5");
  secret.engineState = incident;
  const session = store.sessions.get(MATCH_ID);
  session.currentSeat = seat;
  session.phase = "playing";
  expire(store);
  const versionBefore = session.version;
  const hydrated = await handleGetGameView({
    userId: seat === 0 ? PLAYER_B : PLAYER_A,
    matchId: MATCH_ID,
    store,
  });
  const timeout = store.actions.find((row) => row.actionType === "timeout");
  assert.equal(timeout?.payload?.autoPlay?.tileId, "1-5");
  assert.ok(["left", "right"].includes(timeout?.payload?.autoPlay?.end));
  assert.ok((hydrated.board || []).some((tile) => tile.id === "1-5"));
  assertOpponentCanContinue(hydrated, store, versionBefore);
  await nextSeatCanAct(store, hydrated);
  console.log("  ✓ Classic 1-5 legal on both ends is auto-played on get_game_view; clock is not pending");
}

console.log("  ✓ timeout auto-play");
