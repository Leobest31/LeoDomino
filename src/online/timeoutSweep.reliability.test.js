/**
 * Reliability regressions for overdue timeout sweep (CASS509/LELAO class).
 * Run: node src/online/timeoutSweep.reliability.test.js
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTimeoutResolution, getAvailableActions } from "./gameAuthority.js";
import {
  classifySweepFailure,
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleSubmitGameAction,
  handleSweepDueTimeouts,
  TIMEOUT_SWEEP_CAS_ATTEMPTS,
} from "./gameplayHandler.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOT = join(dirname(fileURLToPath(import.meta.url)));

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

/** Find a deal where the post-opener seat has a legal move (highest-double Classic). */
async function seatedWithPostOpenerLegal(maxSeed = 4000) {
  for (let seed = 1000; seed < maxSeed; seed += 1) {
    const { store, view } = await seated(() => seed);
    const opened = applyTimeoutResolution(store.secrets.get(MATCH_ID).engineState, {
      timeoutStrikes: [0, 0],
    }).state;
    const legal = getAvailableActions(opened).legalMoves?.[0];
    if (!legal?.tileId) continue;
    return { store, view, opened, legal, seat: opened.currentPlayer };
  }
  throw new Error("need a Classic seed with a post-opener legal move");
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

{
  assert.equal(TIMEOUT_SWEEP_CAS_ATTEMPTS, 3);
  assert.deepEqual(classifySweepFailure({ code: "42501", message: "permission denied" }), {
    code: "42501",
    reason: "permission_denied",
  });
  assert.deepEqual(classifySweepFailure({ code: "42501", message: "service role required" }), {
    code: "42501",
    reason: "service_role_required",
  });
  console.log("  ✓ classifySweepFailure maps 42501");
}

{
  const { store, view } = await seated();
  expire(store);
  const denied = {
    ...store,
    async loadMatch() {
      throw Object.assign(new Error("permission denied for table matches"), { code: "42501" });
    },
  };
  const first = await handleSweepDueTimeouts({
    store: denied,
    candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 2 }],
  });
  assert.equal(first.results[0].status, "failed");
  assert.equal(first.results[0].code, "42501");
  assert.equal(first.results[0].reason, "permission_denied");
  assert.equal(store.sessions.get(MATCH_ID).version, view.version, "failed sweep must not advance");
  const second = await handleSweepDueTimeouts({
    store: denied,
    candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 2 }],
  });
  assert.equal(second.results[0].status, "failed", "still eligible / retryable next cycle");
  console.log("  ✓ 42501 loadMatch failure stays retryable; no false handled mark");
}

{
  const { store, view, opened, legal, seat } = await seatedWithPostOpenerLegal();
  const secret = store.secrets.get(MATCH_ID);
  assert.ok(legal?.tileId, "need legal tile for auto-play path");
  secret.engineState = restrictHand(opened, seat, [legal.tileId], { reserve: [] });
  store.sessions.get(MATCH_ID).currentSeat = seat;
  store.sessions.get(MATCH_ID).phase = "playing";
  expire(store);

  let commitCalls = 0;
  const original = store.commitTransition.bind(store);
  store.commitTransition = async (args) => {
    commitCalls += 1;
    if (commitCalls === 1) {
      // Simulate a concurrent player move winning CAS once.
      const session = store.sessions.get(MATCH_ID);
      session.version += 1;
      throw Object.assign(new Error("expected_version does not match"), { code: "STALE_VERSION" });
    }
    return original(args);
  };

  // After first STALE, session version bumped but deadline still overdue — retry must commit.
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version }],
  });
  assert.equal(swept.results[0].status, "resolved");
  assert.ok(swept.results[0].casAttempt >= 2);
  assert.equal(swept.results[0].casResult, "committed");
  assert.equal(store.actions.filter((a) => a.actionType === "timeout").length, 1);
  console.log("  ✓ first CAS conflict → re-read/retry commits exactly once");
}

{
  const { store, view, opened, legal, seat } = await seatedWithPostOpenerLegal();
  const secret = store.secrets.get(MATCH_ID);
  assert.ok(legal?.tileId);
  secret.engineState = restrictHand(opened, seat, [legal.tileId], { reserve: [] });
  store.sessions.get(MATCH_ID).currentSeat = seat;
  store.sessions.get(MATCH_ID).phase = "playing";
  expire(store);

  store.enableCommitYield();
  const expectedVersion = store.sessions.get(MATCH_ID).version;
  const [playerResult, sweepResult] = await Promise.all([
    handleSubmitGameAction({
      userId: seat === 0 ? PLAYER_A : PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion,
      action: { type: "play", tileId: legal.tileId, end: legal.end },
      store,
    }).catch((error) => ({ error })),
    handleSweepDueTimeouts({
      store,
      candidates: [{ match_id: MATCH_ID, version: expectedVersion }],
    }),
  ]);
  const timeoutCount = store.actions.filter((a) => a.actionType === "timeout").length;
  const playCount = store.actions.filter((a) => a.actionType === "play").length;
  assert.equal(timeoutCount + playCount, 1, "exactly one mutation wins");
  assert.ok(playerResult?.error || playerResult?.version || sweepResult.results[0].status);
  console.log("  ✓ simultaneous player move vs timeout → single mutation");
}

