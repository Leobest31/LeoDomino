/**
 * Persistence helpers verification (Node — no DOM localStorage).
 * Run: node src/persistence/persistence.test.js
 */

import assert from "node:assert/strict";
import { PHASE } from "../game/rules/constants.js";
import { startMatch } from "../game/index.js";
import {
  isValidSavedMatch,
  MATCH_SAVE_VERSION,
  normalizeStateRuleset,
  sanitizeMatchState,
  sanitizeSelectedId,
} from "./matchSave.js";
import {
  normalizeStats,
  winPercentage,
  averageRoundScore,
  DEFAULT_STATS,
} from "./stats.js";
import { normalizePrefs, THEMES, TILE_SKINS, DEFAULT_PREFS } from "./prefs.js";

function baseState(overrides = {}) {
  return {
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: ["1-1"] },
    ],
    byId: {
      "0-0": { id: "0-0", a: 0, b: 0, isDouble: true },
      "1-1": { id: "1-1", a: 1, b: 1, isDouble: true },
    },
    board: [],
    reserve: [],
    scores: [0, 0],
    round: 1,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    targetScore: 100,
    mustPlayTileId: null,
    ...overrides,
  };
}

function wrap(state) {
  return { version: MATCH_SAVE_VERSION, state };
}

// --- Shape / version ---
assert.equal(isValidSavedMatch(null), false);
assert.equal(isValidSavedMatch({ version: 1, state: { phase: "playing" } }), false);
assert.equal(isValidSavedMatch({ version: 99, state: {} }), false);

assert.equal(isValidSavedMatch(wrap(baseState())), true);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        scores: [0],
      })
    )
  ),
  false
);

// --- Player count bounds (2–4) ---
assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        players: [{ id: "solo", hand: ["0-0"] }],
        scores: [0],
        byId: { "0-0": { id: "0-0" } },
      })
    )
  ),
  false
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        players: [
          { id: "a", hand: ["0-0"] },
          { id: "b", hand: ["1-1"] },
          { id: "c", hand: ["2-2"] },
          { id: "d", hand: ["3-3"] },
          { id: "e", hand: ["4-4"] },
        ],
        scores: [0, 0, 0, 0, 0],
        byId: {
          "0-0": { id: "0-0" },
          "1-1": { id: "1-1" },
          "2-2": { id: "2-2" },
          "3-3": { id: "3-3" },
          "4-4": { id: "4-4" },
        },
      })
    )
  ),
  false
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        players: [
          { id: "a", hand: ["0-0"] },
          { id: "b", hand: ["1-1"] },
          { id: "c", hand: ["2-2"] },
          { id: "d", hand: ["3-3"] },
        ],
        scores: [0, 0, 0, 0],
        byId: {
          "0-0": { id: "0-0" },
          "1-1": { id: "1-1" },
          "2-2": { id: "2-2" },
          "3-3": { id: "3-3" },
        },
      })
    )
  ),
  true
);

// --- Finite scores ---
assert.equal(isValidSavedMatch(wrap(baseState({ scores: [NaN, 0] }))), false);
assert.equal(isValidSavedMatch(wrap(baseState({ scores: [Infinity, 0] }))), false);
assert.equal(isValidSavedMatch(wrap(baseState({ scores: ["0", 0] }))), false);

// --- Unique tile partition + ids ⊆ byId ---
assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        players: [
          { id: "a", hand: ["0-0"] },
          { id: "b", hand: ["0-0"] },
        ],
        byId: { "0-0": { id: "0-0" } },
      })
    )
  ),
  false,
  "duplicate id across hands"
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        players: [
          { id: "a", hand: ["0-0"] },
          { id: "b", hand: ["9-9"] },
        ],
      })
    )
  ),
  false,
  "ghost id not in byId"
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        reserve: ["0-0"],
      })
    )
  ),
  false,
  "duplicate id hand + reserve"
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        board: [{ id: "0-0", left: 0, right: 0, orientation: "vertical" }],
        players: [
          { id: "a", hand: [] },
          { id: "b", hand: ["1-1"] },
        ],
      })
    )
  ),
  true,
  "board tiles participate in partition"
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        board: [{ id: "ghost", left: 0, right: 1, orientation: "horizontal" }],
      })
    )
  ),
  false,
  "ghost board id"
);

