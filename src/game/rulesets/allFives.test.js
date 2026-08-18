/**
 * All Fives ruleset — Game Style UI, resume, round-end isolation.
 * Run: node src/game/rulesets/allFives.test.js
 */

import assert from "node:assert/strict";
import {
  ALL_FIVES_MATCH_TARGET,
  ALL_FIVES_RULESET_ID,
  AMERICAN_RULESET_ID,
  END,
  LEGACY_RULESET_ID,
  PHASE,
  calculateAllFivesRoundPoints,
  calculateRoundPoints,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
  getGameStyle,
  isGameStyleCompatibleWithPlayerCount,
  isKnownRulesetId,
  listAvailableGameStyles,
  normalizeGameStyleId,
  playTile,
  resolveRuleset,
  rulesetIdForNewMatchPreference,
  startMatch,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset as normalizeSaveRuleset,
} from "../../persistence/matchSave.js";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import {
  gameStyleFlagDataUrl as flagDataUrl,
  gameStyleFlagEmoji as flagEmoji,
} from "../../data/gameStyles.js";

function section(title) {
  console.log(`✓ ${title}`);
}

{
  assert.equal(isKnownRulesetId(ALL_FIVES_RULESET_ID), true);
  const style = getGameStyle("american");
  assert.ok(style);
  assert.equal(style.rulesetId, ALL_FIVES_RULESET_ID);
  assert.equal(style.available, true);
  assert.equal(style.enabled, true);
  assert.equal(style.countryCode, "US");
  assert.equal(style.nameKey, "setup.gameStyle.american");
  assert.equal(style.descriptionKey, "setup.gameStyle.americanDescription");
  assert.equal(gameStyleToRulesetId("american"), ALL_FIVES_RULESET_ID);
  assert.equal(gameStyleForRulesetId(ALL_FIVES_RULESET_ID)?.id, "american");
  assert.equal(normalizeGameStyleId("american"), "american");
  assert.equal(normalizeGameStyleId("allFives"), "american");
  assert.equal(normalizeGameStyleId(ALL_FIVES_RULESET_ID), "american");
  assert.ok(listAvailableGameStyles().some((s) => s.id === "american"));
  assert.equal(
    listAvailableGameStyles().some((s) => s.id === "allFives"),
    false
  );
  assert.equal(getGameStyle("allFives")?.available, false);
  assert.equal(gameStyleToRulesetId("allFives"), null);
  assert.equal(flagEmoji(style), "🇺🇸");
  assert.ok(flagDataUrl(style).startsWith("data:image/svg+xml"));
  assert.equal(isGameStyleCompatibleWithPlayerCount("american", 2), true);
  assert.equal(isGameStyleCompatibleWithPlayerCount("american", 3), true);
  assert.equal(isGameStyleCompatibleWithPlayerCount("american", 4), true);
  section("Game Style UI maps American → internal ruleset allFives");
}

{
  const ruleset = resolveRuleset(ALL_FIVES_RULESET_ID);
  assert.equal(ruleset.defaultTargetScore, ALL_FIVES_MATCH_TARGET);
  assert.equal(ruleset.defaultTargetScore, 200);
  assert.equal(typeof ruleset.policies.scorePlay, "function");
  assert.equal(ruleset.policies.calculateRoundPoints, calculateAllFivesRoundPoints);
  assert.notEqual(ruleset.policies.calculateRoundPoints, calculateRoundPoints);
  section("allFives ruleset: target 200 + isolated round-end policy");
}

{
  const match = startMatch({
    seed: 42,
    playerIds: ["you", "rival"],
    rulesetId: ALL_FIVES_RULESET_ID,
  });
  assert.equal(match.rulesetId, ALL_FIVES_RULESET_ID);
  assert.equal(match.targetScore, 200);
  section("startMatch stores allFives rulesetId and target 200");
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
  // Opponent holds 2-2 (4) + 3-4 (7) = 11 → All Fives awards 10, Classic 11.
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
  const classicPts = calculateRoundPoints({
    winnerIndex: 0,
    players: state.players,
    byId,
  });
  assert.equal(classicPts, 11);
  const after = playTile(state, "1-2", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.points, 10);
  assert.equal(after.scores[0], 10);
  section("engine round-end awards nearest-5 (not Classic 11)");
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
  assert.equal(normalized.rulesetId, ALL_FIVES_RULESET_ID);
  assert.equal(normalized.scores[0], 20);
  section("save/resume preserves allFives rulesetId and scores");
}

{
  assert.equal(rulesetIdForNewMatchPreference("american"), ALL_FIVES_RULESET_ID);
  assert.equal(rulesetIdForNewMatchPreference(ALL_FIVES_RULESET_ID), ALL_FIVES_RULESET_ID);
  const fromUi = startMatch({
    seed: 3,
    playerIds: ["you", "rival"],
    rulesetId: gameStyleToRulesetId("american"),
  });
  assert.equal(fromUi.rulesetId, ALL_FIVES_RULESET_ID);
  assert.equal(fromUi.targetScore, 200);
  assert.equal(typeof resolveRuleset(fromUi.rulesetId).policies.scorePlay, "function");
  section("tapping American starts the allFives engine");
}

{
  // Sibling styles unchanged.
  assert.equal(resolveRuleset(AMERICAN_RULESET_ID).defaultTargetScore, 100);
  assert.equal(resolveRuleset(LEGACY_RULESET_ID).defaultTargetScore, 100);
  assert.equal(
    resolveRuleset(AMERICAN_RULESET_ID).policies.calculateRoundPoints,
    calculateRoundPoints
  );
  section("Classic / American round-end unchanged");
}

console.log("\nAll Fives ruleset tests passed.");
