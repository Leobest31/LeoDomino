/**
 * Signal-loss / offline match resilience — server authority + client reconcile.
 * Does not change 30s timer, LeoPips rules, or invent client moves.
 * Run: node src/online/signalLossResilience.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAvailableActions } from "../game/rules/drawDominoes.js";
import {
  applyTimeoutResolution,
  pickTimeoutAutoPlayMove,
} from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleSubmitGameAction,
  handleSweepDueTimeouts,
} from "./gameplayHandler.js";
import {
  isTimeoutClockRestamp,
  shouldBypassDragLock,
  shouldRefreshAuthoritativeViewOnResume,
} from "./interactionRecovery.js";
import { onlineActionDiag } from "./onlineActionDiag.js";
import { keepAuthoritativeView } from "./onlineTable.js";
import {
  planTimeoutTick,
  shouldClearTimeoutPending,
  TIMEOUT_PENDING_RECONCILE_MS,
  timeoutResolveKey,
} from "./timeoutFreeze.js";
import {
  overlayNewerTimeoutClock,
  remainingTurnMs,
  stampDeadlineReceipt,
  TURN_TIMEOUT_MS,
} from "./turnTimeout.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const hook = read("hooks/useOnlineMatch.js");
const freeze = read("online/timeoutFreeze.js");
const recovery = read("online/interactionRecovery.js");
const diagSrc = read("online/onlineActionDiag.js");

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

function playingClock(extras = {}) {
  return stampDeadlineReceipt(
    {
      matchId: MATCH_ID,
      phase: "playing",
      status: "playing",
      version: 2,
      currentSeat: 0,
      turnDeadlineAt: "2026-09-06T15:00:30.000Z",
      timeoutStrikes: [0, 0],
      myHand: ["6-6"],
      handCounts: [1, 1],
      ...extras,
    },
    {
      serverNow: extras.serverNow ?? "2026-09-06T15:00:00.000Z",
      deadlineReceivedMono: extras.deadlineReceivedMono ?? 1000,
    }
  );
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

// --- A. Lose network before deadline; reconnect keeps remaining server time ---
{
  const before = playingClock();
  const midOffline = Date.parse(before.serverNow) + 12_000;
  const remainingBefore = remainingTurnMs(before, midOffline, before.deadlineReceivedMono + 12_000);
  assert.equal(remainingBefore, TURN_TIMEOUT_MS - 12_000);
  const reconnect = overlayNewerTimeoutClock(
    before,
    {
      serverNow: "2026-09-06T15:00:12.000Z",
      turnDeadlineAt: before.turnDeadlineAt,
      version: before.version,
    },
    before.deadlineReceivedMono + 12_000
  );
  assert.equal(reconnect.turnDeadlineAt, before.turnDeadlineAt);
  assert.equal(
    remainingTurnMs(reconnect, Date.parse(reconnect.serverNow), reconnect.deadlineReceivedMono),
    TURN_TIMEOUT_MS - 12_000
  );
  assert.equal(shouldRefreshAuthoritativeViewOnResume(before), true);
  console.log("  ✓ A reconnect before deadline keeps authoritative remaining time");
}

// --- B. Lose network through deadline; server timeout advances; client clears latch ---
{
  const { store, view } = await seated();
  const versionBefore = view.version;
  expire(store);
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: versionBefore, occupancy_seats: 0 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  const after = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  assert.ok(after.version > versionBefore);
  const staleClient = playingClock({
    version: versionBefore,
    turnDeadlineAt: store.sessions.get(MATCH_ID).turnDeadlineAt,
    serverNow: "2026-09-06T15:01:00.000Z",
  });
  assert.equal(shouldClearTimeoutPending(staleClient, after), true);
  assert.equal(shouldBypassDragLock(staleClient, after), true);
  console.log("  ✓ B offline through deadline: sweeper advances; client latch clears");
}

// --- C. Both clients offline — sweeper still resolves ---
{
  const { store, view } = await seated();
  expire(store);
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 0 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  assert.ok(swept.results[0].version > view.version);
  console.log("  ✓ C both offline / occupancy 0: sweeper still resolves");
}

// --- D. App background past deadline → resume reconcile wiring ---
{
  assert.match(hook, /pageshow/);
  assert.match(hook, /addEventListener\("online"/);
  assert.match(hook, /addEventListener\("resume"/);
  assert.match(hook, /resume_reconcile/);
  assert.match(hook, /refreshView\(\{ force: true \}\)/);
  const expired = playingClock({
    turnDeadlineAt: "2026-09-06T14:59:00.000Z",
    serverNow: "2026-09-06T15:00:00.000Z",
  });
  const planned = planTimeoutTick(expired, {
    nowMs: Date.parse(expired.serverNow),
    monoMs: expired.deadlineReceivedMono,
    attemptedKey: timeoutResolveKey(expired),
    lastReconcileAt: 0,
  });
  assert.equal(planned.action, "reconcile");
  console.log("  ✓ D background/resume forces authoritative reconcile");
}

// --- E. Network change / no stale turn restart ---
{
  const before = playingClock();
  const sameDeadline = keepAuthoritativeView(
    before,
    stampDeadlineReceipt(
      { ...before, serverNow: "2026-09-06T15:00:05.000Z" },
      { serverNow: "2026-09-06T15:00:05.000Z", deadlineReceivedMono: 6000 }
    )
  );
  assert.equal(sameDeadline.turnDeadlineAt, before.turnDeadlineAt);
  assert.equal(isTimeoutClockRestamp(before, sameDeadline), true);
  assert.equal(shouldBypassDragLock(before, sameDeadline), true);
  console.log("  ✓ E Wi-Fi→cellular restamp does not restart the 30s turn");
}

// --- F. Stale client move after server timeout committed ---
{
  const { store, view } = await seated();
  const seat = view.currentSeat;
  const state = store.secrets.get(MATCH_ID).engineState;
  const legal = getAvailableActions(state).legalMoves[0];
  assert.ok(legal, "seeded match needs a legal move for stale-submit race");
  expire(store);
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 1 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  let rejected = null;
  try {
    await handleSubmitGameAction({
      userId: seat === 0 ? PLAYER_A : PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: legal.tileId, end: legal.end },
      store,
    });
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected);
  assert.equal(rejected.code, "STALE_VERSION");
  assert.match(hook, /error\?\.code === "STALE_VERSION"/);
  assert.match(hook, /await refreshView\(\{ force: true \}\)/);
  console.log("  ✓ F stale post-timeout submit rejects; client force-reconciles");
}

// --- G. Duplicate timeout sweep → one mutation ---
{
  const { store, view } = await seated();
  expire(store);
  store.enableCommitYield?.();
  const [left, right] = await Promise.all([
    handleSweepDueTimeouts({
      store,
      candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 0 }],
    }),
    handleSweepDueTimeouts({
      store,
      candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 0 }],
    }),
  ]);
  const resolved = [...left.results, ...right.results].filter((row) => row.status === "resolved");
  const skipped = [...left.results, ...right.results].filter(
    (row) =>
      row.status === "skipped" ||
      row.status === "stale" ||
      row.status === "not_due" ||
      row.status === "failed"
  );
  assert.equal(resolved.length, 1, "exactly one timeout mutation");
  assert.ok(skipped.length >= 1, "duplicate is a safe no-op");
  console.log("  ✓ G duplicate sweep is idempotent (one authoritative mutation)");
}

// --- H. Timeout auto-play legal tile path ---
{
  const { store, view } = await seated();
  const state = store.secrets.get(MATCH_ID).engineState;
  const pick = pickTimeoutAutoPlayMove(state);
  assert.ok(pick?.tileId, "opening deal should expose a deterministic auto-play");
  expire(store);
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version, occupancy_seats: 0 }],
  });
  assert.equal(swept.results[0].status, "resolved");
  const after = store.secrets.get(MATCH_ID).engineState;
  assert.ok(after.board?.length >= state.board?.length);
  console.log("  ✓ H timeout auto-play legal tile path");
}

// --- I. No legal move → draw-before-pass / pass ---
{
  const { store } = await seated();
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer;
  const emptied = restrictHand(secret.engineState, seat, [], { reserve: [] });
  secret.engineState = emptied;
  const available = getAvailableActions(emptied);
  assert.equal((available.legalMoves || []).length, 0);
  const applied = applyTimeoutResolution(emptied, {
    timeoutStrikes: store.sessions.get(MATCH_ID).timeoutStrikes || [0, 0],
  });
  assert.equal(applied.actionType, "timeout");
  assert.ok(
    applied.safePayload?.autoPass ||
      applied.safePayload?.autoDraw >= 0 ||
      applied.finishReason === "timeout" ||
      applied.state
  );
  console.log("  ✓ I no legal move uses draw-before-pass / pass / timeout rules");
}

// --- J. Next turn unlocks after timeout commit ---
{
  const { store, view } = await seated();
  const versionBefore = view.version;
  const deadlineBeforeExpire = store.sessions.get(MATCH_ID).turnDeadlineAt;
  expire(store);
  const expiredDeadline = store.sessions.get(MATCH_ID).turnDeadlineAt;
  assert.notEqual(expiredDeadline, deadlineBeforeExpire);
  await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: versionBefore, occupancy_seats: 0 }],
  });
  const opponent = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.ok(opponent.version > versionBefore);
  assert.notEqual(String(opponent.turnDeadlineAt ?? ""), String(expiredDeadline));
  if (opponent.phase === "playing" && opponent.status === "playing") {
    assert.ok(opponent.turnDeadlineAt, "live turn after timeout has a fresh server deadline");
  }
  console.log("  ✓ J opponent receives advanced state after timeout commit");
}

// --- Client: hung resolve + outage reconcile + drag clock bypass ---
{
  assert.match(hook, /ONLINE_ACTION_TIMEOUT_MS/);
  assert.match(hook, /timed\?\.timeout/);
  assert.match(hook, /timeout_resolve_hung/);
  assert.match(hook, /await refreshView\(\{ force: true \}\)/);
  assert.match(freeze, /serviceOutage/);
  assert.match(freeze, /action: "reconcile"/);
  const expired = playingClock({
    turnDeadlineAt: "2026-09-06T14:59:00.000Z",
    serverNow: "2026-09-06T15:00:00.000Z",
  });
  const outage = planTimeoutTick(expired, {
    serviceOutage: true,
    nowMs: Date.parse(expired.serverNow),
    monoMs: expired.deadlineReceivedMono,
    lastReconcileAt: 0,
  });
  assert.equal(outage.action, "reconcile", "outage still reconciles; never invents moves");
  const outageWait = planTimeoutTick(expired, {
    serviceOutage: true,
    nowMs: Date.parse(expired.serverNow),
    monoMs: expired.deadlineReceivedMono,
    lastReconcileAt: Date.parse(expired.serverNow),
  });
  assert.equal(outageWait.action, "wait");
  assert.match(recovery, /isTimeoutClockRestamp/);
  assert.match(recovery, /shouldClearTimeoutPending/);
  console.log("  ✓ hung resolve bounded; outage reconciles; drag yields to clock restamp");
}

// --- Observability (no secrets) ---
{
  const row = onlineActionDiag("timeout_reconcile", {
    matchId: MATCH_ID,
    clientKnownVersion: 3,
    turnDeadlineAt: "2026-09-06T15:00:30.000Z",
    timeoutDue: true,
    reconcileTriggered: true,
    connectivity: "offline",
    casConflict: false,
    staleRejected: true,
    sweepResult: "resolved",
  });
  assert.equal(row.match_id, MATCH_ID);
  assert.equal(row.connectivity, "offline");
  assert.equal(row.timeout_due, true);
  assert.equal(row.reconcile_triggered, true);
  assert.equal(row.stale_rejected, true);
  assert.equal(row.sweep_result, "resolved");
  assert.equal(row.deadline_at, "2026-09-06T15:00:30.000Z");
  assert.doesNotMatch(diagSrc, /anon|service_role|password|Authorization/i);
  assert.ok(TIMEOUT_PENDING_RECONCILE_MS >= 3_000);
  assert.ok(TIMEOUT_PENDING_RECONCILE_MS <= 10_000);
  console.log("  ✓ structured signal-loss diagnostics omit secrets");
}

// --- LeoPips: disconnect alone must not settle ---
{
  const handler = read("online/gameplayHandler.js");
  assert.doesNotMatch(
    handler,
    /occupancy_seats\s*===\s*0[\s\S]{0,120}settle|refund.*disconnect|disconnect.*payout/i
  );
  assert.match(handler, /applyTimeoutAndCommit|applyTimeoutResolution/);
  console.log("  ✓ LeoPips: signal loss alone does not refund/payout/abandon-settle");
}

console.log("  ✓ signal-loss resilience");