{
  const { store, view } = await seated();
  expire(store);
  const a = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version }],
  });
  assert.equal(a.results[0].status, "resolved");
  const b = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version }],
  });
  assert.equal(b.results[0].status === "skipped" || b.results[0].status === "stale" || b.results[0].status === "not_due", true);
  assert.ok(["STALE_VERSION", "TIMEOUT_NOT_DUE", "MATCH_NOT_ELIGIBLE", "ROUND_NOT_ACTIVE"].includes(b.results[0].code));
  assert.equal(store.actions.filter((row) => row.actionType === "timeout").length, 1);
  console.log("  ✓ duplicate sweeper invocation → no duplicate timeout");
}

{
  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/timeoutFreeze.classic.029da58a.json"), "utf8")
  );
  const engine = structuredClone(fixture.engineState);
  assert.equal(engine.phase, "playing");
  assert.deepEqual(fixture.scores, [0, 85]);
  assert.deepEqual(fixture.timeoutStrikes, [1, 0]);
  const available = getAvailableActions(engine);
  assert.equal(available.canPass, true);
  assert.equal(available.canPlay, false);
  const store = createMemoryGameStore([
    {
      id: fixture.matchId,
      ruleset_id: fixture.rulesetId,
      player_a: engine.players[0].id,
      player_b: engine.players[1].id,
      status: "playing",
    },
  ]);
  store.sessions.set(fixture.matchId, {
    matchId: fixture.matchId,
    rulesetId: fixture.rulesetId,
    version: fixture.version,
    status: "playing",
    phase: "playing",
    currentSeat: fixture.currentSeat,
    turnDeadlineAt: new Date(Date.now() - 60_000).toISOString(),
    timeoutStrikes: fixture.timeoutStrikes.slice(),
    scores: fixture.scores,
    round: fixture.round,
  });
  store.secrets.set(fixture.matchId, { matchId: fixture.matchId, engineState: engine, seed: 1 });
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: fixture.matchId, version: fixture.version, occupancy_seats: 0 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  assert.equal(store.actions[0].payload?.autoPass, true);
  assert.equal(store.actions[0].payload?.strike, 2);
  assert.deepEqual(store.sessions.get(fixture.matchId).timeoutStrikes, [2, 0]);
  console.log("  ✓ CASS509/LELAO fixture: disconnected clients, server still advances via pass");
}

{
  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/timeoutFreeze.classic.3539270c.json"), "utf8")
  );
  const engine = structuredClone(fixture.engineState);
  const available = getAvailableActions(engine);
  assert.equal(available.canPlay, true);
  assert.ok(available.legalMoves.some((m) => m.tileId === "4-5" && m.end === "left"));
  const preview = applyTimeoutResolution(engine, { timeoutStrikes: fixture.timeoutStrikes });
  assert.equal(preview.safePayload?.autoPlay?.tileId, "4-5");
  assert.equal(preview.safePayload?.autoPlay?.end, "left");
  const store = createMemoryGameStore([
    {
      id: fixture.matchId,
      ruleset_id: fixture.rulesetId,
      player_a: engine.players[0].id,
      player_b: engine.players[1].id,
      status: "playing",
    },
  ]);
  store.sessions.set(fixture.matchId, {
    matchId: fixture.matchId,
    rulesetId: fixture.rulesetId,
    version: fixture.version,
    status: "playing",
    phase: "playing",
    currentSeat: fixture.currentSeat,
    turnDeadlineAt: new Date(Date.now() - 60_000).toISOString(),
    timeoutStrikes: fixture.timeoutStrikes.slice(),
    scores: fixture.scores,
    round: fixture.round,
  });
  store.secrets.set(fixture.matchId, { matchId: fixture.matchId, engineState: engine, seed: 1 });
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: fixture.matchId, version: fixture.version, occupancy_seats: 2 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  assert.equal(store.actions[0].payload?.autoPlay?.tileId, "4-5");
  assert.equal(store.actions[0].payload?.autoPlay?.end, "left");
  console.log("  ✓ 3539270c freeze fixture: engine-derived 4-5@left resolves");
}

