/**
 * System timeout sweeper. Reuses applyTimeoutAndCommit. No hosted scheduler.
 * Run: node src/online/timeoutSweep.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTimeoutResolution, getAvailableActions } from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleOnlineGameRequest,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
  handleSweepDueTimeouts,
  normalizeSweepCandidates,
  TIMEOUT_SWEEP_BATCH,
  TIMEOUT_SWEEP_CAS_ATTEMPTS,
  TIMEOUT_SWEEP_SCAN,
} from "./gameplayHandler.js";
import { authorizeTimeoutSweep } from "./timeoutSweep.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function expire(store, matchId = MATCH_ID) {
  store.sessions.get(matchId).turnDeadlineAt = new Date(Date.now() - 25).toISOString();
}

async function seated(createSeed = () => 1001) {
  const store = createMemoryGameStore([
    { id: MATCH_ID, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "ready" },
  ]);
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed,
  });
  return { store, view };
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

function timeoutActions(store) {
  return store.actions.filter((row) => row.actionType === "timeout");
}

{
  assert.equal(TIMEOUT_SWEEP_BATCH, 8);
  assert.equal(TIMEOUT_SWEEP_SCAN, 24);
  assert.equal(TIMEOUT_SWEEP_CAS_ATTEMPTS, 3);
  assert.ok(TIMEOUT_SWEEP_SCAN >= TIMEOUT_SWEEP_BATCH);
  assert.deepEqual(
    normalizeSweepCandidates(
      [
        { match_id: "a", version: 1 },
        { foo: 1 },
        null,
        { matchId: "b", version: "x" },
        { match_id: "c", version: 2 },
      ],
      8
    ),
    [
      { matchId: "a", version: 1, turnDeadlineAt: null, occupancySeats: null, rulesetId: null },
      { matchId: "c", version: 2, turnDeadlineAt: null, occupancySeats: null, rulesetId: null },
    ]
  );
  assert.deepEqual(
    normalizeSweepCandidates([{ match_id: "z", version: 3, occupancy_seats: 1 }], 8),
    [{ matchId: "z", version: 3, turnDeadlineAt: null, occupancySeats: 1, rulesetId: null }]
  );
  const many = Array.from({ length: 30 }, (_, i) => ({ match_id: `m${i}`, version: i }));
  assert.equal(normalizeSweepCandidates(many).length, TIMEOUT_SWEEP_SCAN);
  assert.equal(normalizeSweepCandidates(many, TIMEOUT_SWEEP_BATCH).length, TIMEOUT_SWEEP_BATCH);
  console.log("  ✓ malformed candidates ignored; batch/scan limits honored");
}

{
  const denied = authorizeTimeoutSweep({}, {});
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 401);
  const missing = authorizeTimeoutSweep({ authorization: "Bearer secret" }, {});
  assert.equal(missing.ok, false);
  const wrong = authorizeTimeoutSweep(
    { authorization: "Bearer no" },
    { TIMEOUT_SWEEP_SECRET: "yes" }
  );
  assert.equal(wrong.ok, false);
  const ok = authorizeTimeoutSweep(
    { authorization: "Bearer yes" },
    { TIMEOUT_SWEEP_SECRET: "yes" }
  );
  assert.equal(ok.ok, true);
  const named = authorizeTimeoutSweep(
    { "x-timeout-sweep-secret": "yes" },
    { TIMEOUT_SWEEP_SECRET: "yes" }
  );
  assert.equal(named.ok, true);
  console.log("  ✓ wrong/missing sweep secret → 401 and zero work");
}

{
  await assert.rejects(
    () => handleOnlineGameRequest("sweep_due_timeouts", {}, { userId: PLAYER_A }),
    (err) => err.code === "UNKNOWN_OP"
  );
  const page = readFileSync(join(ROOT, "src/online/gameplayHandler.js"), "utf8");
  assert.match(page, /applyTimeoutAndCommit\(/);
  assert.match(page, /handleSweepDueTimeouts/);
  assert.match(page, /userId: actor.playerId/);
  assert.doesNotMatch(
    page,
    /if \(op === "sweep_due_timeouts"\) \{\s*return handleSweepDueTimeouts/
  );
  const edge = readFileSync(join(ROOT, "supabase/functions/online-timeout-sweep/index.js"), "utf8");
  assert.match(edge, /authorizeTimeoutSweep/);
  assert.match(edge, /handleSweepDueTimeouts/);
  assert.match(edge, /_leopips_commit_online_game_transition/);
  assert.doesNotMatch(edge, /sb_secret|service_role eyJ/);
  const cfg = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
  assert.match(cfg, /\[functions\.online-timeout-sweep\]/);
  assert.match(cfg, /verify_jwt = false/);
  console.log("  ✓ sweeper is not a public online-game op; one commit path");
}

{
  const { store, view } = await seated();
  expire(store);
  const swept = await handleSweepDueTimeouts({ store });
  assert.equal(swept.results[0].status, "resolved");
  assert.ok(swept.results[0].version > view.version);
  assert.equal(timeoutActions(store).length, 1);
  assert.equal(timeoutActions(store)[0].actorId, view.currentSeat === 0 ? PLAYER_A : PLAYER_B);
  assert.equal(store.sessions.get(MATCH_ID).timeoutStrikes[view.currentSeat], 1);
  const again = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(again.version, swept.results[0].version);
  console.log("  ✓ both clients absent, overdue candidate → auto-play");
}

{
  const { store, view } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const opened = applyTimeoutResolution(secret.engineState, { timeoutStrikes: [0, 0] }).state;
  const dead = restrictHand(opened, opened.currentPlayer, ["0-0"], { reserve: [] });
  if (getAvailableActions(dead).canPlay) {
    console.log("  ✓ no-legal-move auto-pass skipped (0-0 was playable)");
  } else {
    secret.engineState = { ...dead, currentPlayer: opened.currentPlayer, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = opened.currentPlayer;
    session.phase = "playing";
    expire(store);
    const swept = await handleSweepDueTimeouts({ store });
    assert.equal(swept.results[0].status, "resolved");
    assert.equal(store.sessions.get(MATCH_ID).roundResult?.autoPass || timeoutActions(store)[0].payload.autoPass, true);
    assert.ok(swept.results[0].version > view.version);
    console.log("  ✓ both clients absent, no legal move + empty reserve → auto-pass");
  }
}

{
  const { store } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const opened = applyTimeoutResolution(secret.engineState, { timeoutStrikes: [0, 0] }).state;
  const blocked = restrictHand(opened, opened.currentPlayer, ["0-0"], {
    reserve: opened.reserve?.length ? opened.reserve : ["3-4"],
  });
  if (getAvailableActions(blocked).canPlay) {
    console.log("  ✓ draw-before-pass skipped (tile was legal)");
  } else {
    secret.engineState = { ...blocked, currentPlayer: opened.currentPlayer, phase: "playing" };
    store.sessions.get(MATCH_ID).currentSeat = opened.currentPlayer;
    expire(store);
    await handleSweepDueTimeouts({ store });
    const payload = timeoutActions(store)[0].payload;
    assert.ok(payload.autoDraw >= 1 || payload.autoPass === true);
    if (payload.autoDraw >= 1) assert.equal(payload.autoPass, false);
    console.log("  ✓ reserve remains → draw-before-pass preserved");
  }
}

{
  const { store, view } = await seated();
  const seat = view.currentSeat;
  async function sweepSameSeat() {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    session.status = "playing";
    expire(store);
    return handleSweepDueTimeouts({ store });
  }
  const first = await sweepSameSeat();
  assert.equal(first.results[0].status, "resolved");
  assert.equal(store.sessions.get(MATCH_ID).timeoutStrikes[seat], 1);
  const second = await sweepSameSeat();
  assert.equal(second.results[0].status, "resolved");
  assert.equal(store.sessions.get(MATCH_ID).timeoutStrikes[seat], 2);
  const boardBefore = store.secrets.get(MATCH_ID).engineState.board.slice();
  const third = await sweepSameSeat();
  assert.equal(third.results[0].status, "resolved");
  assert.equal(store.matches.get(MATCH_ID).status, "finished");
  assert.equal(store.matches.get(MATCH_ID).finish_reason, "timeout");
  assert.equal(timeoutActions(store).length, 3);
  assert.equal(timeoutActions(store)[2].payload.strike, 3);
  assert.equal(timeoutActions(store)[2].payload.matchOver, true);
  assert.deepEqual(store.secrets.get(MATCH_ID).engineState.board, boardBefore);
  console.log("  ✓ strike 1/2 resolve; strike 3 → match loss, no extra engine play");
}

{
  // LeoPips timeout-penalty economics live in the wallet settlement stack (separate from this
  // timeout-pipeline commit when those migrations are not co-landed). When present, assert the
  // final contract; otherwise verify the sweeper still routes through the SQL commit RPC.
  const migPath = join(ROOT, "supabase/migrations/20260903160000_leopips_activation_settlement.sql");
  if (existsSync(migPath)) {
    const sql = readFileSync(migPath, "utf8");
    assert.match(sql, /p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2/);
    assert.match(sql, /allow_negative := \(p_reason = 'timeout_penalty' AND p_amount = -5\)/);
    assert.match(sql, /_leopips_on_timeout_strike/);
    assert.match(sql, /no_third_penalty/);
    console.log("  ✓ LeoPips -5 / negative / no third -5 remain SQL-owned");
  } else {
    const edge = readFileSync(join(ROOT, "supabase/functions/online-timeout-sweep/index.js"), "utf8");
    assert.match(edge, /_leopips_commit_online_game_transition/);
    console.log("  ✓ LeoPips timeout penalty remains SQL-owned via commit RPC (wallet mig not in this stack)");
  }
}

{
  const { store, view } = await seated();
  expire(store);
  store.enableCommitYield();
  const [left, right] = await Promise.all([
    handleSweepDueTimeouts({ store, candidates: [{ match_id: MATCH_ID, version: view.version }] }),
    handleSweepDueTimeouts({ store, candidates: [{ match_id: MATCH_ID, version: view.version }] }),
  ]);
  const resolved = [...left.results, ...right.results].filter((row) => row.status === "resolved");
  const skipped = [...left.results, ...right.results].filter((row) =>
    row.status === "skipped" || row.status === "stale" || row.status === "not_due"
  );
  assert.equal(resolved.length, 1);
  assert.equal(skipped.length, 1);
  assert.ok(
    skipped[0].code === "STALE_VERSION" || skipped[0].code === "TIMEOUT_NOT_DUE",
    "loser must skip as stale or already-advanced"
  );
  assert.equal(timeoutActions(store).length, 1);
  console.log("  ✓ two sweepers same match/version → one commit");
}

{
  const { store, view } = await seated();
  expire(store);
  store.enableCommitYield();
  const raced = await Promise.allSettled([
    handleSweepDueTimeouts({ store }),
    handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store }),
    handleEnterOnlineMatch({ userId: PLAYER_A, matchId: MATCH_ID, store }),
    handleResolveTurnTimeout({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      store,
    }),
    handleSubmitGameAction({
      userId: view.currentSeat === 0 ? PLAYER_A : PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "pass" },
      store,
    }),
  ]);
  assert.equal(timeoutActions(store).length, 1);
  assert.ok(raced.some((row) => row.status === "fulfilled"));
  console.log("  ✓ reconnect / get_game_view / resolve / submit vs sweeper → one commit");
}

{
  const { store, view } = await seated();
  const future = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version }],
  });
  assert.equal(future.results[0].status, "not_due");
  assert.equal(future.results[0].code, "TIMEOUT_NOT_DUE");
  assert.equal(timeoutActions(store).length, 0);
  expire(store);
  // Stale candidate version must not abandon an overdue turn — re-read and commit.
  const staleCandidate = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version + 9 }],
  });
  assert.equal(staleCandidate.results[0].status, "resolved");
  assert.equal(timeoutActions(store).length, 1);
  console.log("  ✓ TIMEOUT_NOT_DUE skips; stale candidate version still recovers overdue turn");
}

{
  const { store, view } = await seated();
  const seat = view.currentSeat;
  async function resolveSameSeat() {
    const secret = store.secrets.get(MATCH_ID);
    secret.engineState = { ...secret.engineState, currentPlayer: seat, phase: "playing" };
    const session = store.sessions.get(MATCH_ID);
    session.currentSeat = seat;
    session.phase = "playing";
    session.status = "playing";
    expire(store);
    return handleResolveTurnTimeout({
      userId: PLAYER_A,
      matchId: MATCH_ID,
      expectedVersion: session.version,
      store,
    });
  }
  await resolveSameSeat();
  await resolveSameSeat();
  await resolveSameSeat();
  assert.equal(store.matches.get(MATCH_ID).status, "finished");
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: store.sessions.get(MATCH_ID).version }],
  });
  assert.equal(swept.results[0].status, "skipped");
  assert.equal(swept.results[0].code, "MATCH_NOT_ELIGIBLE");
  assert.equal(timeoutActions(store).length, 3);
  console.log("  ✓ terminal match ignored");
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
  expire(store);
  const broken = {
    ...store,
    async loadMatch() {
      throw Object.assign(new Error("db down"), { code: "PGRST003" });
    },
  };
  const failed = await handleSweepDueTimeouts({
    store: broken,
    candidates: [{ match_id: MATCH_ID, version: 0 }],
  });
  assert.equal(failed.results[0].status, "failed");
  assert.equal(timeoutActions(store).length, 0);
  assert.equal(store.matches.get(MATCH_ID).status, "playing");
  console.log("  ✓ Edge/DB failure → no forfeit / no synthetic transition");
}

{
  const { store } = await seated();
  expire(store);
  const order = [];
  const original = store.commitTransition.bind(store);
  store.commitTransition = async (args) => {
    order.push(args.matchId);
    return original(args);
  };
  const extra = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  store.matches.set(extra, {
    id: extra,
    ruleset_id: "legacy",
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    status: "playing",
  });
  store.sessions.set(extra, { ...store.sessions.get(MATCH_ID), matchId: extra });
  store.secrets.set(extra, JSON.parse(JSON.stringify(store.secrets.get(MATCH_ID))));
  expire(store, extra);
  await handleSweepDueTimeouts({
    store,
    candidates: [
      { match_id: MATCH_ID, version: 0 },
      { match_id: extra, version: 0 },
    ],
  });
  assert.deepEqual(order, [MATCH_ID, extra]);
  console.log("  ✓ serial processing works");
}

{
  const { store: storeB, view: viewB } = await seated();
  expire(storeB);
  const zeroOcc = await handleSweepDueTimeouts({
    store: storeB,
    candidates: [
      {
        match_id: MATCH_ID,
        version: viewB.version,
        occupancy_seats: 0,
      },
    ],
  });
  assert.equal(zeroOcc.results[0].status, "resolved", "zero occupancy still resolves overdue playing turn");
  assert.equal(zeroOcc.results[0].occupancySeats, 0);
  assert.ok(zeroOcc.results[0].version > viewB.version);
  assert.equal(timeoutActions(storeB).length, 1);
  assert.equal(zeroOcc.summary.candidatesFound, 1);
  assert.equal(zeroOcc.summary.resolved, 1);

  const { store: storeC, view: viewC } = await seated();
  expire(storeC);
  const oneOcc = await handleSweepDueTimeouts({
    store: storeC,
    candidates: [
      {
        match_id: MATCH_ID,
        version: viewC.version,
        occupancy_seats: 1,
      },
    ],
  });
  assert.equal(oneOcc.results[0].status, "resolved", "single occupancy still resolves");
  assert.equal(oneOcc.results[0].occupancySeats, 1);

  const { store: storeD, view: viewD } = await seated();
  expire(storeD);
  const dual = await handleSweepDueTimeouts({
    store: storeD,
    candidates: [
      {
        match_id: MATCH_ID,
        version: viewD.version,
        occupancy_seats: 2,
      },
    ],
  });
  assert.equal(dual.results[0].status, "resolved", "dual occupancy still resolves");
  assert.equal(dual.summary.resolved, 1);
  console.log("  ✓ overdue turn resolves with occupancy 2/1/0; summary counts present");
}

{
  const { store } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const opened = applyTimeoutResolution(secret.engineState, { timeoutStrikes: [0, 0] }).state;
  const unique = getAvailableActions(opened).legalMoves?.[0];
  if (!unique?.tileId) {
    console.log("  ✓ legal last-tile autoplay skipped (no legal move on opened deal)");
  } else {
    secret.engineState = restrictHand(opened, opened.currentPlayer, [unique.tileId], { reserve: [] });
    store.sessions.get(MATCH_ID).currentSeat = opened.currentPlayer;
    store.sessions.get(MATCH_ID).phase = "playing";
    expire(store);
    const swept = await handleSweepDueTimeouts({ store });
    assert.equal(swept.results[0].status, "resolved");
    assert.equal(timeoutActions(store)[0].payload?.autoPlay?.tileId, unique.tileId);
    assert.ok(
      (store.secrets.get(MATCH_ID).engineState.board || []).some((tile) => tile.id === unique.tileId)
    );
    console.log("  ✓ legal last-tile autoplay commits via sweeper");
  }
}

console.log("  ✓ timeout sweeper");
