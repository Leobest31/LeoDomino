/**
 * All Fives round-end visual counting — remaining hands, HUD lag, once-only.
 * Run: node src/game/rules/allFivesRoundSummary.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  calculateAllFivesRoundPoints,
  explainAllFivesRoundEnd,
} from "./allFivesScoring.js";
import {
  ROUND_SUMMARY_HOLD_MS,
  ROUND_SUMMARY_TILE_MS,
  flattenRoundSummaryTiles,
  hudScoresDuringRoundSummary,
  roundSummaryView,
  usesAllFivesRoundSummary,
} from "./allFivesRoundSummary.js";
import { playTile, startNextRound, advanceAfterRoundSummary, getAvailableActions } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import { MOTION } from "../../utils/motion.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function tiles(...pairs) {
  return indexTiles(pairs.map(([a, b]) => createTile(a, b)));
}

function playingState({ players, byId, board = createBoard(), scores = null }) {
  return {
    seed: 9,
    byId,
    players,
    reserve: [],
    board,
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: scores ?? players.map(() => 0),
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
}

assert.equal(ROUND_SUMMARY_TILE_MS, 750);
assert.equal(ROUND_SUMMARY_HOLD_MS, 2000);
assert.equal(MOTION.roundSummaryTileMs, ROUND_SUMMARY_TILE_MS);
assert.equal(MOTION.roundSummaryHoldMs, ROUND_SUMMARY_HOLD_MS);
section("counting pace 750ms/tile; final hold 2000ms");

{
  const byId = tiles([6, 4], [3, 2], [1, 1], [0, 1]);
  const players = [
    { id: "you", hand: ["0-1"] },
    { id: "rival", hand: ["4-6", "2-3", "1-1"] },
  ];
  const explained = explainAllFivesRoundEnd({ winnerIndex: 0, players, byId });
  assert.deepEqual(
    explained.hands.map((h) => h.playerIndex),
    [1]
  );
  assert.deepEqual(
    explained.hands[0].tiles.map((t) => t.id),
    ["4-6", "2-3", "1-1"]
  );
  assert.equal(explained.rawTotal, 17);
  assert.equal(explained.awarded, 15);
  assert.equal(
    calculateAllFivesRoundPoints({ winnerIndex: 0, players, byId }),
    explained.awarded
  );
  const sequence = flattenRoundSummaryTiles(explained);
  assert.equal(sequence.length, 3);
  const first = roundSummaryView(explained, 0);
  assert.equal(first.stage, "counting");
  assert.equal(first.activeTileId, "4-6");
  assert.equal(first.rawVisible, 10);
  assert.equal(first.showAward, false);
  assert.equal(first.hudLag, true);
  const second = roundSummaryView(explained, ROUND_SUMMARY_TILE_MS);
  assert.equal(second.activeTileId, "2-3");
  assert.equal(second.rawVisible, 15);
  const third = roundSummaryView(explained, ROUND_SUMMARY_TILE_MS * 2);
  assert.equal(third.activeTileId, "1-1");
  assert.equal(third.rawVisible, 17);
  const hold = roundSummaryView(explained, ROUND_SUMMARY_TILE_MS * 3);
  assert.equal(hold.stage, "final");
  assert.equal(hold.rawVisible, 17);
  assert.equal(hold.awarded, 15);
  assert.equal(hold.showAward, true);
  assert.equal(hold.hudLag, true);
  const stillHold = roundSummaryView(
    explained,
    ROUND_SUMMARY_TILE_MS * 3 + ROUND_SUMMARY_HOLD_MS - 1
  );
  assert.equal(stillHold.stage, "final");
  assert.equal(stillHold.hudLag, true);
  const done = roundSummaryView(
    explained,
    ROUND_SUMMARY_TILE_MS * 3 + ROUND_SUMMARY_HOLD_MS
  );
  assert.equal(done.done, true);
  assert.equal(done.hudLag, false);
  section("real remaining tiles counted once; raw 17 then ROUND POINTS +15");
}

{
  const scores = [85, 40];
  const during = hudScoresDuringRoundSummary({
    scores,
    winnerIndex: 0,
    points: 15,
    hudLag: true,
  });
  assert.deepEqual(during, [70, 40]);
  const after = hudScoresDuringRoundSummary({
    scores,
    winnerIndex: 0,
    points: 15,
    hudLag: false,
  });
  assert.deepEqual(after, [85, 40]);
  section("HUD stays at 70 during summary; becomes 85 afterward");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4]);
  const beforeScores = [70, 10];
  const state = playingState({
    byId,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["2-2", "3-4"] },
    ],
    scores: beforeScores.slice(),
  });
  const after = playTile(state, "0-1", END.RIGHT);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.summary, true);
  assert.equal(after.roundResult.rawPips, 11);
  assert.equal(after.roundResult.points, 10);
  assert.equal(after.scores[0], 80);
  assert.equal(after.matchWinner, null);
  const ids = after.roundResult.hands.flatMap((h) => h.tiles.map((t) => t.id));
  assert.deepEqual(ids, ["2-2", "3-4"]);
  assert.ok(!ids.includes("0-1"), "winner tile is not counted");
  const lagged = hudScoresDuringRoundSummary({
    scores: after.scores,
    winnerIndex: after.roundResult.winnerIndex,
    points: after.roundResult.points,
    hudLag: true,
  });
  assert.deepEqual(lagged, beforeScores);
  assert.equal(usesAllFivesRoundSummary(after), true);
  section("engine stores remaining hands once; scores applied once");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4], [5, 6], [0, 2]);
  const state = playingState({
    byId,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["2-2", "3-4"] },
      { id: "c", hand: ["5-6"] },
    ],
    scores: [0, 0, 0],
  });
  const after = playTile(state, "0-1", END.RIGHT);
  assert.deepEqual(
    after.roundResult.hands.map((h) => h.playerIndex),
    [1, 2]
  );
  assert.equal(after.roundResult.rawPips, 11 + 11);
  assert.equal(after.roundResult.points, 20);
  const four = playingState({
    byId,
    players: [
      { id: "a", hand: ["0-1"] },
      { id: "b", hand: ["2-2", "3-4"] },
      { id: "c", hand: ["5-6"] },
      { id: "d", hand: ["0-2"] },
    ],
    scores: [0, 0, 0, 0],
  });
  const after4 = playTile(four, "0-1", END.RIGHT);
  assert.deepEqual(
    after4.roundResult.hands.map((h) => h.playerIndex),
    [1, 2, 3]
  );
  assert.ok(!after4.roundResult.hands.some((h) => h.playerIndex === 0));
  section("3P/4P count every losing hand once, never the winner");
}

{
  const byId = tiles([5, 5], [0, 1]);
  const state = playingState({
    byId,
    players: [
      { id: "a", hand: ["5-5"] },
      { id: "b", hand: ["0-1"] },
    ],
    scores: [190, 0],
  });
  const after = playTile(state, "5-5");
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.scores[0], 200);
  assert.equal(after.matchWinner, null);
  assert.equal(after.roundResult.pendingMatchWinner, 0);
  const committed = advanceAfterRoundSummary(after);
  assert.equal(committed.phase, PHASE.MATCH_OVER);
  assert.equal(committed.matchWinner, 0);
  assert.equal(committed.scores[0], 200);
  const twice = advanceAfterRoundSummary(committed);
  assert.equal(twice.phase, PHASE.MATCH_OVER);
  assert.equal(twice.scores[0], 200);
  section("match-win round waits for summary; advance is idempotent");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4]);
  const after = playTile(
    playingState({
      byId,
      players: [
        { id: "a", hand: ["0-1"] },
        { id: "b", hand: ["2-2", "3-4"] },
      ],
    }),
    "0-1",
    END.RIGHT
  );
  const resumed = structuredClone(after);
  assert.equal(resumed.scores[0], after.scores[0]);
  const next = startNextRound(resumed);
  assert.equal(next.phase, PHASE.PLAYING);
  assert.equal(next.scores[0], after.scores[0]);
  section("save/resume cannot double-apply the round award");
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const finishSrc = readFileSync(join(here, "drawDominoes.js"), "utf8");
  assert.match(finishSrc, /explainRoundEnd && winnerIndex != null/);
  assert.match(finishSrc, /if \(explanation\) \{\s*points = Number\(explanation\.awarded\)/s);
  assert.equal(
    (finishSrc.match(/policies\.calculateRoundPoints/g) || []).length > 0,
    true
  );
  section("authoritative round-end function is used once (not live scoring)");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4]);
  const state = playingState({
    byId,
    players: [
      { id: "human", hand: ["2-2", "3-4"] },
      { id: "ai", hand: ["0-1"] },
    ],
    scores: [40, 55],
  });
  const after = playTile({ ...state, currentPlayer: 1 }, "0-1", END.RIGHT);
  assert.equal(after.roundResult.winnerIndex, 1);
  assert.deepEqual(
    after.roundResult.hands.map((h) => h.playerIndex),
    [0]
  );
  assert.deepEqual(
    after.roundResult.hands[0].tiles.map((t) => t.id),
    ["2-2", "3-4"]
  );
  assert.equal(after.roundResult.rawPips, 11);
  assert.equal(after.roundResult.points, 10);
  assert.equal(after.scores[1], 65);
  const lagged = hudScoresDuringRoundSummary({
    scores: after.scores,
    winnerIndex: 1,
    points: 10,
    hudLag: true,
  });
  assert.deepEqual(lagged, [40, 55]);
  section("AI round winner counts the human remaining hand once");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4]);
  const after = playTile(
    playingState({
      byId,
      players: [
        { id: "a", hand: ["0-1"] },
        { id: "b", hand: ["2-2", "3-4"] },
      ],
    }),
    "0-1",
    END.RIGHT
  );
  const actions = getAvailableActions(after);
  assert.equal(actions.canPlay, false);
  assert.equal(actions.canDraw, false);
  assert.equal(actions.canPass, false);
  assert.deepEqual(actions.legalMoves, []);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.throws(() => playTile(after, "2-2", END.RIGHT));
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../pages/GamePage.jsx"),
    "utf8"
  );
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../pages/GamePage.css"),
    "utf8"
  );
  const table = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../components/GameTable.jsx"),
    "utf8"
  );
  const overlay = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../components/RoundHandSummary.jsx"),
    "utf8"
  );
  assert.match(page, /game-page--round-summary/);
  assert.match(page, /summaryDoneRef/);
  assert.match(page, /setMotionLock\(true\)/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(table, /RoundHandSummary/);
  assert.match(table, /tiles=\{tiles\}/);
  assert.match(overlay, /summary-\$\{tile\.id\}/);
  assert.match(overlay, /round-summary__slot--active/);
  section("no interaction during summary; overlay is not board topology");
}

{
  const byId = tiles([0, 1], [2, 2], [3, 4]);
  const after = playTile(
    playingState({
      byId,
      players: [
        { id: "a", hand: ["0-1"] },
        { id: "b", hand: ["2-2", "3-4"] },
      ],
      scores: [70, 10],
    }),
    "0-1",
    END.RIGHT
  );
  const clone = structuredClone(after);
  const once = advanceAfterRoundSummary(clone);
  const twice = advanceAfterRoundSummary(once);
  const again = advanceAfterRoundSummary(structuredClone(after));
  assert.equal(once.scores[0], after.scores[0]);
  assert.equal(twice.scores[0], after.scores[0]);
  assert.equal(again.scores[0], after.scores[0]);
  assert.equal(once.phase, PHASE.PLAYING);
  assert.equal(twice.phase, PHASE.PLAYING);
  section("rerender / timer / resume cannot double-apply the round award");
}

console.log("\nAll Fives round-summary tests passed.");
