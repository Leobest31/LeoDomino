/**
 * All Fives (American) blocked-round settlement + last-tile move scoring.
 * Run: node src/game/rules/allFivesBlocked.test.js
 */

import assert from "node:assert/strict";
import { createTile, indexTiles } from "../tiles.js";
import { PHASE, ROUND_END_REASON } from "./constants.js";
import { ALL_FIVES_MATCH_TARGET, ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";
import { AMERICAN_RULESET_ID } from "../rulesets/american.js";
import { LEGACY_RULESET_ID } from "../rulesets/legacy.js";
import { HAITIAN_RULESET_ID } from "../rulesets/haitian.js";
import { DOMINICAN_RULESET_ID } from "../rulesets/dominican.js";
import { PUERTO_RICAN_RULESET_ID } from "../rulesets/puertoRican.js";
import {
  ALL_FIVES_BLOCKED_STARTER_FALLBACK,
  allFivesBlockedAwardPerWinner,
  allFivesLoserPool,
  chooseAllFivesBlockedNextStarter,
  firstWinnerInCcwTurnOrder,
  settleAllFivesBlocked,
} from "./allFivesBlocked.js";
import { roundDownToFive, roundToNearestFive } from "./allFivesScoring.js";
import { playTile, passTurn, startNextRound, isBoardBlocked } from "./drawDominoes.js";
import { resolveRuleset } from "../rulesets/index.js";
import {
  MATCH_SAVE_VERSION,
  isValidSavedMatch,
} from "../../persistence/matchSave.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function tiles(...pairs) {
  return indexTiles(pairs.map(([a, b]) => createTile(a, b)));
}

function playing({
  hands,
  byId,
  board = [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
  spinnerId = "6-6",
  scores = null,
  currentPlayer = 0,
  roundStarterIndex = 0,
  rulesetId = ALL_FIVES_RULESET_ID,
  extras = {},
}) {
  return {
    seed: 11,
    byId,
    players: hands.map((hand, index) => ({ id: `p${index}`, hand })),
    reserve: [],
    board,
    spinnerId,
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer,
    scores: scores ?? hands.map(() => 0),
    round: 2,
    targetScore:
      rulesetId === ALL_FIVES_RULESET_ID ? ALL_FIVES_MATCH_TARGET : 100,
    rulesetId,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    ...extras,
  };
}

{
  assert.equal(roundDownToFive(7), 5);
  assert.equal(roundDownToFive(12), 10);
  assert.equal(roundDownToFive(15.5), 15);
  assert.equal(roundDownToFive(6), 5);
  assert.equal(roundDownToFive(3.333), 0);
  assert.equal(roundDownToFive(10 / 3), 0);
  assert.notEqual(roundDownToFive(12), roundToNearestFive(13));
  assert.equal(allFivesBlockedAwardPerWinner(14, 2), 5);
  assert.equal(allFivesBlockedAwardPerWinner(24, 2), 10);
  assert.equal(allFivesBlockedAwardPerWinner(31, 2), 15);
  assert.equal(allFivesBlockedAwardPerWinner(18, 3), 5);
  assert.equal(allFivesBlockedAwardPerWinner(10, 3), 0);
  assert.equal(allFivesBlockedAwardPerWinner(35, 1), 35);
  assert.equal(allFivesBlockedAwardPerWinner(0, 4), 0);
  assert.equal(ALL_FIVES_BLOCKED_STARTER_FALLBACK, "ccwTurnOrderFromRoundStarter");
  section("tied share floors to a 5-point increment; never rounds up");
}

{
  const byId = tiles([5, 5], [2, 2], [3, 4]);
  const state = playing({
    byId,
    hands: [["5-5"], ["2-2", "3-4"]],
    board: [],
    spinnerId: null,
  });
  const after = playTile(state, "5-5");
  assert.equal(after.lastPlayPoints, 10, "live move score must be awarded");
  assert.equal(after.lastPlayPointsSeat, 0);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.DOMINO);
  assert.equal(after.roundResult.points, 10, "round settlement is separate (11→10)");
  assert.deepEqual(after.scores, [20, 0], "move 10 then round 10, not skipped");
  assert.ok(after.players[0].hand.length === 0);
  assert.equal(after.roundResult.winnerIndex, 0);
  section("final tile: live score awarded, then empty-hand round end");
}

{
  const byId = tiles(
    [6, 6],
    [1, 4],
    [3, 5],
    [2, 4],
    [2, 3],
    [5, 5],
    [3, 3]
  );
  const state = playing({
    byId,
    hands: [["1-4"], ["3-5"], ["2-4", "2-3"], ["5-5", "3-3"]],
  });
  assert.deepEqual(
    settleAllFivesBlocked({
      players: state.players,
      byId,
      currentPlayer: 0,
      roundStarterIndex: 0,
    }).pipTotals,
    [5, 8, 11, 16]
  );
  assert.equal(isBoardBlocked(state), true);
  const after = passTurn(state);
  assert.equal(after.phase, PHASE.ROUND_OVER);
  assert.equal(after.roundResult.reason, ROUND_END_REASON.BLOCKED);
  assert.deepEqual(after.roundResult.winnerIndices, [0]);
  assert.equal(after.roundResult.winnerIndex, 0);
  assert.equal(after.roundResult.points, 35);
  assert.deepEqual(after.scores, [35, 0, 0, 0]);
  assert.equal(after.roundResult.nextStarterIndex, 0);
  assert.equal(allFivesLoserPool([5, 8, 11, 16], [0]), 8 + 11 + 16);
  section("single blocked winner: loser pool 8+11+16, winner only");
}

