/**
 * Legacy All Fives → American migration (All Fives is no longer a separate style).
 * Run: node src/game/rulesets/allFives.test.js
 */

import assert from "node:assert/strict";
import {
  ALL_FIVES_MATCH_TARGET,
  ALL_FIVES_RULESET_ID,
  AMERICAN_MATCH_TARGET,
  AMERICAN_RULESET_ID,
  END,
  LEGACY_RULESET_ID,
  PHASE,
  calculateAllFivesRoundPoints,
  calculateRoundPoints,
  coerceRulesetId,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
  getGameStyle,
  isKnownRulesetId,
  listAvailableGameStyles,
  normalizeGameStyleId,
  normalizeRulesetId,
  playTile,
  resolveRuleset,
  startMatch,
  tryResolveRuleset,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset as normalizeSaveRuleset,
} from "../../persistence/matchSave.js";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";

function section(title) {
  console.log(`✓ ${title}`);
}

{
  const styles = listAvailableGameStyles();
  assert.ok(styles.some((s) => s.id === "american"));
  assert.ok(!styles.some((s) => s.id === "allFives"));
  assert.equal(getGameStyle("allFives"), null);
  assert.equal(gameStyleToRulesetId("allFives"), null);
  assert.equal(normalizeGameStyleId("allFives"), "american");
  assert.equal(normalizeGameStyleId(ALL_FIVES_RULESET_ID), "american");
  assert.equal(gameStyleForRulesetId(ALL_FIVES_RULESET_ID)?.id, "american");
  section("Game Style catalog has AMERICAN and does NOT contain ALL FIVES");
}

{
  assert.equal(isKnownRulesetId(ALL_FIVES_RULESET_ID), true);
  assert.equal(coerceRulesetId(ALL_FIVES_RULESET_ID), AMERICAN_RULESET_ID);
  assert.equal(normalizeRulesetId(ALL_FIVES_RULESET_ID), AMERICAN_RULESET_ID);
  assert.equal(tryResolveRuleset(ALL_FIVES_RULESET_ID)?.id, AMERICAN_RULESET_ID);
  assert.equal(resolveRuleset(ALL_FIVES_RULESET_ID).id, AMERICAN_RULESET_ID);
  assert.equal(resolveRuleset(ALL_FIVES_RULESET_ID).defaultTargetScore, 200);
  assert.equal(
    resolveRuleset(ALL_FIVES_RULESET_ID).policies.scorePlay,
    resolveRuleset(AMERICAN_RULESET_ID).policies.scorePlay
  );
  section("legacy saved rulesetId allFives safely maps to American");
}

{
  const american = resolveRuleset(AMERICAN_RULESET_ID);
  assert.equal(american.defaultTargetScore, ALL_FIVES_MATCH_TARGET);
  assert.equal(american.defaultTargetScore, AMERICAN_MATCH_TARGET);
  assert.equal(american.defaultTargetScore, 200);
  assert.equal(typeof american.policies.scorePlay, "function");
  assert.equal(american.policies.calculateRoundPoints, calculateAllFivesRoundPoints);
  assert.notEqual(american.policies.calculateRoundPoints, calculateRoundPoints);
  section("American owns All Fives count policies (target 200)");
}

{
  const match = startMatch({
    seed: 42,
    playerIds: ["you", "rival"],
    rulesetId: ALL_FIVES_RULESET_ID,
  });
  assert.equal(match.rulesetId, AMERICAN_RULESET_ID);
  assert.equal(match.targetScore, 200);
  section("startMatch(allFives) stores canonical american + target 200");
}

{
  const byId = indexTiles([
    createTile(0, 1),
    createTile(1, 2),
    createTile(2, 2),
    createTile(3, 4),
  ]);
  let board = createBoard();
  board = placeTile(board, byId["0-1"], END.RIGHT);
  const state = {
    seed: 5,
    byId,
    players: [
      { id: "a", hand: ["1-2"] },
      { id: "b", hand: ["2-2", "3-4"] },
    ],
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 2,
    targetScore: ALL_FIVES_MATCH_TARGET,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const after = playTile(state, "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.points, 10);
  assert.equal(after.scores[0], 10);
  assert.equal(after.rulesetId, ALL_FIVES_RULESET_ID);
  section("engine round-end awards nearest-5 under migrated All Fives state");
}

{
  const live = {
    seed: 1,
    byId: indexTiles([createTile(0, 0)]),
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: [] },
    ],
    reserve: [],
    board: [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [20, 5],
    round: 2,
    targetScore: ALL_FIVES_MATCH_TARGET,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
  };
  const wrapped = {
    version: MATCH_SAVE_VERSION,
    savedAt: Date.now(),
    matchStartedAt: Date.now(),
    difficulty: "normal",
    selectedId: null,
    state: live,
  };
  assert.equal(isValidSavedMatch(wrapped), true);
  const normalized = normalizeSaveRuleset(live);
  assert.equal(normalized.rulesetId, AMERICAN_RULESET_ID);
  assert.equal(normalized.scores[0], 20);
  section("save/resume migrates allFives → american and keeps scores");
}

{
  assert.equal(resolveRuleset(LEGACY_RULESET_ID).defaultTargetScore, 100);
  assert.equal(
    resolveRuleset(LEGACY_RULESET_ID).policies.calculateRoundPoints,
    calculateRoundPoints
  );
  section("Classic ruleset unchanged");
}

console.log("\nAll Fives → American migration tests passed.");
