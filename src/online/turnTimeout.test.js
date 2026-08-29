/**
 * Authoritative turn-timeout helpers. Run: node src/online/turnTimeout.test.js
 */
import assert from "node:assert/strict";
import {
  TIMEOUT_STRIKE_LIMIT,
  TIMEOUT_WARNING_MS,
  TURN_TIMEOUT_MS,
  formatTurnSeconds,
  isTurnDeadlineExpired,
  remainingTurnMs,
  stampDeadlineReceipt,
  turnTimerTone,
} from "./turnTimeout.js";

assert.equal(TURN_TIMEOUT_MS, 60_000);
assert.equal(TIMEOUT_WARNING_MS, 15_000);
assert.equal(TIMEOUT_STRIKE_LIMIT, 3);

{
  const serverNow = "2026-08-29T12:00:00.000Z";
  const view = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
    },
    { serverNow, deadlineReceivedMono: 1000 }
  );
  assert.equal(remainingTurnMs(view, Date.parse(serverNow), 1000), 60_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow) + 3600_000, 1000), 60_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow) - 3600_000, 1000), 60_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow), 1000 + 5_000), 55_000);
  assert.equal(isTurnDeadlineExpired(view, Date.parse(serverNow), 1000 + 60_000), true);
  assert.equal(turnTimerTone(15_000), "warning");
  assert.equal(turnTimerTone(16_000), "normal");
  assert.equal(turnTimerTone(0), "pending");
  assert.equal(formatTurnSeconds(15_000), 15);
  assert.equal(formatTurnSeconds(0), 0);
  console.log("  ✓ remaining time is server-deadline based; client clock cannot extend it");
}

{
  const first = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: 50 }
  );
  const afterRefresh = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: first.turnDeadlineAt,
    },
    { serverNow: "2026-08-29T12:00:10.000Z", deadlineReceivedMono: 50 }
  );
  assert.equal(afterRefresh.turnDeadlineAt, first.turnDeadlineAt);
  assert.ok(remainingTurnMs(afterRefresh, Date.parse(afterRefresh.serverNow), 50) < 60_000);
  console.log("  ✓ refresh keeps the same deadline instead of restarting at 60");
}

console.log("  ✓ turnTimeout helpers");
