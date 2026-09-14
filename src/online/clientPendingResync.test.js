/**
 * Client pending-timeout resync fail-safe.
 * Server remains the authority; client only resolves/refetches.
 * Run: node src/online/clientPendingResync.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldRefreshAuthoritativeViewOnRealtimeStatus,
  shouldRefreshAuthoritativeViewOnResume,
} from "./interactionRecovery.js";
import { keepAuthoritativeView, viewVersion } from "./onlineTable.js";
import { planPlayingHydrateTick } from "./playingHydrate.js";
import {
  planTimeoutTick,
  shouldClearTimeoutPending,
  TIMEOUT_PENDING_RECONCILE_MS,
  timeoutResolveKey,
} from "./timeoutFreeze.js";
import {
  remainingTurnMs,
  stampDeadlineReceipt,
  turnTimerTone,
} from "./turnTimeout.js";

const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(join(root, "hooks/useOnlineMatch.js"), "utf8");
const freeze = readFileSync(join(root, "online/timeoutFreeze.js"), "utf8");
const hydrate = readFileSync(join(root, "online/playingHydrate.js"), "utf8");
const page = readFileSync(join(root, "pages/OnlineGamePage.jsx"), "utf8");

function expiredView(extras = {}) {
  return stampDeadlineReceipt(
    {
      matchId: MATCH_ID,
      phase: "playing",
      status: "playing",
      version: 4,
      currentSeat: 0,
      turnDeadlineAt: "2026-09-06T16:00:00.000Z",
      timeoutStrikes: [0, 0],
      myHand: ["6-6"],
      handCounts: [1, 1],
      ...extras,
    },
    {
      serverNow: extras.serverNow ?? "2026-09-06T16:00:10.000Z",
      deadlineReceivedMono: extras.deadlineReceivedMono ?? 1000,
    }
  );
}

function advancedView(from, extras = {}) {
  return stampDeadlineReceipt(
    {
      ...from,
      version: Number(from.version) + 1,
      currentSeat: 1,
      turnDeadlineAt: "2026-09-06T16:00:40.000Z",
      ...extras,
    },
    {
      serverNow: extras.serverNow ?? "2026-09-06T16:00:12.000Z",
      deadlineReceivedMono: extras.deadlineReceivedMono ?? 5000,
    }
  );
}

assert.equal(TIMEOUT_PENDING_RECONCILE_MS, 10_000);
assert.match(page, /timeoutPending/);
assert.match(page, /timerTone === "pending"/);
assert.match(freeze, /Guaranteed authoritative refetch after grace/);
assert.match(hydrate, /timeout_pending_resync/);
assert.match(hook, /shouldRefreshAuthoritativeViewOnRealtimeStatus/);
assert.match(hook, /pageshow/);
assert.match(hook, /addEventListener\("online"/);
assert.match(hook, /addEventListener\("resume"/);
assert.match(hook, /realtime_status_reconcile/);
assert.match(hook, /await refreshView\(\{ force: true \}\)/);

// --- A. Server advanced, Realtime missed → refetch clears pending UI ---
{
  const stale = expiredView();
  assert.equal(turnTimerTone(remainingTurnMs(stale, Date.parse(stale.serverNow), stale.deadlineReceivedMono)), "pending");
  const planned = planTimeoutTick(stale, {
    nowMs: Date.parse(stale.serverNow) + TIMEOUT_PENDING_RECONCILE_MS,
    monoMs: stale.deadlineReceivedMono + TIMEOUT_PENDING_RECONCILE_MS,
    lastReconcileAt: 0,
  });
  assert.equal(planned.action, "reconcile", "A: grace forces getGameView without needing Realtime");
  const server = advancedView(stale);
  const kept = keepAuthoritativeView(stale, server, { preferIncoming: true });
  assert.ok(viewVersion(kept) > viewVersion(stale));
  assert.equal(shouldClearTimeoutPending(stale, kept), true);
  assert.notEqual(
    turnTimerTone(remainingTurnMs(kept, Date.parse(kept.serverNow), kept.deadlineReceivedMono)),
    "pending"
  );
  console.log("  ✓ A missed Realtime: reconcile + newer version clears Waiting for timeout");
}

// --- B. Resolve response lost → refetch, no duplicate settlement on client ---
{
  assert.match(hook, /timed\?\.timeout/);
  assert.match(hook, /timeout_resolve_hung/);
  assert.match(hook, /ONLINE_ACTION_TIMEOUT_MS/);
  const stale = expiredView();
  const key = timeoutResolveKey(stale);
  const afterHang = planTimeoutTick(stale, {
    attemptedKey: key,
    retryNotBefore: Date.parse(stale.serverNow) + 60_000,
    nowMs: Date.parse(stale.serverNow) + TIMEOUT_PENDING_RECONCILE_MS + 100,
    monoMs: stale.deadlineReceivedMono + TIMEOUT_PENDING_RECONCILE_MS + 100,
    lastReconcileAt: 0,
  });
  assert.equal(afterHang.action, "reconcile", "B: lost ACK path still force-refetches");
  console.log("  ✓ B lost timeout response: client refetches; CAS owned by server");
}

// --- C. Offline during expiry → reconnect fetch ---
{
  assert.equal(shouldRefreshAuthoritativeViewOnResume(expiredView()), true);
  assert.match(hook, /window\.addEventListener\("online"/);
  assert.match(hook, /resume_reconcile/);
  const offlinePlan = planTimeoutTick(expiredView(), {
    serviceOutage: true,
    nowMs: Date.parse("2026-09-06T16:00:20.000Z"),
    lastReconcileAt: 0,
  });
  assert.equal(offlinePlan.action, "reconcile");
  console.log("  ✓ C offline/reconnect: resume + outage reconcile fetch authoritative state");
}

// --- D. Backgrounded during expiry → foreground fetch ---
{
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /pageshow/);
  assert.match(hook, /shouldRefreshAuthoritativeViewOnResume/);
  const hydratePlan = planPlayingHydrateTick(expiredView(), {});
  assert.equal(hydratePlan.action, "refresh");
  assert.equal(hydratePlan.force, true);
  assert.equal(hydratePlan.reason, "timeout_pending_resync");
  console.log("  ✓ D foreground/hydrate force-refetch while pending");
}

// --- E. Pending persists → automatic fallback keeps firing ---
{
  const stale = expiredView();
  const t0 = Date.parse(stale.serverNow);
  const first = planTimeoutTick(stale, {
    nowMs: t0 + TIMEOUT_PENDING_RECONCILE_MS,
    lastReconcileAt: 0,
  });
  assert.equal(first.action, "reconcile");
  const gated = planTimeoutTick(stale, {
    nowMs: t0 + TIMEOUT_PENDING_RECONCILE_MS + 100,
    lastReconcileAt: t0 + TIMEOUT_PENDING_RECONCILE_MS,
    attemptedKey: timeoutResolveKey(stale),
  });
  assert.equal(gated.action, "wait");
  const again = planTimeoutTick(stale, {
    nowMs: t0 + TIMEOUT_PENDING_RECONCILE_MS * 2 + 100,
    lastReconcileAt: t0 + TIMEOUT_PENDING_RECONCILE_MS,
    attemptedKey: timeoutResolveKey(stale),
  });
  assert.equal(again.action, "reconcile", "E: keeps refetching until authority advances");
  console.log("  ✓ E Waiting for timeout cannot latch forever without refetch");
}

// Realtime reconnect status
{
  assert.equal(shouldRefreshAuthoritativeViewOnRealtimeStatus("CHANNEL_ERROR"), true);
  assert.equal(shouldRefreshAuthoritativeViewOnRealtimeStatus("SUBSCRIBED"), true);
  assert.equal(shouldRefreshAuthoritativeViewOnRealtimeStatus("JOINING"), false);
  console.log("  ✓ Realtime unhealthy + SUBSCRIBED both trigger authoritative refresh");
}

// Same-version still expired: stay pending, schedule another refetch (not invent deadline)
{
  const stale = expiredView();
  const same = keepAuthoritativeView(stale, { ...stale, serverNow: "2026-09-06T16:00:11.000Z" }, {
    preferIncoming: true,
  });
  assert.equal(viewVersion(same), viewVersion(stale));
  assert.equal(
    shouldClearTimeoutPending(stale, same, Date.parse("2026-09-06T16:00:11.000Z"), 2000),
    false
  );
  const again = planTimeoutTick(same, {
    nowMs: Date.parse("2026-09-06T16:00:11.000Z") + TIMEOUT_PENDING_RECONCILE_MS,
    lastReconcileAt: Date.parse("2026-09-06T16:00:05.000Z"),
    attemptedKey: timeoutResolveKey(same),
  });
  assert.equal(again.action, "reconcile");
  console.log("  ✓ same-version still overdue stays pending and schedules another refetch");
}

console.log("  ✓ client pending resync fail-safe");
