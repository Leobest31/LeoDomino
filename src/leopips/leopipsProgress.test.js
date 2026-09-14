/**
 * Owner-approved progression unit tests (LVL / XP / Rank / progress bar).
 */
import assert from "node:assert/strict";
import {
  LEOPIPS_LEVEL_FORMULA_FINALIZED,
  LEOPIPS_LEVEL_NOT_FROM_XP,
  PROGRESSION_LEVEL_MAX,
  PROGRESSION_RANK,
  PROGRESSION_XP,
  leoPipsLevelFromBalance,
  leoPipsLevelFromXp,
  leoPipsMayAwardXp,
  leoPipsMayProgressLevel,
  progressionLevelFromQualifyingWins,
  progressionQualifyingWinCredit,
  progressionRankFromLevel,
  progressionWinProgress,
  progressionXpForResult,
} from "./leopipsProgress.js";

assert.equal(LEOPIPS_LEVEL_FORMULA_FINALIZED, true);
assert.equal(LEOPIPS_LEVEL_NOT_FROM_XP, true);
assert.equal(leoPipsLevelFromBalance(9999), null);
assert.equal(leoPipsLevelFromXp(9999), null);

assert.equal(PROGRESSION_XP.PUBLIC_COMPLETED_WIN, 25);
assert.equal(PROGRESSION_XP.PUBLIC_COMPLETED_LOSS, 10);
assert.equal(PROGRESSION_XP.FRIEND_COMPLETED_WIN, 10);
assert.equal(PROGRESSION_XP.FRIEND_COMPLETED_LOSS, 5);

assert.equal(leoPipsMayAwardXp({ finishReason: "completed" }), true);
assert.equal(leoPipsMayAwardXp({ finishReason: "forfeit" }), false);
assert.equal(leoPipsMayAwardXp({ finishReason: "abandon" }), false);
assert.equal(leoPipsMayAwardXp({ finishReason: "abandoned" }), false);
assert.equal(leoPipsMayAwardXp({ finishReason: "timeout" }), false);
assert.equal(leoPipsMayAwardXp({ finishReason: "join_timeout" }), false);
assert.equal(leoPipsMayAwardXp({ finishReason: "aborted" }), false);

assert.equal(leoPipsMayProgressLevel({ finishReason: "completed", matchKind: "public" }), true);
assert.equal(leoPipsMayProgressLevel({ finishReason: "completed", matchKind: "friend" }), false);
assert.equal(leoPipsMayProgressLevel({ finishReason: "forfeit", matchKind: "public" }), false);
assert.equal(leoPipsMayProgressLevel({ finishReason: "timeout", matchKind: "public" }), false);

assert.equal(
  progressionXpForResult({ finishReason: "completed", matchKind: "public", didWin: true }),
  25
);
assert.equal(
  progressionXpForResult({ finishReason: "completed", matchKind: "public", didWin: false }),
  10
);
assert.equal(
  progressionXpForResult({ finishReason: "completed", matchKind: "friend", didWin: true }),
  10
);
assert.equal(
  progressionXpForResult({ finishReason: "completed", matchKind: "friend", didWin: false }),
  5
);
assert.equal(
  progressionXpForResult({ finishReason: "forfeit", matchKind: "public", didWin: true }),
  0
);
assert.equal(
  progressionXpForResult({ finishReason: "timeout", matchKind: "public", didWin: true }),
  0
);
assert.equal(
  progressionXpForResult({ finishReason: "abandon", matchKind: "public", didWin: true }),
  0
);

assert.equal(
  progressionQualifyingWinCredit({
    finishReason: "completed",
    matchKind: "public",
    didWin: true,
  }),
  1
);
assert.equal(
  progressionQualifyingWinCredit({
    finishReason: "completed",
    matchKind: "friend",
    didWin: true,
  }),
  0
);
assert.equal(
  progressionQualifyingWinCredit({
    finishReason: "completed",
    matchKind: "public",
    didWin: false,
  }),
  0
);
assert.equal(
  progressionQualifyingWinCredit({
    finishReason: "forfeit",
    matchKind: "public",
    didWin: true,
  }),
  0
);

const levelCases = [
  [0, 0],
  [9, 0],
  [10, 1],
  [19, 1],
  [20, 2],
  [77, 7],
  [199, 19],
  [200, 20],
  [499, 49],
  [500, 50],
  [999, 99],
  [1000, 100],
  [1001, 100],
  [9999, 100],
];
for (const [wins, level] of levelCases) {
  assert.equal(progressionLevelFromQualifyingWins(wins), level, `wins=${wins}`);
}
assert.equal(PROGRESSION_LEVEL_MAX, 100);

assert.equal(progressionRankFromLevel(0), null);
assert.equal(progressionRankFromLevel(1), PROGRESSION_RANK.BRONZE);
assert.equal(progressionRankFromLevel(19), PROGRESSION_RANK.BRONZE);
assert.equal(progressionRankFromLevel(20), PROGRESSION_RANK.GOLD);
assert.equal(progressionRankFromLevel(49), PROGRESSION_RANK.GOLD);
assert.equal(progressionRankFromLevel(50), PROGRESSION_RANK.DIAMOND);
assert.equal(progressionRankFromLevel(99), PROGRESSION_RANK.DIAMOND);
assert.equal(progressionRankFromLevel(100), PROGRESSION_RANK.DIAMOND);

{
  const p = progressionWinProgress(7);
  assert.equal(p.level, 0);
  assert.equal(p.winsInLevel, 7);
  assert.equal(p.nextLevel, 1);
  assert.equal(p.maxed, false);
}
{
  const p = progressionWinProgress(17);
  assert.equal(p.level, 1);
  assert.equal(p.winsInLevel, 7);
  assert.equal(p.nextLevel, 2);
}
{
  const p = progressionWinProgress(77);
  assert.equal(p.level, 7);
  assert.equal(p.winsInLevel, 7);
  assert.equal(p.nextLevel, 8);
}
{
  const p = progressionWinProgress(199);
  assert.equal(p.level, 19);
  assert.equal(p.winsInLevel, 9);
  assert.equal(p.nextLevel, 20);
  assert.equal(p.rank, PROGRESSION_RANK.BRONZE);
}
{
  const p = progressionWinProgress(200);
  assert.equal(p.level, 20);
  assert.equal(p.winsInLevel, 0);
  assert.equal(p.nextLevel, 21);
  assert.equal(p.rank, PROGRESSION_RANK.GOLD);
}
{
  const p = progressionWinProgress(1000);
  assert.equal(p.level, 100);
  assert.equal(p.maxed, true);
  assert.equal(p.nextLevel, null);
  assert.equal(p.rank, PROGRESSION_RANK.DIAMOND);
}

console.log("  ✓ leopipsProgress owner matrix / LVL / rank / win-progress");
