/**
 * C2 occupancy stale classification + reconnect-order regression.
 * Run: node src/online/occupancyStale.test.js
 */
import assert from "node:assert/strict";
import {
  PRESENCE_GRACE_MS,
  applyOccupancyDecision,
  classifyOccupiedPresence,
  cleanupOccupiedMatch,
  occupiedMatch,
  runPresenceOps,
  touchMatchPresence,
  touchMatchPresenceStampFirst,
} from "./occupancyStale.js";

const NOW = Date.parse("2026-09-02T22:00:00.000Z");
const GRACE = PRESENCE_GRACE_MS;
const FRESH = NOW - 30_000;
const INSIDE_GRACE = NOW - GRACE;
const JUST_INSIDE = NOW - GRACE + 1;
const STALE = NOW - GRACE - 1;
const JOINED = NOW - 20 * 60_000;

function liveBoth({ seenA, seenB, ...rest } = {}) {
  return occupiedMatch({
    seenA,
    seenB,
    joinedA: JOINED,
    joinedB: JOINED,
    ...rest,
  });
}

function assertAbort(match, label) {
  assert.equal(match.status, "aborted", `${label}: aborted`);
  assert.equal(match.winner, null, `${label}: no winner`);
  assert.equal(match.loser, null, `${label}: no loser`);
  assert.equal(match.rpSettled, false, `${label}: no RP settle`);
  assert.equal(match.rpLedger, null, `${label}: no RP ledger`);
  assert.equal(match.ratingsChanged, false, `${label}: ratings unchanged`);
}

function assertForfeit(match, loser, label) {
  const winner = loser === "a" ? "b" : "a";
  assert.equal(match.status, "finished", `${label}: finished`);
  assert.equal(match.finishReason, "forfeit", `${label}: forfeit`);
  assert.equal(match.loser, loser, `${label}: loser`);
  assert.equal(match.winner, winner, `${label}: winner`);
  assert.equal(match.rpSettled, true, `${label}: RP settled`);
  assert.equal(match.rpLedger?.loser, loser, `${label}: ledger loser`);
  assert.equal(match.rpLedger?.winner, winner, `${label}: ledger winner`);
}

{
  const decision = classifyOccupiedPresence({
    status: "playing",
    seenA: FRESH,
    seenB: FRESH,
    joinedA: JOINED,
    joinedB: JOINED,
    now: NOW,
  });
  assert.equal(decision.action, "none");
  assert.equal(decision.reason, "neither_stale");
  const { match } = cleanupOccupiedMatch(liveBoth({ seenA: FRESH, seenB: FRESH }), NOW);
  assert.equal(match.status, "playing");
  assert.equal(match.winner, null);
  assert.equal(match.rpSettled, false);
  console.log("  ✓ A neither stale → nothing happens");
}

{
  const { match } = cleanupOccupiedMatch(liveBoth({ seenA: FRESH, seenB: STALE }), NOW);
  assertForfeit(match, "b", "B");
  console.log("  ✓ B A fresh, B stale > grace → B forfeits");
}

{
  const { match } = cleanupOccupiedMatch(liveBoth({ seenA: STALE, seenB: FRESH }), NOW);
  assertForfeit(match, "a", "C");
  console.log("  ✓ C B fresh, A stale > grace → A forfeits");
}

{
  const { match, decision } = cleanupOccupiedMatch(liveBoth({ seenA: STALE, seenB: STALE, rated: true }), NOW);
  assert.equal(decision.action, "abort");
  assertAbort(match, "D");
  console.log("  ✓ D A stale + B stale → abort, no winner, no RP");
}

{
  const bothStale = liveBoth({ seenA: STALE, seenB: STALE, rated: true });
  const { match } = touchMatchPresence(bothStale, "a", NOW);
  assertAbort(match, "E");
  const buggy = touchMatchPresenceStampFirst(bothStale, "a", NOW);
  assert.equal(buggy.match.loser, "b", "pre-C2 stamp-first would forfeit B");
  console.log("  ✓ E both stale, A reconnects first → B must NOT forfeit");
}

{
  const bothStale = liveBoth({ seenA: STALE, seenB: STALE, rated: true });
  const { match } = touchMatchPresence(bothStale, "b", NOW);
  assertAbort(match, "F");
  const buggy = touchMatchPresenceStampFirst(bothStale, "b", NOW);
  assert.equal(buggy.match.loser, "a", "pre-C2 stamp-first would forfeit A");
  console.log("  ✓ F both stale, B reconnects first → A must NOT forfeit");
}

{
  const bothStale = liveBoth({ seenA: STALE, seenB: STALE, rated: true });
  const sharedSnap = {
    status: "playing",
    seenA: STALE,
    seenB: STALE,
    joinedA: JOINED,
    joinedB: JOINED,
    now: NOW,
  };
  const snapA = classifyOccupiedPresence(sharedSnap);
  const snapB = classifyOccupiedPresence(sharedSnap);
  assert.equal(snapA.action, "abort");
  assert.equal(snapB.action, "abort");
  const afterA = applyOccupancyDecision(bothStale, snapA);
  const afterBoth = applyOccupancyDecision(afterA, snapB);
  assertAbort(afterA, "G first");
  assertAbort(afterBoth, "G second idempotent");
  const aThenB = runPresenceOps(bothStale, NOW, ["touch:a", "touch:b"]);
  const bThenA = runPresenceOps(bothStale, NOW, ["touch:b", "touch:a"]);
  assertAbort(aThenB.match, "G A then B");
  assertAbort(bThenA.match, "G B then A");
  console.log("  ✓ G both stale, both reconnect nearly simultaneously → no false winner");
}