{
  const byId = tiles([6, 6], [1, 4], [0, 5], [2, 4], [3, 5]);
  const state = playing({
    byId,
    hands: [["1-4"], ["0-5"], ["2-4"], ["3-5"]],
  });
  const settled = settleAllFivesBlocked({
    players: state.players,
    byId,
    currentPlayer: 0,
    roundStarterIndex: 0,
  });
  assert.deepEqual(settled.winnerIndices, [0, 1]);
  assert.equal(settled.loserPool, 14);
  assert.equal(settled.awardPerWinner, 5);
  const after = passTurn(state);
  assert.deepEqual(after.roundResult.winnerIndices, [0, 1]);
  assert.equal(after.roundResult.winnerIndex, null);
  assert.equal(after.roundResult.tied, true);
  assert.equal(after.roundResult.points, 5);
  assert.deepEqual(after.scores, [5, 5, 0, 0]);
  section("two tied winners: pool 14 → +5 each; losers +0");
}

{
  const byId = tiles([6, 6], [1, 4], [0, 5], [5, 5], [0, 2], [4, 4], [3, 1]);
  const state = playing({
    byId,
    hands: [["1-4"], ["0-5"], ["5-5", "0-2"], ["4-4", "1-3"]],
  });
  const settled = settleAllFivesBlocked({
    players: state.players,
    byId,
  });
  assert.deepEqual(settled.winnerIndices, [0, 1]);
  assert.equal(settled.loserPool, 24);
  assert.equal(settled.awardPerWinner, 10);
  const after = passTurn(state);
  assert.deepEqual(after.scores, [10, 10, 0, 0]);
  section("two tied winners: pool 24 → +10 each");
}

{
  const byId = tiles([6, 6], [1, 4], [0, 5], [2, 3], [5, 5], [4, 4]);
  const state = playing({
    byId,
    hands: [["1-4"], ["0-5"], ["2-3"], ["5-5", "4-4"]],
  });
  const settled = settleAllFivesBlocked({
    players: state.players,
    byId,
  });
  assert.deepEqual(settled.winnerIndices, [0, 1, 2]);
  assert.equal(settled.loserPool, 18);
  assert.equal(settled.awardPerWinner, 5);
  const after = passTurn(state);
  assert.deepEqual(after.scores, [5, 5, 5, 0]);
  section("three tied winners: pool 18 / 3 floors to +5 each");
}

{
  const byId = tiles([6, 6], [0, 4], [1, 3], [2, 2], [1, 1], [0, 2]);
  const state = playing({
    byId,
    hands: [["0-4"], ["1-3"], ["2-2"], ["1-1", "0-2"]],
    roundStarterIndex: 0,
  });
  const settled = settleAllFivesBlocked({
    players: state.players,
    byId,
    roundStarterIndex: 0,
    currentPlayer: 0,
  });
  assert.deepEqual(settled.winnerIndices, [0, 1, 2, 3]);
  assert.equal(settled.loserPool, 0);
  assert.equal(settled.awardPerWinner, 0);
  const after = passTurn(state);
  assert.deepEqual(after.roundResult.winnerIndices, [0, 1, 2, 3]);
  assert.equal(after.roundResult.tied, true);
  assert.deepEqual(after.scores, [0, 0, 0, 0]);
  assert.equal(after.roundResult.nextStarterIndex, 2, "highest double 2-2 starts");
  const resumed = startNextRound(after, { seed: 99 });
  assert.equal(resumed.currentPlayer, 2);
  section("all players tied: loserPool 0, +0 each, starter still resolves");
}

{
  const players = [
    { id: "a", hand: ["4-4"] },
    { id: "b", hand: ["2-6"] },
  ];
  const byId = tiles([4, 4], [6, 2]);
  assert.equal(
    chooseAllFivesBlockedNextStarter({
      winnerIndices: [0, 1],
      players,
      byId,
      roundStarterIndex: 1,
    }),
    0
  );
  section("starter: 4-4 beats non-double 6-2");
}

{
  const players = [
    { id: "a", hand: ["3-3"] },
    { id: "b", hand: ["5-5"] },
  ];
  const byId = tiles([3, 3], [5, 5]);
  assert.equal(
    chooseAllFivesBlockedNextStarter({
      winnerIndices: [0, 1],
      players,
      byId,
    }),
    1
  );
  section("starter: 5-5 beats 3-3");
}

