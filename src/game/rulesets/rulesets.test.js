/**
 * Ruleset registry + Classic/legacy wiring verification.
 * Run: node src/game/rulesets/rulesets.test.js
 */

import assert from "node:assert/strict";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_RULESET_ID,
  DEFAULT_GAME_STYLE_ID,
  GAME_STYLES,
  HAND_SIZE,
  LEGACY_RULESET_ID,
  PHASE,
  applyAiTurn,
  chooseAiAction,
  coerceRulesetId,
  createMatch,
  gameStyleForRulesetId,
  gameStyleToRulesetId,
  getAvailableActions,
  getGameStyle,
  isKnownRulesetId,
  listAvailableGameStyles,
  normalizeGameStyleId,
  normalizeRulesetId,
  playTile,
  resolveHandSize,
  resolveRuleset,
  startMatch,
  startNextRound,
  tryResolveRuleset,
} from "../index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
  normalizeStateRuleset,
} from "../../persistence/matchSave.js";
import {
  gameStyleFlagDataUrl,
  gameStyleFlagEmoji,
} from "../../data/gameStyles.js";

function section(title) {
  console.log(`✓ ${title}`);
}

// --- Registry resolution ---
{
  assert.equal(DEFAULT_RULESET_ID, "legacy");
  assert.equal(LEGACY_RULESET_ID, "legacy");
  const legacy = resolveRuleset("legacy");
  assert.equal(legacy.id, "legacy");
  assert.equal(legacy.handSize, HAND_SIZE);
  assert.equal(legacy.defaultTargetScore, 100);
  assert.equal(legacy.deckType, "double-six");
  assert.equal(legacy.drawPolicy, "drawUntilPlayable");
  assert.equal(legacy.passPolicy, "passWhenReserveEmpty");
  assert.equal(legacy.boardModel, "linearTwoEnds");
  assert.equal(legacy.partnerships, null);
  assert.equal(resolveHandSize(legacy, 4), 7);
  assert.equal(resolveRuleset(null).id, "legacy");
  assert.equal(resolveRuleset(undefined).id, "legacy");
  assert.equal(normalizeRulesetId(null), "legacy");
  assert.equal(normalizeRulesetId(""), "legacy");
  assert.equal(isKnownRulesetId("legacy"), true);
  assert.equal(isKnownRulesetId("haitian"), true);
  assert.equal(isKnownRulesetId("american"), true);
  assert.equal(isKnownRulesetId("dominican"), true);
  assert.equal(isKnownRulesetId("puertorican"), true);
  assert.equal(tryResolveRuleset("nope"), null);
  assert.equal(tryResolveRuleset("haitian")?.id, "haitian");
  assert.equal(tryResolveRuleset("american")?.id, "american");
  assert.equal(tryResolveRuleset("dominican")?.id, "dominican");
  assert.equal(tryResolveRuleset("puertorican")?.id, "puertorican");
  assert.equal(coerceRulesetId(undefined), "legacy");
  assert.equal(coerceRulesetId("legacy"), "legacy");
  assert.equal(coerceRulesetId("haitian"), "haitian");
  assert.equal(coerceRulesetId("american"), "american");
  assert.equal(coerceRulesetId("dominican"), "dominican");
  assert.equal(coerceRulesetId("puertorican"), "puertorican");
  assert.throws(() => normalizeRulesetId("unknown-style"), /Unknown ruleset/);
  assert.throws(() => resolveRuleset("unknown-style"), /Unknown ruleset/);
  section("legacy registry resolution + unknown fails safely");
}

