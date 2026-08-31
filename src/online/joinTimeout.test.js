/**
 * Pre-start 3-minute join timeout helpers. No network.
 * Run: node src/online/joinTimeout.test.js
 */
import assert from "node:assert/strict";
import {
  JOIN_GRACE_MS,
  JOIN_TIMEOUT_REASON,
  applyJoinTimeoutResolution,
  classifyJoinWait,
  formatJoinCountdown,
  isGameplayStarted,
  isReservedNotStarted,
  isResumableMatch,
  isTerminalMatch,
  joinDeadlineFromIso,
  raceJoinAndTimeout,
  remainingJoinMs,
} from "./joinTimeout.js";

const reservedAt = "2026-08-30T12:00:00.000Z";
const deadline = joinDeadlineFromIso(reservedAt);
const t0 = Date.parse(reservedAt);

assert.equal(JOIN_GRACE_MS, 3 * 60 * 1000);
assert.equal(deadline, "2026-08-30T12:03:00.000Z");
assert.equal(remainingJoinMs(deadline, t0), JOIN_GRACE_MS);
assert.equal(remainingJoinMs(deadline, t0 + JOIN_GRACE_MS), 0);
assert.equal(formatJoinCountdown(JOIN_GRACE_MS), "3:00");
assert.equal(formatJoinCountdown(59_000), "0:59");
assert.equal(formatJoinCountdown(-1), "0:00");

assert.equal(isResumableMatch({ id: "m1", status: "ready" }), true);
assert.equal(isResumableMatch({ id: "m1", status: "playing" }), true);
assert.equal(isResumableMatch({ id: "m1", status: "finished", finishReason: "forfeit" }), false);
assert.equal(isResumableMatch({ id: "m1", status: "aborted", finishReason: "join_timeout" }), false);
assert.equal(isResumableMatch({ id: "m1", status: "playing", finishReason: "forfeit" }), false);
assert.equal(isResumableMatch({ id: "m1", status: "playing", finish_reason: "timeout" }), false);
assert.equal(isResumableMatch({ id: "m1", status: "ready", phase: "matchOver" }), false);
assert.equal(isResumableMatch({ id: "m1", status: "playing", sessionStatus: "match_over" }), false);
assert.equal(isResumableMatch({ status: "ready" }), false);
assert.equal(isTerminalMatch({ status: "finished" }), true);
assert.equal(isTerminalMatch({ status: "ready" }), false);
assert.equal(isReservedNotStarted({ status: "ready", hasGameSession: false }), true);
assert.equal(isReservedNotStarted({ status: "playing", hasGameSession: true, gameplayStarted: true }), false);
assert.equal(isGameplayStarted({ status: "playing", hasGameSession: true }), true);
assert.equal(isGameplayStarted({ status: "ready", hasGameSession: false }), false);

assert.equal(
  classifyJoinWait({
    now: t0 + 60_000,
    deadlineAt: deadline,
    gameplayStarted: false,
    matchStatus: "ready",
  }),
  "waiting"
);
assert.equal(
  classifyJoinWait({
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
    gameplayStarted: false,
    matchStatus: "ready",
  }),
  "join_timeout_due"
);
assert.equal(
  classifyJoinWait({
    now: t0 + JOIN_GRACE_MS + 1,
    deadlineAt: deadline,
    gameplayStarted: true,
    matchStatus: "playing",
  }),
  "started"
);

{
  const before = applyJoinTimeoutResolution({
    currentStatus: "ready",
    gameplayStarted: false,
    now: t0 + 60_000,
    deadlineAt: deadline,
  });
  assert.equal(before.changed, false);
  assert.equal(before.status, "ready");
  assert.equal(before.winner, null);
  assert.equal(before.rpChange, false);
}

{
  const expired = applyJoinTimeoutResolution({
    currentStatus: "ready",
    gameplayStarted: false,
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
  });
  assert.equal(expired.changed, true);
  assert.equal(expired.status, "aborted");
  assert.equal(expired.finishReason, JOIN_TIMEOUT_REASON);
  assert.equal(expired.winner, null);
  assert.equal(expired.loser, null);
  assert.equal(expired.rpChange, false);
  assert.equal(expired.ratedWlChange, false);
}

{
  const joined = applyJoinTimeoutResolution({
    currentStatus: "playing",
    gameplayStarted: true,
    now: t0 + JOIN_GRACE_MS + 5_000,
    deadlineAt: deadline,
  });
  assert.equal(joined.changed, false);
  assert.equal(joined.status, "playing");
}

{
  const first = applyJoinTimeoutResolution({
    currentStatus: "ready",
    gameplayStarted: false,
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
  });
  const second = applyJoinTimeoutResolution({
    currentStatus: first.status,
    finishReason: first.finishReason,
    gameplayStarted: false,
    now: t0 + JOIN_GRACE_MS + 10_000,
    deadlineAt: deadline,
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.changed, false);
  assert.equal(second.status, "aborted");
}

{
  const joinFirst = raceJoinAndTimeout("join", {
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
  });
  assert.equal(joinFirst.finalStatus, "playing");
  assert.equal(joinFirst.timeoutAfter.changed, false);

  const timeoutFirst = raceJoinAndTimeout("timeout", {
    currentStatus: "ready",
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
  });
  assert.equal(timeoutFirst.finalStatus, "aborted");
  assert.equal(timeoutFirst.joinAfter.rejected, true);
  assert.equal(timeoutFirst.timeout.winner, null);
  assert.equal(timeoutFirst.timeout.rpChange, false);
}

console.log("  ✓ join timeout helpers");
