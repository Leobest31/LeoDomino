/**
 * Coalesced friends/matchmaking refresh — in-flight, hidden, outage.
 * Run: node src/online/guardedRefresh.test.js
 */
import assert from "node:assert/strict";
import {
  FRIENDS_FALLBACK_REFRESH_MS,
  REST_EVENT_COALESCE_MS,
  createGuardedRefresh,
  friendRequestConcernsPlayer,
  friendshipConcernsPlayer,
  stableIdKey,
} from "./guardedRefresh.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

{
  assert.ok(FRIENDS_FALLBACK_REFRESH_MS >= 60000, "fallback is never faster than 60s");
  assert.equal(FRIENDS_FALLBACK_REFRESH_MS, 120000);
  assert.ok(REST_EVENT_COALESCE_MS >= 100);
  assert.ok(REST_EVENT_COALESCE_MS <= 1000);
}

{
  assert.equal(stableIdKey(["b", "a", "a"]), "a,b");
  assert.equal(stableIdKey([]), "");
  assert.equal(stableIdKey(["same", "same"]), "same");
}

{
  const me = "player-me";
  assert.equal(
    friendRequestConcernsPlayer({ new: { sender_id: me, receiver_id: "other" } }, me),
    true
  );
  assert.equal(
    friendRequestConcernsPlayer({ new: { sender_id: "other", receiver_id: me } }, me),
    true
  );
  assert.equal(
    friendRequestConcernsPlayer({ old: { senderId: me, receiverId: "x" } }, me),
    true
  );
  assert.equal(
    friendRequestConcernsPlayer({ new: { sender_id: "a", receiver_id: "b" } }, me),
    false
  );
  assert.equal(friendRequestConcernsPlayer({ new: { sender_id: me } }, ""), false);
}

{
  const me = "player-me";
  assert.equal(friendshipConcernsPlayer({ new: { user_a: me, user_b: "x" } }, me), true);
  assert.equal(friendshipConcernsPlayer({ new: { user_a: "x", user_b: me } }, me), true);
  assert.equal(friendshipConcernsPlayer({ new: { userA: "x", userB: "y" } }, me), false);
}

{
  let loads = 0;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
      return loads;
    },
    isHidden: () => false,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(loads, 1, "initial load runs");
  guard.dispose();
}

{
  let loads = 0;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
    },
    isHidden: () => true,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(loads, 0, "hidden page does not refresh");
  await guard.run({ force: true });
  assert.equal(loads, 1, "force still loads while hidden");
  guard.dispose();
}

{
  let loads = 0;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
    },
    isHidden: () => false,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(loads, 1);
  guard.dispose();
  await guard.run();
  guard.schedule();
  await wait(20);
  assert.equal(loads, 1, "dispose stops further refreshes");
}

{
  let started = 0;
  let finish;
  const guard = createGuardedRefresh({
    load: () => {
      started += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    isHidden: () => false,
    coalesceMs: 0,
  });
  const first = guard.run();
  const second = guard.run();
  assert.equal(started, 1, "in-flight guard blocks a second bundle");
  assert.equal(guard.isInFlight(), true);
  finish();
  await first;
  await second;
  await wait(0);
  if (typeof finish === "function") finish();
  await wait(20);
  assert.ok(started <= 2, "queued follow-up is at most one extra load");
  guard.dispose();
}

{
  let loads = 0;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
    },
    isHidden: () => false,
    coalesceMs: 25,
  });
  guard.schedule();
  guard.schedule();
  guard.schedule();
  assert.equal(loads, 0);
  await wait(80);
  assert.equal(loads, 1, "Realtime events coalesce into one refresh");
  guard.dispose();
}

{
  let loads = 0;
  let t = 1000;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
      throw { status: 503, message: "Service Unavailable" };
    },
    isHidden: () => false,
    now: () => t,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(loads, 1);
  assert.equal(guard.isOutage(), true);
  t = 2000;
  await guard.run();
  await guard.run();
  assert.equal(loads, 1, "503 does not cause a request storm");
  guard.dispose();
}

{
  let loads = 0;
  let t = 1000;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
      throw { status: 500, message: "Internal Server Error" };
    },
    isHidden: () => false,
    now: () => t,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(guard.isOutage(), true, "HTTP 500 enters friends outage");
  t = 1500;
  await guard.run();
  assert.equal(loads, 1);
  guard.dispose();
}

{
  let loads = 0;
  let fail = true;
  let t = 1000;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
      if (fail) throw { status: 503, message: "Service Unavailable" };
      return { ok: true };
    },
    isHidden: () => false,
    now: () => t,
    coalesceMs: 0,
  });
  await guard.run();
  assert.equal(guard.isOutage(), true);
  fail = false;
  t = 30000;
  await guard.run();
  assert.equal(loads, 2, "service recovery triggers one refresh");
  assert.equal(guard.isOutage(), false);
  await guard.run();
  assert.equal(loads, 3);
  guard.dispose();
}

{
  let loads = 0;
  const guard = createGuardedRefresh({
    load: async () => {
      loads += 1;
    },
    isReady: () => false,
    isHidden: () => false,
    coalesceMs: 0,
  });
  await guard.run({ force: true });
  assert.equal(loads, 0, "logged-out / not ready skips network");
  guard.dispose();
}

console.log("  ✓ guarded refresh (in-flight, visibility, outage, coalesce)");
