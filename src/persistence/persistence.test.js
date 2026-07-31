/**
 * Persistence helpers verification (Node — no DOM localStorage).
 * Run: node src/persistence/persistence.test.js
 */

import assert from "node:assert/strict";
import { PHASE } from "../game/rules/constants.js";
import {
  isValidSavedMatch,
  MATCH_SAVE_VERSION,
  sanitizeSelectedId,
} from "./matchSave.js";
import {
  normalizeStats,
  winPercentage,
  averageRoundScore,
  DEFAULT_STATS,
} from "./stats.js";
import { normalizePrefs, THEMES, DEFAULT_PREFS } from "./prefs.js";

assert.equal(isValidSavedMatch(null), false);
assert.equal(isValidSavedMatch({ version: 1, state: { phase: "playing" } }), false);
assert.equal(isValidSavedMatch({ version: 99, state: {} }), false);

assert.equal(
  isValidSavedMatch({
    version: MATCH_SAVE_VERSION,
    state: {
      players: [{ id: "a", hand: ["0-0"] }, { id: "b", hand: ["1-1"] }],
      byId: { "0-0": { id: "0-0" }, "1-1": { id: "1-1" } },
      board: [],
      reserve: [],
      scores: [0, 0],
      round: 1,
      phase: PHASE.PLAYING,
      currentPlayer: 0,
      targetScore: 100,
    },
  }),
  true
);

assert.equal(
  isValidSavedMatch({
    version: MATCH_SAVE_VERSION,
    state: {
      players: [{ id: "a", hand: [] }, { id: "b", hand: [] }],
      byId: {},
      board: [],
      reserve: [],
      scores: [0],
      round: 1,
      phase: PHASE.PLAYING,
      currentPlayer: 0,
      targetScore: 100,
    },
  }),
  false
);

assert.equal(
  sanitizeSelectedId({ players: [{ hand: ["1-2", "3-3"] }] }, "9-9"),
  null
);
assert.equal(
  sanitizeSelectedId({ players: [{ hand: ["1-2", "3-3"] }] }, "3-3"),
  "3-3"
);

assert.deepEqual(normalizeStats(null), DEFAULT_STATS);
assert.equal(winPercentage({ ...DEFAULT_STATS, matchesPlayed: 4, wins: 3 }), 75);
assert.equal(averageRoundScore({ ...DEFAULT_STATS, roundsPlayed: 2, totalRoundPoints: 25 }), 12.5);

assert.equal(normalizePrefs({ theme: "noir", vibration: 0 }).theme, "noir");
assert.equal(normalizePrefs({ theme: "noir", vibration: 0 }).vibration, false);
assert.ok(THEMES.includes(DEFAULT_PREFS.theme));

console.log("Persistence tests passed.");
