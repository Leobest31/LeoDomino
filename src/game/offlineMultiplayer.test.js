/**
 * Offline multiplayer (2 / 3 / 4) — seats, AI turns, memory.
 * Run: npm run test:offline-mp
 */

import assert from "node:assert/strict";
import {
  PHASE,
  HAND_SIZE,
  startMatch,
  playTile,
  getAvailableActions,
  applyAiTurn,
  applyAutoAction,
  chooseAiAction,
  buildMemory,
  opponentMatchProbability,
  normalizePlayerCount,
  buildOfflinePlayerIds,
  isAiSeat,
  isHumanSeat,
  HUMAN_INDEX,
} from "./index.js";

function section(title) {
  console.log(`\n✓ ${title}`);
}

// --- Seat helpers ---
assert.equal(normalizePlayerCount(2), 2);
assert.equal(normalizePlayerCount(3), 3);
assert.equal(normalizePlayerCount(4), 4);
assert.equal(normalizePlayerCount(99), 2);
assert.equal(normalizePlayerCount("nope"), 2);
assert.deepEqual(buildOfflinePlayerIds(2), ["you", "rival"]);
assert.deepEqual(buildOfflinePlayerIds(3), ["you", "rival", "rival-2"]);
assert.deepEqual(buildOfflinePlayerIds(4), ["you", "rival", "rival-2", "rival-3"]);
assert.equal(isHumanSeat(0), true);
assert.equal(isAiSeat(0), false);
assert.equal(isAiSeat(2), true);
section("offline seat helpers");

// --- Deal sizes for each table ---
for (const playerCount of [2, 3, 4]) {
  const state = startMatch({
    seed: 100 + playerCount,
    playerCount,
    playerIds: buildOfflinePlayerIds(playerCount),
    targetScore: 100,
  });
  assert.equal(state.players.length, playerCount);
  assert.equal(state.scores.length, playerCount);
  for (const player of state.players) {
    assert.equal(player.hand.length, HAND_SIZE);
  }
  const dealt = playerCount * HAND_SIZE;
  assert.equal(state.reserve.length, 28 - dealt);
}
section("startMatch deals 7 tiles for 2/3/4 players");

// --- AI memory is multiplayer-shaped ---
{
  const state = startMatch({
    seed: 42,
    playerCount: 4,
    playerIds: buildOfflinePlayerIds(4),
  });
  // Memory for seat 2 must not pretend the only opponent is seat 0.
  const memory = buildMemory(state, 2);
  assert.equal(memory.playerCount, 4);
  assert.equal(memory.otherHandSizes.length, 3);
  assert.equal(
    memory.otherHandSizes.reduce((sum, n) => sum + n, 0),
    HAND_SIZE * 3
  );
  assert.equal(memory.nextOpponentHandSize, HAND_SIZE);
  assert.ok(memory.opponentHandSize <= HAND_SIZE);
  assert.ok(memory.unknownIds.length > 0);

  // Probability uses next-seat hand size, not a hard-coded 2p index.
  const p = opponentMatchProbability(6, memory);
  assert.ok(p >= 0 && p <= 1);

  const memorySeat3 = buildMemory(state, 3);
  assert.equal(memorySeat3.nextOpponentHandSize, state.players[0].hand.length);
}
section("AI memory tracks all other seats (3+/4p)");

// --- Every AI seat can take a legal turn ---
{
  for (const playerCount of [2, 3, 4]) {
    for (const seed of [7, 19, 55]) {
      let state = startMatch({
        seed,
        playerCount,
        playerIds: buildOfflinePlayerIds(playerCount),
        targetScore: 500,
      });

      // Drive until an AI seat is current (or round ends).
      let guard = 40;
      while (
        state.phase === PHASE.PLAYING &&
        state.currentPlayer === HUMAN_INDEX &&
        guard > 0
      ) {
        const actions = getAvailableActions(state);
        if (actions.canPlay && state.mustPlayTileId) {
          state = playTile(state, state.mustPlayTileId, "right");
        } else if (actions.canPlay) {
          const move = actions.legalMoves[0];
          state = playTile(state, move.tileId, move.end);
        } else if (actions.canDraw) {
          state = applyAutoAction(state, { type: "draw" });
        } else if (actions.canPass) {
          state = applyAutoAction(state, { type: "pass" });
        } else {
          break;
        }
        guard -= 1;
      }

      if (state.phase !== PHASE.PLAYING) continue;
      if (!isAiSeat(state.currentPlayer)) continue;

      const seat = state.currentPlayer;
      const before = getAvailableActions(state);
      const action = chooseAiAction(state, {
        difficulty: "medium",
        aiIndex: seat,
        seed,
      });
      assert.ok(action, `AI seat ${seat} must act (${playerCount}p seed ${seed})`);

      if (action.type === "play") {
        assert.ok(
          before.legalMoves.some(
            (m) => m.tileId === action.tileId && m.end === action.end
          ),
          `illegal AI play at seat ${seat}`
        );
      }

      const next = applyAiTurn(state, { difficulty: "medium", aiIndex: seat });
      assert.ok(next);
      assert.notEqual(
        next.currentPlayer === seat && next.board.length === state.board.length &&
          next.reserve.length === state.reserve.length &&
          next.players[seat].hand.length === state.players[seat].hand.length,
        true,
        "AI turn must change the match"
      );
    }
  }
}
section("multi-AI seats propose and apply legal turns");

// --- Short multi-AI round simulation (all seats after human auto-play as AI) ---
{
  for (const playerCount of [3, 4]) {
    let state = startMatch({
      seed: 88 + playerCount,
      playerCount,
      playerIds: buildOfflinePlayerIds(playerCount),
      targetScore: 50,
    });

    let steps = 0;
    while (state.phase === PHASE.PLAYING && steps < 120) {
      const seat = state.currentPlayer;
      if (seat === HUMAN_INDEX) {
        const actions = getAvailableActions(state);
        if (actions.canPlay) {
          const move = state.mustPlayTileId
            ? actions.legalMoves.find((m) => m.tileId === state.mustPlayTileId) ||
              actions.legalMoves[0]
            : actions.legalMoves[0];
          state = playTile(state, move.tileId, move.end);
        } else if (actions.canDraw) {
          state = applyAutoAction(state, { type: "draw" });
        } else if (actions.canPass) {
          state = applyAutoAction(state, { type: "pass" });
        } else {
          break;
        }
      } else {
        state = applyAiTurn(state, { difficulty: "easy", aiIndex: seat });
      }
      steps += 1;
    }

    assert.ok(
      state.phase === PHASE.ROUND_OVER ||
        state.phase === PHASE.MATCH_OVER ||
        state.phase === PHASE.PLAYING,
      `3+/4p simulation stayed in a valid phase (${playerCount}p)`
    );
    assert.equal(state.players.length, playerCount);
  }
}
section("3/4 player rounds progress with multi-AI orchestration");

console.log("\nOffline multiplayer tests passed.");
