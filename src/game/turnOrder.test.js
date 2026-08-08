/**
 * 4-player turn rotation — counter-clockwise around the felt.
 * Run: npm run test:turn-order
 *
 * Seats: 0=Human(bottom), 1=Opp1(top), 2=Opp2(left), 3=Opp3(right)
 * Cycle: 1 → 2 → 0 → 3 → 1
 */

import assert from "node:assert/strict";
import {
  PHASE,
  startMatch,
  playTile,
  drawTile,
  passTurn,
  getAvailableActions,
  applyAutoAction,
  applyAiTurn,
  DIFFICULTY,
  buildOfflinePlayerIds,
  nextPlayerIndex,
  NEXT_PLAYER_4P,
  opponentFeltPosition,
  HUMAN_INDEX,
} from "./index.js";

function section(title) {
  console.log(`\n✓ ${title}`);
}

function startFour(seed = 42) {
  return startMatch({
    seed,
    playerCount: 4,
    playerIds: buildOfflinePlayerIds(4),
    targetScore: 500,
  });
}

function withSeat(state, seat) {
  return {
    ...state,
    currentPlayer: seat,
    mustPlayTileId: null,
    consecutivePasses: 0,
    statusKey: null,
    statusVars: null,
  };
}

/**
 * Advance exactly one turn from `seat` via play / draw-loop / pass.
 * Returns the state after the seat has finished acting (turn passed or round over).
 */
function takeOneTurn(state, seat, { asAi = false } = {}) {
  let current = withSeat(state, seat);
  assert.equal(current.currentPlayer, seat);

  if (asAi && seat !== HUMAN_INDEX) {
    const next = applyAiTurn(current, { difficulty: DIFFICULTY.EASY, aiIndex: seat });
    return next;
  }

  let guard = 20;
  while (guard > 0 && current.phase === PHASE.PLAYING && current.currentPlayer === seat) {
    guard -= 1;
    const actions = getAvailableActions(current);
    if (actions.canPlay) {
      const move = actions.legalMoves[0];
      current = playTile(current, move.tileId, move.end);
      break;
    }
    if (actions.canDraw) {
      current = drawTile(current);
      // Draw keeps the same seat — continue until play/pass.
      continue;
    }
    if (actions.canPass) {
      current = passTurn(current);
      break;
    }
    // Fallback auto action
    const auto = { type: actions.canPlay ? "play" : actions.canDraw ? "draw" : "pass" };
    if (auto.type === "play") {
      const move = actions.legalMoves[0];
      current = playTile(current, move.tileId, move.end);
    } else {
      current = applyAutoAction(current, auto.type === "draw" ? { type: "draw" } : { type: "pass" });
    }
    break;
  }

  return current;
}

// --- Unit: nextPlayerIndex mapping ---
assert.deepEqual([...NEXT_PLAYER_4P], [3, 2, 0, 1]);

assert.equal(nextPlayerIndex(0, 2), 1);
assert.equal(nextPlayerIndex(1, 2), 0);

assert.equal(nextPlayerIndex(0, 3), 1);
assert.equal(nextPlayerIndex(1, 3), 2);
assert.equal(nextPlayerIndex(2, 3), 0);

assert.equal(nextPlayerIndex(0, 4), 3); // Human → Opp3 (right)
assert.equal(nextPlayerIndex(1, 4), 2); // Opp1 → Opp2 (left)
assert.equal(nextPlayerIndex(2, 4), 0); // Opp2 → Human
assert.equal(nextPlayerIndex(3, 4), 1); // Opp3 → Opp1 (top)

// Full cycles from each starter
const EXPECTED_CYCLES = {
  1: [1, 2, 0, 3],
  2: [2, 0, 3, 1],
  0: [0, 3, 1, 2],
  3: [3, 1, 2, 0],
};

for (const [starter, cycle] of Object.entries(EXPECTED_CYCLES)) {
  const start = Number(starter);
  /** @type {number[]} */
  const walked = [start];
  let seat = start;
  for (let i = 0; i < 3; i += 1) {
    seat = nextPlayerIndex(seat, 4);
    walked.push(seat);
  }
  assert.deepEqual(walked, cycle, `cycle from starter ${start}`);
  // Fifth step returns to starter
  assert.equal(nextPlayerIndex(walked[3], 4), start);
}
section("nextPlayerIndex CCW cycles for all 4 starters");

