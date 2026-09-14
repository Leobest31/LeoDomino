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
  overlayNewerTimeoutClock,
  remainingTurnMs,
  stampClientDeadlineReceipt,
  stampDeadlineReceipt,
  turnTimerTone,
} from "./turnTimeout.js";

assert.equal(TURN_TIMEOUT_MS, 30_000);
assert.equal(TIMEOUT_WARNING_MS, 15_000);
assert.equal(TIMEOUT_STRIKE_LIMIT, 3);

{
  const serverNow = "2026-08-29T12:00:00.000Z";
  const view = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
    },
    { serverNow, deadlineReceivedMono: 1000 }
  );
  assert.equal(remainingTurnMs(view, Date.parse(serverNow), 1000), 30_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow) + 3600_000, 1000), 30_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow) - 3600_000, 1000), 30_000);
  assert.equal(remainingTurnMs(view, Date.parse(serverNow), 1000 + 5_000), 25_000);
  assert.equal(isTurnDeadlineExpired(view, Date.parse(serverNow), 1000 + 29_999), false);
  assert.equal(isTurnDeadlineExpired(view, Date.parse(serverNow), 1000 + 30_000), true);
  assert.equal(turnTimerTone(15_000), "warning");
  assert.equal(turnTimerTone(16_000), "normal");
  assert.equal(turnTimerTone(0), "pending");
  assert.equal(formatTurnSeconds(15_000), 15);
  assert.equal(formatTurnSeconds(1), 1);
  assert.equal(formatTurnSeconds(0), 0);
  assert.equal(formatTurnSeconds(30_000), 30);
  console.log("  ✓ remaining time is server-deadline based; 29.999s does not expire; 30s does");
}

{
  const first = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
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
  assert.ok(remainingTurnMs(afterRefresh, Date.parse(afterRefresh.serverNow), 50) < 30_000);
  console.log("  ✓ refresh keeps the same deadline instead of restarting at 30");
}

{
  const wired = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: 8 }
  );
  const client = stampClientDeadlineReceipt(wired, 90_000);
  assert.equal(remainingTurnMs(wired, Date.parse(wired.serverNow), 90_000), 0);
  assert.equal(remainingTurnMs(client, Date.parse(client.serverNow), 90_000), 30_000);
  const overlaid = overlayNewerTimeoutClock(
    client,
    { ...client, serverNow: "2026-08-29T12:00:15.000Z" },
    90_000
  );
  assert.equal(remainingTurnMs(overlaid, Date.parse(overlaid.serverNow), 90_000), 15_000);
  console.log("  ✓ client restamp and newer serverNow reconcile remaining time");
}

{
  const hydrated = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: 200 }
  );
  const afterHydrate = stampClientDeadlineReceipt(
    { ...hydrated, serverNow: "2026-08-29T12:00:08.000Z" },
    200
  );
  assert.equal(afterHydrate.turnDeadlineAt, hydrated.turnDeadlineAt);
  assert.equal(remainingTurnMs(afterHydrate, Date.parse(afterHydrate.serverNow), 200), 22_000);
  console.log("  ✓ hydration does not reset the authoritative deadline");
}

{
  const before = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: 10 }
  );
  const reconnect = overlayNewerTimeoutClock(
    before,
    { turnDeadlineAt: before.turnDeadlineAt, serverNow: "2026-08-29T12:00:12.000Z" },
    10 + 12_000
  );
  assert.equal(reconnect.turnDeadlineAt, before.turnDeadlineAt);
  assert.equal(remainingTurnMs(reconnect, Date.parse(reconnect.serverNow), 10 + 12_000), 18_000);
  console.log("  ✓ reconnect does not reset the authoritative deadline");
}

{
  const before = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:00:30.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: 400 }
  );
  const resume = overlayNewerTimeoutClock(
    before,
    { turnDeadlineAt: before.turnDeadlineAt, serverNow: "2026-08-29T12:00:20.000Z" },
    400 + 20_000
  );
  assert.equal(resume.turnDeadlineAt, before.turnDeadlineAt);
  assert.equal(remainingTurnMs(resume, Date.parse(resume.serverNow), 400 + 20_000), 10_000);
  console.log("  ✓ background/resume does not reset the authoritative deadline");
}

console.log("  ✓ turnTimeout helpers");
