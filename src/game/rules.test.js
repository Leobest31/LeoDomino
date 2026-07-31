/**
 * Official LeoDomino rules verification.
 * Run: npm run test:rules
 */

import assert from "node:assert/strict";
import {
  PHASE,
  ROUND_END_REASON,
  startMatch,
  getAvailableActions,
  getCurrentLegalMoves,
  playTile,
  drawTile,
  passTurn,
  startNextRound,
  chooseStartingPlayer,
  startingStrength,
  handPipTotal,
  calculateRoundPoints,
  isBoardBlocked,
  applyAutoAction,
  chooseAutoAction,
  END,
} from "./index.js";

function section(title) {
  console.log(`\n✓ ${title}`);
}

// --- Round 1: highest double / highest tile forced open ---
{
  const state = startMatch({ seed: 42, playerIds: ["you", "rival"] });
  const { playerIndex, tileId } = chooseStartingPlayer(state.players, state.byId);
  assert.equal(state.round, 1);
  assert.equal(state.currentPlayer, playerIndex);
  assert.equal(state.mustPlayTileId, tileId);
  assert.ok(state.players[playerIndex].hand.includes(tileId));
  const tile = state.byId[tileId];
  let best = -1;
  for (const p of state.players) {
    for (const id of p.hand) {
      best = Math.max(best, startingStrength(state.byId[id]));
    }
  }
  assert.equal(startingStrength(tile), best);
  section(`Round 1 starter → player ${playerIndex} must open with ${tileId}`);
}

// --- Round 1 ranking: doubles beat non-doubles; 6-5 > 6-4 ---
{
  assert.ok(
    startingStrength({ a: 6, b: 6, isDouble: true }) >
      startingStrength({ a: 5, b: 5, isDouble: true })
  );
  assert.ok(
    startingStrength({ a: 0, b: 0, isDouble: true }) >
      startingStrength({ a: 5, b: 6, isDouble: false })
  );
  assert.ok(
    startingStrength({ a: 5, b: 6, isDouble: false }) >
      startingStrength({ a: 4, b: 6, isDouble: false })
  );
  assert.ok(
    startingStrength({ a: 4, b: 6, isDouble: false }) >
      startingStrength({ a: 3, b: 6, isDouble: false })
  );

  const byId = {
    "6-5": { id: "6-5", a: 5, b: 6, isDouble: false },
    "6-4": { id: "6-4", a: 4, b: 6, isDouble: false },
    "3-5": { id: "3-5", a: 3, b: 5, isDouble: false },
    "2-4": { id: "2-4", a: 2, b: 4, isDouble: false },
  };
  const chosen = chooseStartingPlayer(
    [{ hand: ["6-4", "3-5"] }, { hand: ["6-5", "2-4"] }],
    byId
  );
  assert.equal(chosen.tileId, "6-5");
  assert.equal(chosen.playerIndex, 1);
  section("Round 1 with no doubles → highest tile (6-5) starts");
}

// --- Mandatory first move (Round 1 only) ---
{
  let state = startMatch({ seed: 7, playerIds: ["a", "b"] });
  const forced = state.mustPlayTileId;
  const other = state.players[state.currentPlayer].hand.find((id) => id !== forced);
  if (other) {
    assert.throws(() => playTile(state, other, END.RIGHT), /Must open|Illegal/);
  }
  state = playTile(state, forced, END.RIGHT);
  assert.equal(state.mustPlayTileId, null);
  assert.equal(state.board[0].id, forced);
  section("Round 1 first move must use the designated opening tile");
}

// --- Turn alternation ---
{
  let state = startMatch({ seed: 11, playerIds: ["a", "b"] });
  const first = state.currentPlayer;
  state = playTile(state, state.mustPlayTileId, END.RIGHT);
  if (state.phase === PHASE.PLAYING) {
    assert.equal(state.currentPlayer, (first + 1) % 2);
  }
  section("turn advances after a successful play");
}

// --- Draw until playable / pass only when empty ---
{
  let found = false;
  for (let seed = 200; seed < 400 && !found; seed += 1) {
    let s = startMatch({ seed, playerIds: ["a", "b"] });
    s = playTile(s, s.mustPlayTileId, END.RIGHT);
    if (s.phase !== PHASE.PLAYING) continue;
    const actions = getAvailableActions(s);
    if (!actions.canPlay && actions.canDraw) {
      assert.equal(actions.canPass, false, "cannot pass while reserve has tiles");
      const before = s.reserve.length;
      s = drawTile(s);
      assert.equal(s.reserve.length, before - 1);
      found = true;
      section(`draw allowed when no move (seed ${seed}); pass blocked while reserve remains`);
    }
  }
  assert.ok(found, "expected to find a draw-required position in seed scan");
}

