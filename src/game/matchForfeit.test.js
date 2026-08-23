/**
 * Active-match forfeit detection and single-loss recording.
 * Run: node src/game/matchForfeit.test.js
 */

import assert from "node:assert/strict";
import { PHASE } from "./rules/constants.js";
import { forfeitFingerprint, isMatchForfeitable } from "./matchForfeit.js";
import { recordMatch, resetStats, loadStats, STATS_STORAGE_KEY } from "../persistence/stats.js";

const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
    },
    removeItem(key) {
      memory.delete(key);
    },
  },
};

function playing(overrides = {}) {
  return {
    phase: PHASE.PLAYING,
    board: [{ id: "6-6" }],
    round: 1,
    scores: [0, 0],
    seed: 42,
    ...overrides,
  };
}

assert.equal(isMatchForfeitable(null), false);
assert.equal(isMatchForfeitable({}), false);
assert.equal(
  isMatchForfeitable(playing({ phase: PHASE.MATCH_OVER })),
  false,
  "finished matches are not forfeitable"
);
assert.equal(
  isMatchForfeitable(playing({ board: [], round: 1, scores: [0, 0] })),
  false,
  "unplayed opening is not forfeitable"
);
assert.equal(isMatchForfeitable(playing()), true, "a started board is forfeitable");
assert.equal(
  isMatchForfeitable(playing({ board: [], round: 2, scores: [0, 0] })),
  true,
  "later rounds are forfeitable"
);
assert.equal(
  isMatchForfeitable(playing({ board: [], round: 1, scores: [10, 0] })),
  true,
  "scored matches are forfeitable"
);
assert.equal(
  isMatchForfeitable(playing({ phase: PHASE.ROUND_OVER, board: [{ id: "5-5" }] })),
  true,
  "round-over with a real board is still forfeitable"
);

const fp = forfeitFingerprint(playing({ seed: 99 }));
assert.equal(fp, "99:forfeit");
assert.equal(fp, forfeitFingerprint(playing({ seed: 99 })), "fingerprint is stable");
assert.notEqual(fp, forfeitFingerprint(playing({ seed: 100 })));

memory.clear();
resetStats();
const result = { won: false, humanScore: 12, fingerprint: fp };
recordMatch(result);
recordMatch(result);
let stats = loadStats();
assert.equal(stats.losses, 1, "same forfeit fingerprint records exactly one loss");
assert.equal(stats.matchesPlayed, 1);

let abandoned = false;
function abandonOnce(state) {
  if (abandoned) return;
  abandoned = true;
  recordMatch({
    won: false,
    humanScore: state.scores?.[0] ?? 0,
    fingerprint: forfeitFingerprint(state),
  });
}

memory.set(STATS_STORAGE_KEY, "");
resetStats();
abandoned = false;
const active = playing({ seed: 7, scores: [8, 4] });
abandonOnce(active);
abandonOnce(active);
stats = loadStats();
assert.equal(stats.losses, 1, "abandon path plus fingerprint cannot double-count");
assert.equal(stats.matchesPlayed, 1);

resetStats();
recordMatch({
  won: false,
  humanScore: 0,
  fingerprint: `${active.seed}:m:0-0:1`,
});
assert.equal(loadStats().losses, 1, "a completed-match record is a normal loss");
recordMatch({
  won: false,
  humanScore: 0,
  fingerprint: `${active.seed}:m:0-0:1`,
});
assert.equal(loadStats().losses, 1, "completed-match fingerprint also dedupes");

console.log("Match forfeit tests passed.");