{
  const { match: aInside } = cleanupOccupiedMatch(liveBoth({ seenA: JUST_INSIDE, seenB: FRESH }), NOW);
  const { match: bInside } = cleanupOccupiedMatch(liveBoth({ seenA: FRESH, seenB: INSIDE_GRACE }), NOW);
  assert.equal(aInside.status, "playing", "A just inside grace");
  assert.equal(bInside.status, "playing", "B exactly at grace is not < stale");
  assert.equal(aInside.rpSettled, false);
  assert.equal(bInside.rpSettled, false);
  console.log("  ✓ H one player just inside grace → no cleanup");
}

{
  const { match: viaCleanup } = cleanupOccupiedMatch(liveBoth({ seenA: FRESH, seenB: STALE }), NOW);
  const { match: viaTouchA } = touchMatchPresence(liveBoth({ seenA: FRESH, seenB: STALE }), "a", NOW);
  assertForfeit(viaCleanup, "b", "I cleanup");
  assertForfeit(viaTouchA, "b", "I A still fresh heartbeat");
  console.log("  ✓ I one genuinely stale, other continuously fresh → valid forfeit still works");
}

{
  for (const status of ["finished", "aborted", "join_timeout", "timeout"]) {
    const { match, decision } = cleanupOccupiedMatch(
      occupiedMatch({
        status,
        finishReason: status === "finished" ? "completed" : status,
        seenA: STALE,
        seenB: STALE,
        joinedA: JOINED,
        joinedB: JOINED,
      }),
      NOW
    );
    assert.equal(decision.reason, "terminal", status);
    assert.equal(match.status, status, `${status} untouched`);
    assert.equal(match.rpSettled, false);
  }
  const { match: forfeited } = cleanupOccupiedMatch(
    occupiedMatch({
      status: "finished",
      finishReason: "forfeit",
      seenA: STALE,
      seenB: STALE,
      joinedA: JOINED,
      joinedB: JOINED,
      rated: true,
    }),
    NOW
  );
  assert.equal(forfeited.status, "finished");
  assert.equal(forfeited.finishReason, "forfeit");
  assert.equal(forfeited.rpSettled, false, "cleanup does not re-settle a terminal forfeit");
  console.log("  ✓ J terminal match → untouched");
}

{
  const { match } = cleanupOccupiedMatch(liveBoth({ seenA: STALE, seenB: STALE, rated: true }), NOW);
  assertAbort(match, "K");
  assert.equal(match.rpLedger, null);
  assert.equal(match.ratingsChanged, false);
  console.log("  ✓ K shared-stale rated match → no RP ledger settlement");
}

{
  const bothStale = liveBoth({ seenA: STALE, seenB: STALE, rated: true });
  const orders = [
    ["cleanup"],
    ["touch:a"],
    ["touch:b"],
    ["touch:a", "cleanup"],
    ["cleanup", "touch:a"],
    ["touch:b", "cleanup"],
    ["cleanup", "touch:b"],
    ["cleanup", "touch:a", "touch:b"],
    ["touch:a", "touch:b", "cleanup"],
    ["touch:b", "touch:a", "cleanup"],
  ];
  for (const ops of orders) {
    const { match } = runPresenceOps(bothStale, NOW, ops);
    assertAbort(match, ops.join(" → "));
  }
  console.log("  ✓ L cleanup/touch race → order-independent abort");
}

{
  const genuine = liveBoth({ seenA: FRESH, seenB: STALE });
  const viaCleanup = runPresenceOps(genuine, NOW, ["cleanup"]);
  const touchThenCleanup = runPresenceOps(genuine, NOW, ["touch:a", "cleanup"]);
  const cleanupThenTouch = runPresenceOps(genuine, NOW, ["cleanup", "touch:a"]);
  assertForfeit(viaCleanup.match, "b", "M one-stale cleanup");
  assertForfeit(touchThenCleanup.match, "b", "M touch then cleanup");
  assertForfeit(cleanupThenTouch.match, "b", "M cleanup then touch");

  const terminalCommit = occupiedMatch({
    status: "finished",
    finishReason: "completed",
    seenA: STALE,
    seenB: STALE,
    joinedA: JOINED,
    joinedB: JOINED,
  });
  const afterCleanup = cleanupOccupiedMatch(terminalCommit, NOW).match;
  const afterTouch = touchMatchPresence(terminalCommit, "a", NOW).match;
  assert.equal(afterCleanup.status, "finished");
  assert.equal(afterCleanup.finishReason, "completed");
  assert.equal(afterTouch.status, "finished");
  assert.equal(afterTouch.finishReason, "completed");
  assert.equal(afterCleanup.winner, null);
  assert.equal(afterTouch.rpSettled, false);
  console.log("  ✓ M cleanup/game-commit race → no terminal corruption; one-stale still forfeits");
}

{
  const waiting = occupiedMatch({
    status: "ready",
    seenA: STALE,
    seenB: STALE,
    joinedA: null,
    joinedB: JOINED,
  });
  const decision = classifyOccupiedPresence({
    status: "ready",
    seenA: STALE,
    seenB: STALE,
    joinedA: null,
    joinedB: JOINED,
    now: NOW,
  });
  assert.equal(decision.action, "none");
  assert.equal(decision.reason, "join_waiting");
  const { match } = cleanupOccupiedMatch(waiting, NOW);
  assert.equal(match.status, "ready", "join-waiting is not a 5-minute forfeit/abort");
  console.log("  ✓ join-waiting is not classified as 5-minute both-stale");
}

console.log("  ✓ occupancy stale C2 decision table");