// --- Pass when blocked path ---
{
  const byId = Object.fromEntries(Object.entries(startMatch({ seed: 1 }).byId));

  let state = {
    ...startMatch({ seed: 1, playerIds: ["a", "b"] }),
    board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
    reserve: [],
    mustPlayTileId: null,
    consecutivePasses: 0,
    currentPlayer: 0,
    players: [
      { id: "a", hand: ["0-1", "0-2"] },
      { id: "b", hand: ["0-3", "1-2"] },
    ],
    byId,
    phase: PHASE.PLAYING,
  };

  const actions = getAvailableActions(state);
  assert.equal(actions.canPlay, false);
  assert.equal(actions.canDraw, false);
  assert.equal(actions.canPass, true);

  state = passTurn(state);
  assert.ok(
    state.phase === PHASE.ROUND_OVER ||
      state.phase === PHASE.MATCH_OVER ||
      state.phase === PHASE.PLAYING
  );
  section("pass allowed only with empty reserve and no legal moves");
}

// --- Domino-out scoring ---
{
  const byId = startMatch({ seed: 1 }).byId;
  const points = calculateRoundPoints({
    winnerIndex: 0,
    players: [
      { hand: [] },
      { hand: ["0-5", "1-1"] }, // 5 + 2 = 7
    ],
    byId,
  });
  assert.equal(points, 7);
  assert.equal(handPipTotal(["6-6"], byId), 12);
  section("round points = sum of opponent hand pips");
}

// --- Following rounds: previous winner starts, any opening tile ---
{
  let state = startMatch({ seed: 55, playerIds: ["a", "b"], targetScore: 500 });
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < 200) {
    const action = chooseAutoAction(state);
    assert.ok(action, `expected an action at step ${guard}`);
    state = applyAutoAction(state, action);
    guard += 1;
  }
  assert.ok(
    state.phase === PHASE.ROUND_OVER || state.phase === PHASE.MATCH_OVER,
    "game should leave playing phase"
  );

  if (state.phase === PHASE.ROUND_OVER) {
    assert.ok(state.roundResult);
    assert.ok(
      state.roundResult.reason === ROUND_END_REASON.DOMINO ||
        state.roundResult.reason === ROUND_END_REASON.BLOCKED
    );
    const winner = state.roundResult.winnerIndex;
    const next = startNextRound(state, { seed: 56 });
    assert.equal(next.round, state.round + 1);
    assert.equal(next.phase, PHASE.PLAYING);
    assert.deepEqual(next.scores, state.scores);
    assert.equal(next.currentPlayer, winner, "previous winner always starts next round");
    assert.equal(next.mustPlayTileId, null, "later rounds have free opener");

    const openMoves = getCurrentLegalMoves(next);
    const hand = next.players[winner].hand;
    assert.equal(openMoves.length, hand.length, "every hand tile is a legal opening move");
    for (const id of hand) {
      assert.ok(openMoves.some((move) => move.tileId === id));
    }

    const weakest = hand.reduce((best, id) =>
      startingStrength(next.byId[id]) < startingStrength(next.byId[best]) ? id : best
    );
    const after = playTile(next, weakest, END.RIGHT);
    assert.equal(after.board[0].id, weakest);
    assert.equal(after.mustPlayTileId, null);
    section(
      `following round: winner ${winner} starts free (opened with ${weakest}); auto-play took ${guard} actions`
    );
  } else {
    section(`auto-play completed a match in ${guard} actions (skip next-round asserts)`);
  }
}

// --- isBoardBlocked ---
{
  const byId = startMatch({ seed: 2 }).byId;
  const blocked = {
    ...startMatch({ seed: 2, playerIds: ["a", "b"] }),
    board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
    reserve: [],
    mustPlayTileId: null,
    players: [
      { id: "a", hand: ["0-0"] },
      { id: "b", hand: ["1-1"] },
    ],
    byId,
  };
  assert.equal(isBoardBlocked(blocked), true);
  section("blocked detection when reserve empty and no matches");
}

// --- Single-draw: each draw adds exactly one tile ---
{
  let state = startMatch({ seed: 200, playerIds: ["a", "b"] });
  state = playTile(state, state.mustPlayTileId, END.RIGHT);
  let drew = false;
  for (let guard = 0; guard < 20 && getAvailableActions(state).canDraw; guard += 1) {
    const beforeHand = state.players[state.currentPlayer].hand.length;
    const beforeReserve = state.reserve.length;
    state = drawTile(state);
    assert.equal(state.players[state.currentPlayer].hand.length, beforeHand + 1);
    assert.equal(state.reserve.length, beforeReserve - 1);
    drew = true;
    if (getAvailableActions(state).canPlay) break;
  }
  assert.ok(drew, "expected at least one single-tile draw");
  section("draw adds exactly one tile per call (never a batch)");
}

console.log("\nOfficial LeoDomino rules tests passed.\n");
