import assert from "node:assert/strict";
import { DIFFICULTY } from "./difficulties.js";
import {
  SETUP_DIFFICULTY_ORDER,
  setupDifficultyLabelKey,
  toSetupDifficulty,
} from "./setupDifficulties.js";

assert.deepEqual(
  [...SETUP_DIFFICULTY_ORDER],
  [DIFFICULTY.EASY, DIFFICULTY.HARD, DIFFICULTY.EXPERT]
);

assert.equal(toSetupDifficulty("beginner"), DIFFICULTY.EASY);
assert.equal(toSetupDifficulty("easy"), DIFFICULTY.EASY);
assert.equal(toSetupDifficulty("medium"), DIFFICULTY.HARD);
assert.equal(toSetupDifficulty("hard"), DIFFICULTY.HARD);
assert.equal(toSetupDifficulty("expert"), DIFFICULTY.EXPERT);
// Unknown / missing → DEFAULT_DIFFICULTY (medium) → Hard chip
assert.equal(toSetupDifficulty("unknown"), DIFFICULTY.HARD);
assert.equal(toSetupDifficulty(undefined), DIFFICULTY.HARD);

assert.equal(setupDifficultyLabelKey(DIFFICULTY.EASY), "ai.difficulty.easy");
assert.equal(setupDifficultyLabelKey(DIFFICULTY.HARD), "ai.difficulty.hard");
assert.equal(setupDifficultyLabelKey(DIFFICULTY.EXPERT), "setup.difficultyAdvanced");

console.log("setupDifficulties OK");