// --- mustPlayTileId integrity ---
assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        mustPlayTileId: "0-0",
        currentPlayer: 0,
      })
    )
  ),
  true
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        mustPlayTileId: "1-1",
        currentPlayer: 0,
      })
    )
  ),
  false,
  "mustPlayTileId not in current hand"
);

assert.equal(
  isValidSavedMatch(
    wrap(
      baseState({
        mustPlayTileId: 42,
      })
    )
  ),
  false
);

// --- sanitizeMatchState clears orphan mustPlay ---
{
  const orphan = baseState({
    mustPlayTileId: "6-6",
    currentPlayer: 0,
  });
  const cleaned = sanitizeMatchState(orphan);
  assert.equal(cleaned.mustPlayTileId, null);
  assert.equal(isValidSavedMatch(wrap(cleaned)), true);

  const valid = baseState({ mustPlayTileId: "0-0", currentPlayer: 0 });
  assert.equal(sanitizeMatchState(valid).mustPlayTileId, "0-0");
}

// --- Live startMatch snapshots remain valid ---
{
  for (const playerCount of [2, 3, 4]) {
    const state = startMatch({ seed: 900 + playerCount, playerCount, targetScore: 100 });
    assert.equal(
      isValidSavedMatch(wrap(state)),
      true,
      `fresh ${playerCount}p match should validate`
    );
    const afterSanitize = sanitizeMatchState(state);
    assert.equal(isValidSavedMatch(wrap(afterSanitize)), true);
    if (state.mustPlayTileId) {
      const hand = state.players[state.currentPlayer].hand;
      assert.ok(hand.includes(state.mustPlayTileId));
    }
  }
}

// --- Intentional corrupt-save stress cases ---
{
  const live = startMatch({ seed: 4242, playerCount: 2, targetScore: 100 });
  const dupHand = structuredClone(live);
  dupHand.players[1].hand = [...dupHand.players[1].hand, dupHand.players[0].hand[0]];
  assert.equal(isValidSavedMatch(wrap(dupHand)), false, "live clone with duplicate id");

  const ghost = structuredClone(live);
  ghost.players[0].hand = [...ghost.players[0].hand, "nope-tile"];
  assert.equal(isValidSavedMatch(wrap(ghost)), false, "live clone with ghost id");

  const orphanMust = structuredClone(live);
  orphanMust.mustPlayTileId = "nope-tile";
  assert.equal(isValidSavedMatch(wrap(orphanMust)), false, "orphan mustPlay rejected");
  const fixed = sanitizeMatchState(orphanMust);
  assert.equal(fixed.mustPlayTileId, null);
  assert.equal(isValidSavedMatch(wrap(fixed)), true, "sanitize recovers orphan mustPlay");

  const badScore = structuredClone(live);
  badScore.scores[0] = Number.NaN;
  assert.equal(isValidSavedMatch(wrap(badScore)), false);
}

// --- rulesetId migration / validation ---
{
  const noRuleset = baseState();
  assert.equal(isValidSavedMatch(wrap(noRuleset)), true, "missing rulesetId ok");
  const migrated = normalizeStateRuleset(noRuleset);
  assert.equal(migrated.rulesetId, "legacy");

  assert.equal(
    isValidSavedMatch(wrap(baseState({ rulesetId: "legacy" }))),
    true
  );
  assert.equal(
    isValidSavedMatch(wrap(baseState({ rulesetId: "not-real" }))),
    false,
    "unknown ruleset rejected"
  );
  assert.equal(normalizeStateRuleset(baseState({ rulesetId: "not-real" })), null);

  const live = startMatch({ seed: 77, playerCount: 2, targetScore: 100 });
  assert.equal(live.rulesetId, "legacy");
  assert.equal(isValidSavedMatch(wrap(live)), true);
}

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
assert.equal(normalizePrefs({ tileSkin: "premium" }).tileSkin, "premium");
assert.equal(normalizePrefs({ tileSkin: "nope" }).tileSkin, "classic");
assert.ok(THEMES.includes(DEFAULT_PREFS.theme));
assert.ok(TILE_SKINS.includes(DEFAULT_PREFS.tileSkin));

console.log("Persistence tests passed.");