{
  // 1 poisoned oldest + 12 valid overdue; scan 24 / resolve budget 8.
  const stores = [];
  const candidates = [];
  const poisonedId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const poisonedStore = createMemoryGameStore([
    { id: poisonedId, ruleset_id: "legacy", player_a: PLAYER_A, player_b: PLAYER_B, status: "playing" },
  ]);
  poisonedStore.sessions.set(poisonedId, {
    matchId: poisonedId,
    rulesetId: "legacy",
    version: 0,
    status: "playing",
    phase: "playing",
    currentSeat: 0,
    turnDeadlineAt: new Date(Date.now() - 120_000).toISOString(),
    timeoutStrikes: [0, 0],
  });
  poisonedStore.secrets.set(poisonedId, {
    matchId: poisonedId,
    engineState: { phase: "playing", currentPlayer: 0, players: [{ id: PLAYER_A }, { id: PLAYER_B }] },
    seed: 1,
  });
  poisonedStore.loadMatch = async () => {
    throw Object.assign(new Error("permission denied for table matches"), { code: "42501" });
  };
  candidates.push({ match_id: poisonedId, version: 0, occupancy_seats: 0 });

  for (let i = 0; i < 12; i += 1) {
    const id = `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`;
    const { store, view } = await seated(() => 2000 + i);
    expire(store);
    const match = store.matches.get(MATCH_ID);
    const session = store.sessions.get(MATCH_ID);
    const secret = store.secrets.get(MATCH_ID);
    store.matches.clear();
    store.sessions.clear();
    store.secrets.clear();
    match.id = id;
    session.matchId = id;
    secret.matchId = id;
    store.matches.set(id, match);
    store.sessions.set(id, session);
    store.secrets.set(id, secret);
    stores.push(store);
    candidates.push({ match_id: id, version: view.version, occupancy_seats: 0 });
  }

  // Combined facade store routing by match id
  const facade = {
    async loadMatch(matchId) {
      if (matchId === poisonedId) return poisonedStore.loadMatch(matchId);
      const hit = stores.find((s) => s.matches.has(matchId));
      return hit.loadMatch(matchId);
    },
    async loadSession(matchId) {
      if (matchId === poisonedId) return poisonedStore.loadSession(matchId);
      return stores.find((s) => s.sessions.has(matchId)).loadSession(matchId);
    },
    async loadSecret(matchId) {
      if (matchId === poisonedId) return poisonedStore.loadSecret(matchId);
      return stores.find((s) => s.secrets.has(matchId)).loadSecret(matchId);
    },
    async commitTransition(args) {
      return stores.find((s) => s.matches.has(args.matchId)).commitTransition(args);
    },
  };

  const first = await handleSweepDueTimeouts({ store: facade, candidates });
  assert.equal(first.results[0].status, "failed");
  assert.equal(first.results[0].code, "42501");
  assert.equal(first.summary.resolved, 8, "resolve budget fills with valid rows past poison");
  assert.equal(first.ok, false);

  const remaining = candidates.filter((c) => {
    if (c.match_id === poisonedId) return true;
    const s = stores.find((st) => st.matches.has(c.match_id));
    return s.actions.filter((a) => a.actionType === "timeout").length === 0;
  });
  const second = await handleSweepDueTimeouts({ store: facade, candidates: remaining });
  const resolvedTotal =
    stores.reduce((n, s) => n + s.actions.filter((a) => a.actionType === "timeout").length, 0);
  assert.equal(resolvedTotal, 12, "all 12 valid matches progress across sweeps");
  assert.ok(second.results.some((r) => r.matchId === poisonedId && r.status === "failed"));
  console.log("  ✓ poisoned row does not starve 12 overdue matches (scan/budget)");
}

{
  // Wallet penalty contract remains in SQL when the LeoPips settlement migration is co-landed.
  const migPath = join(ROOT, "..", "..", "supabase/migrations/20260903160000_leopips_activation_settlement.sql");
  if (existsSync(migPath)) {
    const sql = readFileSync(migPath, "utf8");
    assert.match(sql, /allow_negative := \(p_reason = 'timeout_penalty' AND p_amount = -5\)/);
    assert.match(sql, /_leopips_on_timeout_strike/);
    console.log("  ✓ wallet timeout_penalty allow_negative contract intact");
  } else {
    const edge = readFileSync(join(ROOT, "..", "..", "supabase/functions/online-timeout-sweep/index.js"), "utf8");
    assert.match(edge, /_leopips_commit_online_game_transition/);
    console.log("  ✓ wallet timeout_penalty remains SQL-owned via commit RPC (wallet mig not in this stack)");
  }
}

console.log("  ✓ timeout sweep reliability");