// --- Classic UI metadata maps to legacy ---
{
  assert.equal(DEFAULT_GAME_STYLE_ID, "classic");
  const classic = getGameStyle("classic");
  assert.ok(classic);
  assert.equal(classic.rulesetId, "legacy");
  assert.equal(classic.available, true);
  assert.equal(classic.enabled, true);
  assert.equal(classic.countryCode, null);
  assert.equal(classic.nameKey, "setup.gameStyle.classic");
  assert.equal(classic.descriptionKey, "setup.gameStyle.classicDescription");
  assert.equal(gameStyleToRulesetId("classic"), "legacy");
  assert.equal(gameStyleForRulesetId("legacy")?.id, "classic");
  assert.equal(normalizeGameStyleId("legacy"), "classic");
  assert.equal(normalizeGameStyleId("classic"), "classic");
  const available = listAvailableGameStyles();
  assert.equal(available.length, 5);
  assert.equal(available[0].id, "classic");
  assert.equal(available[1].id, "haitian");
  assert.equal(available[2].id, "american");
  assert.equal(available[3].id, "dominican");
  assert.equal(available[4].id, "puertorican");
  assert.equal(available[1].countryCode, "HT");
  assert.equal(available[1].enabled, true);
  assert.equal(available[2].countryCode, "US");
  assert.equal(available[2].enabled, true);
  assert.equal(available[3].countryCode, "DO");
  assert.equal(available[3].enabled, true);
  assert.equal(available[4].countryCode, "PR");
  assert.equal(available[4].enabled, true);
  assert.ok(
    gameStyleFlagDataUrl(available[1]).startsWith("data:image/svg+xml"),
    "Haitian style exposes SVG flag data URL (not letter fallback)"
  );
  assert.equal(gameStyleFlagEmoji(available[1]), "🇭🇹");
  assert.ok(
    gameStyleFlagDataUrl(available[2]).startsWith("data:image/svg+xml"),
    "American style exposes SVG flag data URL"
  );
  assert.equal(gameStyleFlagEmoji(available[2]), "🇺🇸");
  assert.ok(
    gameStyleFlagDataUrl(available[3]).startsWith("data:image/svg+xml"),
    "Dominican style exposes SVG flag data URL"
  );
  assert.equal(gameStyleFlagEmoji(available[3]), "🇩🇴");
  assert.ok(
    gameStyleFlagDataUrl(available[4]).startsWith("data:image/svg+xml"),
    "Puerto Rican style exposes SVG flag data URL"
  );
  assert.equal(gameStyleFlagEmoji(available[4]), "🇵🇷");
  assert.equal(gameStyleToRulesetId("haitian"), "haitian");
  assert.equal(gameStyleForRulesetId("haitian")?.id, "haitian");
  assert.equal(normalizeGameStyleId("haitian"), "haitian");
  assert.equal(gameStyleToRulesetId("american"), "american");
  assert.equal(gameStyleForRulesetId("american")?.id, "american");
  assert.equal(normalizeGameStyleId("american"), "american");
  assert.equal(gameStyleToRulesetId("dominican"), "dominican");
  assert.equal(gameStyleForRulesetId("dominican")?.id, "dominican");
  assert.equal(normalizeGameStyleId("dominican"), "dominican");
  assert.equal(gameStyleToRulesetId("puertorican"), "puertorican");
  assert.equal(gameStyleForRulesetId("puertorican")?.id, "puertorican");
  assert.equal(normalizeGameStyleId("puertorican"), "puertorican");
  assert.ok(GAME_STYLES.some((s) => s.id === "american"));
  assert.ok(GAME_STYLES.some((s) => s.id === "dominican"));
  assert.ok(GAME_STYLES.some((s) => s.id === "puertorican"));
  section("Classic UI metadata maps to legacy; regional styles selectable");
}

// --- createMatch / startMatch stores rulesetId ---
{
  const match = createMatch({ seed: 11, rulesetId: "legacy" });
  assert.equal(match.rulesetId, "legacy");

  const state = startMatch({ seed: 12, playerIds: ["you", "rival"] });
  assert.equal(state.rulesetId, "legacy");
  assert.equal(state.targetScore, 100);
  assert.equal(state.players[0].hand.length, 7);
  assert.equal(state.players[1].hand.length, 7);

  const explicit = startMatch({
    seed: 13,
    playerIds: ["a", "b"],
    rulesetId: "legacy",
    targetScore: 100,
  });
  assert.equal(explicit.rulesetId, "legacy");

  assert.throws(
    () => startMatch({ seed: 1, rulesetId: "not-a-real-ruleset" }),
    /Unknown ruleset/
  );
  section("createMatch/startMatch stores rulesetId");
}

