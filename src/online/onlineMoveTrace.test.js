/**
 * DEV-only sync trace helpers — no secrets, no hands, no board faces.
 * Run: node src/online/onlineMoveTrace.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boardLengthOf,
  logOnlineSyncTrace,
  summarizeRealtimePayload,
} from "./onlineMoveTrace.js";

const here = dirname(fileURLToPath(import.meta.url));
const traceSrc = readFileSync(join(here, "onlineMoveTrace.js"), "utf8");
const hookSrc = readFileSync(join(here, "../hooks/useOnlineMatch.js"), "utf8");

{
  const missing = summarizeRealtimePayload(null);
  assert.equal(missing.hasRow, false);
  assert.equal(missing.boardPresent, false);
  assert.equal(missing.boardIsArray, false);
  assert.equal(missing.boardLength, null);

  const full = summarizeRealtimePayload({
    new: {
      version: 7,
      board: [{ id: "6-6", left: 6, right: 6 }, { id: "6-1", left: 6, right: 1 }],
      myHand: ["secret-tile"],
    },
  });
  assert.equal(full.hasRow, true);
  assert.equal(full.boardPresent, true);
  assert.equal(full.boardIsArray, true);
  assert.equal(full.boardLength, 2);
  assert.equal(full.version, 7);
  assert.equal("myHand" in full, false, "summary must not copy private hands");
  assert.equal(Object.keys(full).includes("board"), false);

  const encoded = summarizeRealtimePayload({
    new: { version: 3, board: JSON.stringify([{ id: "0-0" }]) },
  });
  assert.equal(encoded.boardIsArray, true);
  assert.equal(encoded.boardLength, 1);

  const noBoard = summarizeRealtimePayload({ new: { version: 4 } });
  assert.equal(noBoard.boardPresent, false);
  assert.equal(noBoard.boardIsArray, false);
  assert.equal(noBoard.version, 4);
}

assert.equal(boardLengthOf({ board: [1, 2, 3] }), 3);
assert.equal(boardLengthOf({}), 0);

{
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args);
  try {
    logOnlineSyncTrace("realtime", {
      boardPresent: true,
      myHand: ["6-6"],
      board: [{ id: "6-6" }],
      token: "secret",
      payload: { new: {} },
      version: 2,
    });
  } finally {
    console.info = original;
  }
  if (lines.length) {
    const dumped = JSON.stringify(lines);
    assert.equal(dumped.includes("6-6"), false);
    assert.equal(dumped.includes("secret"), false);
    assert.equal(dumped.includes("myHand"), false);
  }
}

assert.match(traceSrc, /isOnlineMoveTraceEnabled\(\)/);
assert.match(traceSrc, /leoOnlineTrace/);
assert.match(traceSrc, /export function logOnlineAction/);
assert.match(traceSrc, /"access_token"/);
assert.match(traceSrc, /SYNC_UNSAFE_KEYS/);
assert.doesNotMatch(traceSrc, /service_role/);
assert.match(hookSrc, /logOnlineAction\("action-submit"/);
assert.match(hookSrc, /logOnlineAction\("action-http"/);
assert.match(hookSrc, /logOnlineSyncTrace\("realtime"/);
assert.match(hookSrc, /planRealtimeSessionEvent/);
assert.match(hookSrc, /paintPublicBoard/);
assert.match(hookSrc, /logOnlineSyncTrace\("getGameView-start"/);
assert.match(hookSrc, /logOnlineSyncTrace\("getGameView-end"/);
assert.match(hookSrc, /logOnlineSyncTrace\("applyView"/);
assert.match(hookSrc, /raf-after-applyView/);
assert.match(hookSrc, /summarizeRealtimePayload\(payload\)/);
assert.doesNotMatch(hookSrc, /logOnlineSyncTrace\([\s\S]*myHand/);
assert.doesNotMatch(hookSrc, /console\.info\([\s\S]*myHand/);

console.log("  ✓ online-sync DEV trace helpers");
