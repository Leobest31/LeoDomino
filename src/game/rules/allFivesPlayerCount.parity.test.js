/**
 * American / All Fives rule parity across 2P, 3P, and 4P.
 * Run: node src/game/rules/allFivesPlayerCount.parity.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createTile, indexTiles } from "../tiles.js";
import { createBoard, placeTile } from "../board.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  ALL_FIVES_MATCH_TARGET,
  explainAllFivesRoundEnd,
  explainAllFivesScore,
  scoreAllFivesPlay,
} from "./allFivesScoring.js";
import {
  PLAY_SCORE_HOLD_MS,
  shouldShowPlayScorePopup,
  usesAllFivesSpinner,
} from "./allFivesSpinner.js";
import { playTile, startMatch } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import { resolveRuleset } from "../rulesets/index.js";
import {
  LEO_MAIN_STRAIGHT,
  LEO_ARM_STRAIGHT,
  FIRST_FOLD_LEFT,
  FIRST_FOLD_RIGHT,
  FIRST_FOLD_TOP,
  FIRST_FOLD_BOTTOM,
} from "../../board/layoutEngine.js";

function section(title) {
  console.log(`✓ ${title}`);
}

const COUNTS = [2, 3, 4];

function extraPlayers(count, from = 2) {
  const extra = [];
  for (let i = from; i < count; i += 1) {
    extra.push({ id: `p${i}`, hand: [] });
  }
  return extra;
}

function liveState(board, extras = {}) {
  const byId = extras.byId;
  return (playerCount) => {
    const p0 = extras.hand0 ?? [];
    const p1 = extras.hand1 ?? [];
    const players = [
      { id: "a", hand: p0.slice() },
      { id: "b", hand: p1.slice() },
      ...extraPlayers(playerCount),
    ];
    return {
      seed: 3,
      byId,
      players,
      reserve: [],
      board,
      spinnerId: extras.spinnerId ?? null,
      spinnerNorth: extras.spinnerNorth ?? [],
      spinnerSouth: extras.spinnerSouth ?? [],
      phase: PHASE.PLAYING,
      currentPlayer: 0,
      scores: players.map(() => extras.score0 ?? 0),
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
  };
}

function sameAward(makeState, tileId, end) {
  const awards = COUNTS.map((n) => {
    const after = playTile(makeState(n), tileId, end);
    return {
      n,
      awarded: after.lastPlayPoints,
      scores0: after.scores[0],
      spinnerId: after.spinnerId ?? null,
    };
  });
  for (let i = 1; i < awards.length; i += 1) {
    assert.equal(awards[i].awarded, awards[0].awarded, `${awards[i].n}P award`);
    assert.equal(awards[i].scores0, awards[0].scores0, `${awards[i].n}P score`);
    assert.equal(awards[i].spinnerId, awards[0].spinnerId, `${awards[i].n}P spinner`);
  }
  return awards[0];
}

{
  const ruleset = resolveRuleset(ALL_FIVES_RULESET_ID);
  assert.deepEqual(ruleset.supportedPlayerCounts, [2, 3, 4]);
  assert.equal(ruleset.defaultTargetScore, 200);
  assert.equal(ruleset.roundSummary, true);
  for (const n of COUNTS) {
    const match = startMatch({
      seed: 11,
      playerCount: n,
      playerIds: Array.from({ length: n }, (_, i) => `p${i}`),
      rulesetId: ALL_FIVES_RULESET_ID,
    });
    assert.equal(match.players.length, n);
    assert.equal(match.targetScore, 200);
    assert.equal(match.rulesetId, ALL_FIVES_RULESET_ID);
  }
  section("I. one allFives ruleset; target 200 for 2P/3P/4P");
}

{
  const byId = indexTiles([createTile(5, 5)]);
  const make = liveState(createBoard(), { byId, hand0: ["5-5"] });
  const result = sameAward(make, "5-5");
  assert.equal(result.awarded, 10);
  section("A. 5-5 opener +10 for 2P/3P/4P");
}

{
  const byId = indexTiles([createTile(2, 3)]);
  const make = liveState(createBoard(), { byId, hand0: ["2-3"] });
  const result = sameAward(make, "2-3");
  assert.equal(result.awarded, 5);
  section("B. 3-2 opener exact 5 → live +5 for 2P/3P/4P");
}

{
  const byId = indexTiles([createTile(6, 6), createTile(3, 6)]);
  let board = createBoard();
  board = placeTile(board, byId["6-6"], END.RIGHT);
  const make = liveState(board, {
    byId,
    hand0: ["3-6"],
    spinnerId: "6-6",
  });
  const result = sameAward(make, "3-6", END.RIGHT);
  assert.equal(result.awarded, 15);
  section("C. 6-6 + 6-3 one MAIN side → +15 for 2P/3P/4P");
}

{
  const byId = indexTiles([
    createTile(6, 6),
    createTile(3, 6),
    createTile(4, 6),
  ]);
  let board = createBoard();
  board = placeTile(board, byId["6-6"], END.RIGHT);
  board = placeTile(board, byId["3-6"], END.LEFT);
  const make = liveState(board, {
    byId,
    hand0: ["4-6"],
    spinnerId: "6-6",
  });
  const reports = COUNTS.map((n) => {
    const after = playTile(make(n), "4-6", END.RIGHT);
    return explainAllFivesScore(after);
  });
  for (let i = 1; i < reports.length; i += 1) {
    assert.equal(reports[i].awarded, reports[0].awarded);
    assert.equal(reports[i].exactTotal, reports[0].exactTotal);
  }
  const spinnerTerm = reports[0].terminals.find((t) => t.sourceTileId === "6-6");
  if (spinnerTerm) {
    assert.equal(spinnerTerm.contribution, 0);
  }
  section("D. both MAIN sides occupied → spinner contribution 0 for 2P/3P/4P");
}

{
  const byId = indexTiles([createTile(4, 4)]);
  const make = liveState(createBoard(), { byId, hand0: ["4-4"] });
  const result = sameAward(make, "4-4");
  assert.equal(result.awarded, 0);
  const reports = COUNTS.map((n) => explainAllFivesScore(playTile(make(n), "4-4")));
  for (const report of reports) {
    const dbl = report.terminals.find((t) => t.sourceTileId === "4-4");
    assert.equal(dbl.contribution, 8);
  }

  const asTerminal = explainAllFivesScore({
    board: [
      { id: "3-3", left: 3, right: 3 },
      { id: "3-4", left: 3, right: 4 },
      { id: "4-4", left: 4, right: 4 },
    ],
    spinnerId: "3-3",
  });
  assert.equal(
    asTerminal.terminals.find((t) => t.sourceTileId === "4-4")?.contribution,
    8
  );
  const extended = explainAllFivesScore({
    board: [
      { id: "3-3", left: 3, right: 3 },
      { id: "3-4", left: 3, right: 4 },
      { id: "4-4", left: 4, right: 4 },
      { id: "2-4", left: 4, right: 2 },
    ],
    spinnerId: "3-3",
  });
  assert.equal(
    extended.terminals.some((t) => t.sourceTileId === "4-4"),
    false
  );
  assert.equal(
    extended.terminals.find((t) => t.sourceTileId === "2-4")?.contribution,
    2
  );
  for (const n of COUNTS) {
    assert.equal(usesAllFivesSpinner({ rulesetId: ALL_FIVES_RULESET_ID, players: Array(n) }), true);
    assert.equal(
      explainAllFivesScore({
        board: [
          { id: "3-3", left: 3, right: 3 },
          { id: "3-4", left: 3, right: 4 },
          { id: "4-4", left: 4, right: 4 },
          { id: "2-4", left: 4, right: 2 },
        ],
        spinnerId: "3-3",
      }).exactTotal,
      extended.exactTotal
    );
  }
  section("E. terminal double 4-4 contributes 8 until extended");
}

{
  assert.equal(scoreAllFivesPlay({ board: [{ id: "x", left: 2, right: 3 }] }), 5);
  const byId = indexTiles([createTile(0, 5)]);
  const make = liveState(createBoard(), { byId, hand0: ["0-5"] });
  const result = sameAward(make, "0-5");
  assert.equal(result.awarded, 5);
  section("F. live exact 5 → +5 for 2P/3P/4P");
}

{
  const byId10 = indexTiles([createTile(5, 5)]);
  const make10 = liveState(createBoard(), { byId: byId10, hand0: ["5-5"] });
  assert.equal(sameAward(make10, "5-5").awarded, 10);

  const byId15 = indexTiles([createTile(6, 6), createTile(3, 6)]);
  let board15 = createBoard();
  board15 = placeTile(board15, byId15["6-6"], END.RIGHT);
  const make15 = liveState(board15, {
    byId: byId15,
    hand0: ["3-6"],
    spinnerId: "6-6",
  });
  assert.equal(sameAward(make15, "3-6", END.RIGHT).awarded, 15);

  let board20 = createBoard();
  board20 = placeTile(board20, createTile(5, 5), END.RIGHT);
  board20 = placeTile(board20, createTile(4, 5), END.RIGHT);
  const report20 = explainAllFivesScore({
    board: board20,
    isOpening: false,
    spinnerId: "5-5",
    spinnerNorth: [{ id: "5-6", left: 5, right: 6 }],
  });
  assert.equal(report20.exactTotal, 20);
  assert.equal(report20.awarded, 20);
  for (const n of COUNTS) {
    assert.equal(usesAllFivesSpinner({ rulesetId: ALL_FIVES_RULESET_ID, players: Array(n) }), true);
    assert.equal(explainAllFivesScore({
      board: board20,
      isOpening: false,
      spinnerId: "5-5",
      spinnerNorth: [{ id: "5-6", left: 5, right: 6 }],
    }).awarded, 20);
  }
  section("G. live 10 / 15 / 20 exact awards match across 2P/3P/4P");
}

{
  assert.equal(PLAY_SCORE_HOLD_MS, 2000);
  assert.equal(shouldShowPlayScorePopup(5), true);
  assert.equal(shouldShowPlayScorePopup(10), true);
  assert.equal(shouldShowPlayScorePopup(15), true);
  assert.equal(shouldShowPlayScorePopup(20), true);
  assert.equal(shouldShowPlayScorePopup(0), false);
  section("H. 2-second live glow/popup is independent of player count");
}

{
  const byId = indexTiles([
    createTile(6, 4),
    createTile(3, 2),
    createTile(1, 1),
  ]);
  const loser = { id: "b", hand: ["4-6", "2-3", "1-1"] };
  const reports = COUNTS.map((n) =>
    explainAllFivesRoundEnd({
      winnerIndex: 0,
      byId,
      players: [
        { id: "a", hand: [] },
        loser,
        ...Array.from({ length: n - 2 }, (_, i) => ({ id: `p${i + 2}`, hand: [] })),
      ],
    })
  );
  for (const report of reports) {
    assert.equal(report.rawTotal, 17);
    assert.equal(report.awarded, 15);
    assert.deepEqual(
      report.hands.map((h) => h.playerIndex),
      [1]
    );
  }
  section("J. round-end counting of the same remaining hand is identical for 2P/3P/4P");
}

{
  assert.equal(LEO_MAIN_STRAIGHT, 5);
  assert.equal(LEO_ARM_STRAIGHT, 2);
  assert.equal(FIRST_FOLD_LEFT, "N");
  assert.equal(FIRST_FOLD_RIGHT, "S");
  assert.equal(FIRST_FOLD_TOP, "E");
  assert.equal(FIRST_FOLD_BOTTOM, "W");
  section("layout 5/2 routing is not parameterized by player count");
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const scoring = readFileSync(join(here, "allFivesScoring.js"), "utf8");
  const spinner = readFileSync(join(here, "allFivesSpinner.js"), "utf8");
  assert.equal(scoring.includes("playerCount ==="), false);
  assert.equal(spinner.includes("playerCount ==="), false);
  assert.equal(scoring.includes("players.length === 2"), false);
  assert.equal(spinner.includes("players.length === 2"), false);
  section("no 2P-only American scoring/spinner branch");
}

console.log("\nAll Fives 2P/3P/4P parity tests passed.");