{
  const players = [
    { id: "a", hand: ["4-6"] },
    { id: "b", hand: ["3-6"] },
  ];
  const byId = tiles([6, 4], [6, 3]);
  assert.equal(
    chooseAllFivesBlockedNextStarter({
      winnerIndices: [0, 1],
      players,
      byId,
    }),
    0
  );
  section("starter: no doubles, 6-4 beats 6-3 by total");
}

{
  const players = [
    { id: "a", hand: ["2-6"] },
    { id: "b", hand: ["3-5"] },
  ];
  const byId = tiles([6, 2], [5, 3]);
  assert.equal(
    chooseAllFivesBlockedNextStarter({
      winnerIndices: [0, 1],
      players,
      byId,
    }),
    0
  );
  section("starter: equal total 8, high side 6 > 5");
}

{
  const byId = {
    "p0-best": { id: "p0-best", a: 6, b: 2, isDouble: false },
    "p1-best": { id: "p1-best", a: 6, b: 2, isDouble: false },
    "2-4": createTile(2, 4),
    "3-5": createTile(3, 5),
  };
  const players = [
    { id: "a", hand: ["p0-best"] },
    { id: "b", hand: ["p1-best"] },
    { id: "c", hand: ["2-4"] },
    { id: "d", hand: ["3-5"] },
  ];
  const fromSeat1 = chooseAllFivesBlockedNextStarter({
    winnerIndices: [0, 1],
    players,
    byId,
    roundStarterIndex: 1,
    currentPlayer: 1,
  });
  const fromSeat2 = chooseAllFivesBlockedNextStarter({
    winnerIndices: [0, 1],
    players,
    byId,
    roundStarterIndex: 2,
    currentPlayer: 2,
  });
  assert.equal(fromSeat1, 1, "origin 1 is a tied winner, so 1 starts");
  assert.equal(fromSeat2, 0, "CCW from 2 hits 0 before 1");
  assert.equal(
    firstWinnerInCcwTurnOrder([0, 1], 2, 4),
    0
  );
  assert.equal(fromSeat1, fromSeat1);
  const again = chooseAllFivesBlockedNextStarter({
    winnerIndices: [0, 1],
    players,
    byId,
    roundStarterIndex: 2,
    currentPlayer: 2,
  });
  assert.equal(again, fromSeat2);
  section("stable CCW fallback from round starter; no randomness");
}

{
  const byId = tiles([6, 6], [1, 4], [0, 5], [2, 4], [3, 5]);
  const allFives = passTurn(
    playing({
      byId,
      hands: [["1-4"], ["0-5"], ["2-4"], ["3-5"]],
    })
  );
  const wrapped = {
    version: MATCH_SAVE_VERSION,
    savedAt: Date.now(),
    matchStartedAt: Date.now(),
    difficulty: "normal",
    selectedId: null,
    state: allFives,
  };
  assert.equal(isValidSavedMatch(wrapped), true);
  const next = startNextRound(allFives, { seed: 7 });
  assert.equal(next.currentPlayer, allFives.roundResult.nextStarterIndex);
  assert.deepEqual(allFives.roundResult.winnerIndices, [0, 1]);
  section("save/resume keeps tied winners, awards, and next starter");
}

{
  const byId = tiles([6, 6], [1, 4], [0, 5], [2, 4], [3, 5]);
  const classic = passTurn(
    playing({
      byId,
      hands: [["1-4"], ["0-5"], ["2-4"], ["3-5"]],
      rulesetId: AMERICAN_RULESET_ID,
    })
  );
  assert.equal(classic.roundResult.winnerIndex, 0, "classic still picks one winner");
  assert.equal(classic.roundResult.tied, undefined);
  assert.equal(classic.roundResult.points, 5 + 6 + 8);
  assert.deepEqual(classic.scores, [19, 0, 0, 0]);
  assert.equal(
    resolveRuleset(AMERICAN_RULESET_ID).policies.resolveBlockedOutcome,
    undefined
  );
  assert.equal(
    resolveRuleset(LEGACY_RULESET_ID).policies.resolveBlockedOutcome,
    undefined
  );
  assert.equal(
    resolveRuleset(HAITIAN_RULESET_ID).policies.resolveBlockedOutcome,
    undefined
  );
  assert.equal(
    resolveRuleset(DOMINICAN_RULESET_ID).policies.resolveBlockedOutcome,
    undefined
  );
  assert.equal(
    resolveRuleset(PUERTO_RICAN_RULESET_ID).policies.resolveBlockedOutcome,
    undefined
  );
  section("Classic/Haitian/Dominican/PR blocked policy unchanged");
}

{
  const byId = tiles([5, 5], [2, 3]);
  const after = playTile(
    playing({
      byId,
      hands: [["5-5"], ["2-3"]],
      board: [],
      spinnerId: null,
      extras: { scores: [0, 0] },
    }),
    "5-5"
  );
  assert.equal(after.lastPlayPoints, 10);
  assert.ok(after.spinnerId === "5-5" || after.board[0]?.id === "5-5");
  section("spinner identity / live 5-5 scoring still +10");
}

console.log("\nAll Fives blocked-round tests passed.");