// --- Felt positions stay aligned with labels ---
assert.equal(opponentFeltPosition(1, 4), "top");
assert.equal(opponentFeltPosition(2, 4), "left");
assert.equal(opponentFeltPosition(3, 4), "right");
assert.equal(opponentFeltPosition(0, 4), null);
assert.equal(opponentFeltPosition(1, 2), "top");
assert.equal(opponentFeltPosition(1, 3), "top");
assert.equal(opponentFeltPosition(2, 3), "left");
section("opponent felt positions");

// --- After a completed action, engine advances to CCW next ---
{
  for (const starter of [0, 1, 2, 3]) {
    for (const seed of [11, 42, 77, 2024]) {
      const base = startFour(seed);
      const after = takeOneTurn(base, starter);
      if (after.phase !== PHASE.PLAYING) continue;
      assert.equal(
        after.currentPlayer,
        nextPlayerIndex(starter, 4),
        `seed ${seed} starter ${starter}: expected next ${nextPlayerIndex(starter, 4)}, got ${after.currentPlayer}`
      );
      assert.notEqual(
        after.currentPlayer,
        starter,
        `seed ${seed}: starter ${starter} must not keep the turn after acting`
      );
    }
  }
}
section("play/pass advances to CCW next for every starter");

// --- Drawing does not change the active seat ---
{
  for (const seat of [0, 1, 2, 3]) {
    const base = startFour(7);
    const stuckHand = ["0-0", "1-1", "2-2", "3-3", "4-4", "0-1", "1-2"];
    const probe = {
      ...base,
      phase: PHASE.PLAYING,
      currentPlayer: seat,
      mustPlayTileId: null,
      consecutivePasses: 0,
      // Ends are both 6 — stuckHand has no 6.
      board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
      players: base.players.map((player, index) =>
        index === seat ? { ...player, hand: stuckHand.slice() } : player
      ),
      reserve: ["5-5", "5-6", "4-5", "4-6", "3-5", "3-6", "2-5", "2-6"],
    };
    assert.ok(probe.reserve.length > 0, "synthetic reserve must be non-empty");
    const actions = getAvailableActions(probe);
    assert.equal(actions.canDraw, true, `seat ${seat} should be allowed to draw`);
    const next = drawTile(probe);
    assert.equal(next.currentPlayer, seat, "draw must keep the same player");
    assert.equal(next.phase, PHASE.PLAYING);
  }
}
section("drawing does not change turn order");

// --- Walk a full 4-seat CCW ring without double turns ---
{
  for (const starter of [0, 1, 2, 3]) {
    let state = startFour(100 + starter);
    state = withSeat(state, starter);
    /** @type {number[]} */
    const seatsSeen = [];
    let guard = 12;
    while (guard > 0 && state.phase === PHASE.PLAYING && seatsSeen.length < 4) {
      guard -= 1;
      const seat = state.currentPlayer;
      if (seatsSeen.length > 0) {
        assert.notEqual(seat, seatsSeen[seatsSeen.length - 1], "no consecutive double turn");
      }
      seatsSeen.push(seat);
      state = takeOneTurn(state, seat);
      if (state.phase !== PHASE.PLAYING) break;
    }
    if (seatsSeen.length === 4) {
      assert.deepEqual(seatsSeen, EXPECTED_CYCLES[starter]);
    }
  }
}
section("full ring has no consecutive double turns");

// --- AI turn advances exactly once to the CCW successor ---
{
  for (const starter of [1, 2, 3]) {
    for (const seed of [5, 17, 29]) {
      const base = startFour(seed);
      const after = takeOneTurn(base, starter, { asAi: true });
      if (after.phase !== PHASE.PLAYING) continue;
      assert.equal(
        after.currentPlayer,
        nextPlayerIndex(starter, 4),
        `AI seat ${starter} seed ${seed}`
      );
    }
  }
}
section("AI turns advance exactly once (CCW)");

// --- 2-player and 3-player sequential order unchanged ---
{
  for (const count of [2, 3]) {
    for (let seat = 0; seat < count; seat += 1) {
      assert.equal(nextPlayerIndex(seat, count), (seat + 1) % count);
    }
    for (const seed of [8, 40]) {
      let state = startMatch({
        seed,
        playerCount: count,
        playerIds: buildOfflinePlayerIds(count),
        targetScore: 500,
      });
      const starter = state.currentPlayer;
      const after = takeOneTurn(state, starter);
      if (after.phase === PHASE.PLAYING) {
        assert.equal(after.currentPlayer, (starter + 1) % count);
      }
    }
  }
}
section("2-player and 3-player turn order unchanged");

console.log("\n4-player turn order tests passed.\n");