// --- Legacy deal / opening / draw / pass / scoring unchanged ---
{
  const state = startMatch({ seed: 42, playerIds: ["you", "rival"] });
  assert.equal(state.rulesetId, "legacy");
  assert.ok(state.mustPlayTileId);
  assert.ok(state.players[state.currentPlayer].hand.includes(state.mustPlayTileId));

  const actions = getAvailableActions(state);
  assert.equal(actions.canPlay, true);
  assert.equal(actions.canDraw, false);
  assert.equal(actions.canPass, false);

  const next = playTile(state, state.mustPlayTileId);
  assert.equal(next.mustPlayTileId, null);
  assert.equal(next.rulesetId, "legacy");
  assert.notEqual(next.currentPlayer, state.currentPlayer);
  assert.equal(next.targetScore, 100);

  // Round 2 free open preserves ruleset + deal size.
  let round = startMatch({ seed: 55, playerIds: ["a", "b"], targetScore: 500 });
  round = playTile(round, round.mustPlayTileId);
  const fakeOver = {
    ...round,
    phase: PHASE.ROUND_OVER,
    roundResult: { reason: "domino", winnerIndex: 0, points: 10 },
    scores: [10, 0],
  };
  const nextRound = startNextRound(fakeOver, { seed: 99 });
  assert.equal(nextRound.rulesetId, "legacy");
  assert.equal(nextRound.round, round.round + 1);
  assert.equal(nextRound.mustPlayTileId, null);
  assert.equal(nextRound.players[0].hand.length, 7);
  assert.equal(nextRound.players[1].hand.length, 7);
  section("legacy deal 7, target 100, opening/next-round unchanged");
}

// --- AI works under legacy ---
{
  let state = startMatch({ seed: 123, playerIds: ["a", "b"] });
  const action = chooseAiAction(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.ok(action);
  assert.ok(["play", "draw", "pass"].includes(action.type));
  const after = applyAiTurn(state, {
    difficulty: DEFAULT_DIFFICULTY,
    aiIndex: state.currentPlayer,
  });
  assert.equal(after.rulesetId, "legacy");
  assert.notEqual(after, state);
  section("AI works under legacy");
}

// --- Save / resume migration (pure normalize/validate; no DOM storage) ---
{
  const state = startMatch({ seed: 4242, playerIds: ["you", "rival"] });
  assert.equal(state.rulesetId, "legacy");
  assert.equal(isValidSavedMatch({ version: MATCH_SAVE_VERSION, state }), true);
  assert.equal(normalizeStateRuleset(state).rulesetId, "legacy");

  // Old save without rulesetId → legacy
  const { rulesetId: _drop, ...without } = state;
  assert.equal(without.rulesetId, undefined);
  const normalized = normalizeStateRuleset(without);
  assert.equal(normalized.rulesetId, "legacy");
  assert.equal(isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: without }), true);

  // Resume preserves an explicit rulesetId (never silently rewritten to another style).
  const stamped = { ...state, rulesetId: "legacy" };
  const preserved = normalizeStateRuleset(stamped);
  assert.equal(preserved.rulesetId, "legacy");
  assert.equal(isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: stamped }), true);

  // Haitian save is preserved (never normalized to legacy).
  const haitianState = startMatch({
    seed: 77,
    playerIds: ["you", "rival"],
    rulesetId: "haitian",
  });
  assert.equal(normalizeStateRuleset(haitianState).rulesetId, "haitian");
  assert.equal(
    isValidSavedMatch({ version: MATCH_SAVE_VERSION, state: haitianState }),
    true
  );

  // Unknown ruleset id fails safely
  assert.equal(
    isValidSavedMatch({
      version: MATCH_SAVE_VERSION,
      state: { ...state, rulesetId: "made-up-country" },
    }),
    false
  );
  assert.equal(normalizeStateRuleset({ ...state, rulesetId: "made-up-country" }), null);
  section("save/resume rulesetId migration + unknown rejection");
}

console.log("\nRuleset tests passed.");
