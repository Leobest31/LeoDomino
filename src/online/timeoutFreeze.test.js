/**
 * Timeout same-version network guard, backoff, and browser clock restamp.
 * Run: node src/online/timeoutFreeze.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keepAuthoritativeView } from "./onlineTable.js";
import {
  overlayNewerTimeoutClock,
  remainingTurnMs,
  stampClientDeadlineReceipt,
  stampDeadlineReceipt,
  TURN_TIMEOUT_MS,
  turnTimerTone,
} from "./turnTimeout.js";
import {
  nextTimeoutRetryAt,
  planTimeoutTick,
  timeoutResolveKey,
  TIMEOUT_RESOLVE_RETRY_MS,
} from "./timeoutFreeze.js";

const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");

function playingClockView(extras = {}) {
  return stampDeadlineReceipt(
    {
      matchId: MATCH_ID,
      phase: "playing",
      status: "playing",
      version: 2,
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
      timeoutStrikes: [0, 0],
      myHand: ["6-6"],
      handCounts: [1, 1],
      legalMoves: [{ tileId: "6-6", end: "left" }],
      canPlay: true,
      canDraw: false,
      canPass: false,
      interactionSource: "viewer",
      ...extras,
    },
    {
      serverNow: extras.serverNow ?? "2026-08-29T12:00:00.000Z",
      deadlineReceivedMono: extras.deadlineReceivedMono ?? 1000,
    }
  );
}

{
  const isolateMono = 12;
  const clientMono = 180_000;
  const wired = stampDeadlineReceipt(
    {
      phase: "playing",
      turnDeadlineAt: "2026-08-29T12:01:00.000Z",
    },
    { serverNow: "2026-08-29T12:00:00.000Z", deadlineReceivedMono: isolateMono }
  );
  assert.equal(remainingTurnMs(wired, Date.parse(wired.serverNow), clientMono), 0);
  assert.equal(turnTimerTone(0), "pending");
  const client = stampClientDeadlineReceipt(wired, clientMono);
  assert.equal(remainingTurnMs(client, Date.parse(client.serverNow), clientMono), TURN_TIMEOUT_MS);
  console.log("  ✓ Edge isolate monotonic clock cannot freeze the client at 00:00");
}

{
  const previous = playingClockView();
  const incoming = stampClientDeadlineReceipt(
    {
      ...previous,
      serverNow: "2026-08-29T12:00:50.000Z",
    },
    9999
  );
  const kept = keepAuthoritativeView(previous, incoming);
  assert.deepEqual(kept.myHand, ["6-6"]);
  assert.equal(kept.serverNow, incoming.serverNow);
  assert.ok(remainingTurnMs(kept, Date.parse(kept.serverNow), kept.deadlineReceivedMono) > 0);
  console.log("  ✓ same-version refresh restamps the clock instead of staying on Waiting for timeout");
}

{
  const expired = playingClockView({ matchId: MATCH_ID, version: 2, turnDeadlineAt: "2026-08-29T12:01:00.000Z" });
  const key = timeoutResolveKey(expired);
  assert.equal(key, `${MATCH_ID}|2|2026-08-29T12:01:00.000Z`);
  const visualTick = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    nowMs: Date.parse(expired.serverNow) + 60_000,
    monoMs: 1000 + 60_000,
  });
  assert.equal(visualTick.action, "wait", "same version/deadline cannot network-resolve every tick");
  const afterBackoff = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    retryNotBefore: Date.parse(expired.serverNow) + 50_000,
    nowMs: Date.parse(expired.serverNow) + 70_000,
    monoMs: 1000 + 70_000,
  });
  assert.equal(afterBackoff.action, "resolve");
  const newVersion = planTimeoutTick(
    { ...expired, version: 3, turnDeadlineAt: "2026-08-29T12:02:00.000Z" },
    {
      inFlight: false,
      attemptedKey: key,
      nowMs: Date.parse("2026-08-29T12:02:00.000Z") + 60_000,
      monoMs: 1000 + 120_000,
    }
  );
  assert.equal(newVersion.action, "resolve");
  const focusCannotBypass = planTimeoutTick(expired, {
    inFlight: false,
    attemptedKey: key,
    nowMs: Date.parse(expired.serverNow) + 180_000,
    monoMs: 1000 + 180_000,
  });
  assert.equal(focusCannotBypass.action, "wait");
  assert.ok(nextTimeoutRetryAt(0, 0) === TIMEOUT_RESOLVE_RETRY_MS[0]);
  console.log("  ✓ same match/version/deadline is gated; new version can resolve; focus cannot bypass");
}

{
  const overlay = overlayNewerTimeoutClock(
    playingClockView(),
    { serverNow: "2026-08-29T12:00:40.000Z", turnDeadlineAt: "2026-08-29T12:01:00.000Z" },
    5000
  );
  assert.equal(overlay.deadlineReceivedMono, 5000);
  assert.equal(remainingTurnMs(overlay, Date.parse(overlay.serverNow), 5000), 20_000);
  console.log("  ✓ opponent remaining time follows the server deadline after reconcile");
}

{
  assert.match(hook, /planTimeoutTick/);
  assert.match(hook, /timeoutResolveKey/);
  assert.match(hook, /timeoutAttemptedKeyRef/);
  assert.match(hook, /attemptedKey: timeoutAttemptedKeyRef/);
  assert.match(hook, /setInterval\(tick, 250\)/);
  assert.match(hook, /roundAdvanceAtVersionRef\.current = version/);
  assert.match(hook, /advanceRound\(\)/);
  assert.match(hook, /error\?\.code === "STALE_VERSION"/);
  assert.match(hook, /error\?\.code === "TIMEOUT_NOT_DUE"/);
  assert.match(hook, /asViewerSnapshot/);
  assert.match(hook, /nextTimeoutRetryAt/);
  console.log("  ✓ hook gates timeout RPC and treats stale advance/timeout as refresh+backoff");
}

console.log("  ✓ timeout freeze-safety");
