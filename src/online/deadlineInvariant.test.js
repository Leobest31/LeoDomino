/**
 * Deadline lifecycle + privilege contract helpers.
 * Run: node src/online/deadlineInvariant.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertActivePlayingDeadline, isTerminalForTimeoutSweep } from "./deadlineInvariant.js";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleSubmitGameAction,
  handleSweepDueTimeouts,
} from "./gameplayHandler.js";
import { planTimeoutTick, TIMEOUT_PENDING_RECONCILE_MS } from "./timeoutFreeze.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

{
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260906010000_service_role_matches_select_for_timeout_sweep.sql"),
    "utf8"
  );
  assert.match(sql, /GRANT SELECT ON TABLE public\.matches TO service_role/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.matches TO service_role/);
  console.log("  ✓ service_role matches SELECT privilege migration contract");
}

{
  assert.equal(
    assertActivePlayingDeadline({
      status: "playing",
      phase: "playing",
      turnDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
      currentSeat: 0,
      version: 3,
    }).ok,
    true
  );
  assert.equal(
    assertActivePlayingDeadline({
      status: "playing",
      phase: "playing",
      turnDeadlineAt: null,
      currentSeat: 0,
      version: 3,
    }).ok,
    false
  );
  assert.equal(
    assertActivePlayingDeadline({ status: "match_over", phase: "matchOver" }).terminal,
    true
  );
  assert.equal(
    isTerminalForTimeoutSweep({ status: "finished" }, { phase: "playing" }),
    true
  );
  console.log("  ✓ deadline invariant helpers");
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
  assert.equal(assertActivePlayingDeadline(store.sessions.get(MATCH_ID)).ok, true);
  store.sessions.get(MATCH_ID).turnDeadlineAt = new Date(Date.now() - 50).toISOString();
  const swept = await handleSweepDueTimeouts({
    store,
    candidates: [{ match_id: MATCH_ID, version: view.version }],
  });
  assert.equal(swept.results[0].status, "resolved");
  const after = store.sessions.get(MATCH_ID);
  if (after.status === "playing" && after.phase === "playing") {
    assert.equal(assertActivePlayingDeadline(after).ok, true, "post-timeout still-playing needs deadline");
    assert.ok(Date.parse(after.turnDeadlineAt) > Date.now() - 1000);
  } else {
    assert.ok(isTerminalForTimeoutSweep(store.matches.get(MATCH_ID), after));
  }
  console.log("  ✓ timeout transition leaves valid deadline or terminal");
}

{
  const now = Date.now();
  const view = {
    matchId: MATCH_ID,
    version: 1,
    phase: "playing",
    turnDeadlineAt: new Date(now - TIMEOUT_PENDING_RECONCILE_MS - 1000).toISOString(),
    serverNow: new Date(now).toISOString(),
    deadlineReceivedAt: new Date(now).toISOString(),
  };
  const key = `${MATCH_ID}|1|${view.turnDeadlineAt}`;
  const first = planTimeoutTick(view, { nowMs: now });
  assert.equal(
    first.action,
    "reconcile",
    "past grace without a prior resolve attempt still force-refetches"
  );
  const pending = planTimeoutTick(view, {
    nowMs: now,
    attemptedKey: key,
    lastReconcileAt: 0,
  });
  assert.equal(pending.action, "reconcile");
  const after = planTimeoutTick(view, {
    nowMs: now,
    attemptedKey: key,
    lastReconcileAt: now,
  });
  assert.equal(after.action, "wait");
  console.log("  ✓ overdue pending reconciles authoritative state before latching forever");
}

console.log("  ✓ deadline invariant + client reconcile");
