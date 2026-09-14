/**
 * Turn timer must not start until both seated players have joined the
 * table — matchmaking assigning both seats is not the same as both clients
 * actually being present. Behavioral tests against the memory store, which
 * mirrors the SQL gate added in
 * supabase/migrations/20260907010000_online_turn_timer_requires_both_present.sql
 * (see sqlOnlineTurnTimerJoinGate.test.js for the SQL text contract).
 *
 * Run: node src/online/turnTimerJoinGate.test.js
 */
import assert from "node:assert/strict";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSweepDueTimeouts,
} from "./gameplayHandler.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function pendingMatch() {
  return {
    id: MATCH_ID,
    ruleset_id: "legacy",
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    status: "ready",
    // Opt out of the memory store's "both already joined" default so these
    // tests can exercise the pre-both-join waiting state explicitly.
    pendingJoin: true,
  };
}

function expireTurn(store) {
  store.sessions.get(MATCH_ID).turnDeadlineAt = new Date(Date.now() - 25).toISOString();
}

// A. Player B accepts and enters first; Player A has not entered.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });

  // No timer deadline.
  assert.equal(view.turnDeadlineAt, null);
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, null);

  // No timeout strike / no auto-play: resolving now is a harmless no-op,
  // never a committed timeout action (which is what would carry the -5
  // LeoPips penalty at the SQL layer — see _leopips_on_timeout_strike).
  const refreshed = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.deepEqual(refreshed.timeoutStrikes, [0, 0]);
  assert.equal(
    store.actions.some((row) => row.actionType === "timeout"),
    false
  );

  // Explicitly asking to resolve a timeout is rejected — there is nothing due.
  await assert.rejects(
    () =>
      handleResolveTurnTimeout({
        userId: PLAYER_B,
        matchId: MATCH_ID,
        expectedVersion: view.version,
        store,
      }),
    (err) => err.code === "TIMEOUT_NOT_DUE"
  );
  console.log("  ✓ A. opponent-not-entered: no deadline, no strike, no auto-play");
}

// B. Player A joins later: timer starts once, from the moment both are present.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  await handleEnterOnlineMatch({ userId: PLAYER_B, matchId: MATCH_ID, store, createSeed: () => 1001 });
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, null);

  const before = Date.now();
  await store.touchPresence(MATCH_ID, PLAYER_A);
  const armed = store.sessions.get(MATCH_ID).turnDeadlineAt;
  assert.ok(armed, "deadline is armed once both have joined");
  const remaining = Date.parse(armed) - before;
  assert.ok(remaining > 25_000 && remaining <= 30_050, `expected ~30s, got ${remaining}ms`);
  console.log("  ✓ B. second join arms the 30s deadline exactly then");
}

// C. Both players join almost simultaneously: exactly one valid timer init.
for (const order of ["a-then-b", "b-then-a"]) {
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  await handleEnterOnlineMatch({ userId: PLAYER_B, matchId: MATCH_ID, store, createSeed: () => 1001 });
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, null);

  // Fire both remaining/duplicate touches "at once" (no awaits inside the
  // store's arm-check make this equivalent to Postgres's per-row UPDATE
  // lock: whichever call observes turn_deadline_at IS NULL first wins, the
  // other's guard re-check is already false). Racing (A, A-again, B-again).
  const calls =
    order === "a-then-b"
      ? [store.touchPresence(MATCH_ID, PLAYER_A), store.touchPresence(MATCH_ID, PLAYER_B)]
      : [store.touchPresence(MATCH_ID, PLAYER_B), store.touchPresence(MATCH_ID, PLAYER_A)];
  await Promise.all(calls);

  const session = store.sessions.get(MATCH_ID);
  assert.ok(session.turnDeadlineAt, `armed after ${order}`);
  const remaining = Date.parse(session.turnDeadlineAt) - Date.now();
  assert.ok(remaining > 25_000 && remaining <= 30_050, `single well-formed deadline for ${order}`);

  // A further touch from either seat must never re-arm/duplicate it.
  const armedAt = session.turnDeadlineAt;
  await store.touchPresence(MATCH_ID, PLAYER_A);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, armedAt);
  console.log(`  ✓ C. near-simultaneous join (${order}) initializes exactly one valid timer`);
}

// D. One player refreshes/reconnects after live play already started: the
// existing turn timer is not reset or duplicated.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  await handleEnterOnlineMatch({ userId: PLAYER_B, matchId: MATCH_ID, store, createSeed: () => 1001 });
  await store.touchPresence(MATCH_ID, PLAYER_A);
  const armedAt = store.sessions.get(MATCH_ID).turnDeadlineAt;
  assert.ok(armedAt);

  // Reconnect: repeated heartbeats from either seat, plus a plain view
  // refresh (get_game_view / hydrate), must never move the deadline.
  await store.touchPresence(MATCH_ID, PLAYER_A);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  const refreshed = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  assert.equal(refreshed.turnDeadlineAt, armedAt);
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, armedAt);
  console.log("  ✓ D. reconnect after live play does not reset or duplicate the timer");
}

// E. Server timeout sweep runs while only one player is present: ignored.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  await handleEnterOnlineMatch({ userId: PLAYER_B, matchId: MATCH_ID, store, createSeed: () => 1001 });
  assert.equal(store.sessions.get(MATCH_ID).turnDeadlineAt, null);

  const swept = await handleSweepDueTimeouts({ store });
  assert.equal(swept.processed, 0);
  assert.deepEqual(swept.results, []);
  assert.deepEqual(store.sessions.get(MATCH_ID).timeoutStrikes, [0, 0]);
  console.log("  ✓ E. sweep ignores a match until both players are present");
}

// F. Normal 30-second timeout still works once both are present.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  await store.touchPresence(MATCH_ID, PLAYER_A);
  assert.ok(store.sessions.get(MATCH_ID).turnDeadlineAt);

  expireTurn(store);
  const resolved = await handleResolveTurnTimeout({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    expectedVersion: view.version,
    store,
  });
  assert.equal(store.actions.at(-1).actionType, "timeout");
  assert.ok(resolved.roundResult.reason === "timeout_auto" || resolved.roundResult.reason === "timeout_pass");
  assert.equal(resolved.timeoutStrikes[view.currentSeat], 1);
  console.log("  ✓ F. 30s timeout resolves normally once both players are present");
}

// G. Existing 3-timeout loss rule is unchanged once active play has begun.
{
  const store = createMemoryGameStore([pendingMatch()]);
  await store.touchPresence(MATCH_ID, PLAYER_B);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_B,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  await store.touchPresence(MATCH_ID, PLAYER_A);
  const seat = view.currentSeat;

  async function timeoutCurrentSeat(expectedVersion) {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
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
  assert.equal(first.timeoutStrikes[seat], 1);
  const second = await timeoutCurrentSeat(first.version);
  assert.equal(second.timeoutStrikes[seat], 2);
  const third = await timeoutCurrentSeat(second.version);
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(third.phase, "matchOver");
  assert.equal(third.roundResult.reason, "timeout");
  assert.equal(store.matches.get(MATCH_ID).status, "finished");
  assert.equal(store.matches.get(MATCH_ID).finish_reason, "timeout");
  assert.equal(third.matchWinnerSeat, seat === 0 ? 1 : 0);
  console.log("  ✓ G. third timeout after both present is still an authoritative loss");
}

console.log("  ✓ turn timer join-gate");
