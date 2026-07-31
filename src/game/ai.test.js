/**
 * Phase 5 AI verification.
 * Run: npm run test:ai
 */

import assert from "node:assert/strict";
import {
  DIFFICULTY,
  DIFFICULTY_ORDER,
  startMatch,
  playTile,
  getAvailableActions,
  chooseAiAction,
  chooseThinkTimeMs,
  applyAiTurn,
  applyAutoAction,
  startNextRound,
  PHASE,
} from "./index.js";

function section(title) {
  console.log(`\n✓ ${title}`);
}

assert.deepEqual(DIFFICULTY_ORDER, [
  "beginner",
  "easy",
  "medium",
  "hard",
  "expert",
]);
section("five difficulty levels registered");

// --- Never illegal ---
{
  for (const difficulty of DIFFICULTY_ORDER) {
    for (const seed of [3, 17, 44, 90]) {
      let state = startMatch({ seed, playerIds: ["a", "b"] });
      // Force AI seat to be current by playing until current is 1 or AI opens
      if (state.currentPlayer === 0) {
        state = playTile(state, state.mustPlayTileId, "right");
      }
      if (state.phase !== PHASE.PLAYING) continue;
      if (state.currentPlayer !== 1) continue;

      const before = getAvailableActions(state);
      const action = chooseAiAction(state, { difficulty, aiIndex: 1, seed });
      assert.ok(action, `AI must act (${difficulty}, seed ${seed})`);

      if (action.type === "play") {
        assert.ok(
          before.legalMoves.some(
            (m) => m.tileId === action.tileId && m.end === action.end
          ),
          `illegal play proposed (${difficulty}, ${action.tileId}@${action.end})`
        );
      } else if (action.type === "draw") {
        assert.equal(before.canDraw, true);
      } else if (action.type === "pass") {
        assert.equal(before.canPass, true);
      }

      // Applying must not throw
      state = applyAutoAction(state, action);
      assert.ok(state);
    }
  }
  section("AI never proposes illegal moves across difficulties/seeds");
}

// --- Determinism ---
{
  let state = startMatch({ seed: 123, playerIds: ["a", "b"] });
  if (state.currentPlayer === 0) {
    state = playTile(state, state.mustPlayTileId, "right");
  }
  assert.equal(state.currentPlayer, 1);

  const a = chooseAiAction(state, { difficulty: DIFFICULTY.EXPERT, aiIndex: 1, seed: 123 });
  const b = chooseAiAction(state, { difficulty: DIFFICULTY.EXPERT, aiIndex: 1, seed: 123 });
  assert.deepEqual(a, b);

  const t1 = chooseThinkTimeMs(state, DIFFICULTY.HARD, 123);
  const t2 = chooseThinkTimeMs(state, DIFFICULTY.HARD, 123);
  assert.equal(t1, t2);
  assert.ok(t1 >= 500 && t1 <= 1500);
  section("same seed → identical AI choice and think time");
}

// --- Think time bounds for all levels ---
{
  const state = startMatch({ seed: 5, playerIds: ["a", "b"] });
  for (const difficulty of DIFFICULTY_ORDER) {
    for (let i = 0; i < 8; i += 1) {
      const ms = chooseThinkTimeMs(state, difficulty, 1000 + i);
      assert.ok(ms >= 500 && ms <= 1500, `${difficulty} think ${ms}`);
    }
  }
  section("think times stay within 0.5–1.5s");
}

// --- Beginner differs from expert often ---
{
  let diverged = false;
  for (const seed of [10, 20, 30, 40, 50, 60, 70, 80]) {
    let state = startMatch({ seed, playerIds: ["a", "b"] });
    if (state.currentPlayer === 0) {
      state = playTile(state, state.mustPlayTileId, "right");
    }
    if (state.phase !== PHASE.PLAYING || state.currentPlayer !== 1) continue;
    if (getAvailableActions(state).legalMoves.length < 2) continue;

    const beginner = chooseAiAction(state, {
      difficulty: DIFFICULTY.BEGINNER,
      aiIndex: 1,
      seed,
    });
    const expert = chooseAiAction(state, {
      difficulty: DIFFICULTY.EXPERT,
      aiIndex: 1,
      seed,
    });
    if (JSON.stringify(beginner) !== JSON.stringify(expert)) {
      diverged = true;
      break;
    }
  }
  assert.ok(diverged, "beginner and expert should diverge on some positions");
  section("beginner play style differs from expert");
}

// --- Full AI round can complete offline ---
{
  let state = startMatch({ seed: 77, playerIds: ["a", "b"], targetScore: 500 });
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < 250) {
    state = applyAiTurn(state, {
      difficulty: DIFFICULTY.MEDIUM,
      aiIndex: state.currentPlayer,
      seed: 77,
    });
    guard += 1;
  }
  assert.ok(
    state.phase === PHASE.ROUND_OVER || state.phase === PHASE.MATCH_OVER,
    "AI-vs-AI should finish a round"
  );
  section(`medium AI finished a round in ${guard} plies`);
}

// --- Later round: AI may open with any tile when it won previously ---
{
  let state = startMatch({ seed: 77, playerIds: ["a", "b"], targetScore: 500 });
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < 250) {
    state = applyAiTurn(state, {
      difficulty: DIFFICULTY.MEDIUM,
      aiIndex: state.currentPlayer,
      seed: 77,
    });
    guard += 1;
  }
  if (state.phase === PHASE.ROUND_OVER) {
    const winner = state.roundResult.winnerIndex;
    state = startNextRound(state, { seed: 88 });
    assert.equal(state.mustPlayTileId, null);
    assert.equal(state.currentPlayer, winner);
    const actions = getAvailableActions(state);
    assert.equal(actions.legalMoves.length, state.players[winner].hand.length);
    if (winner === 1) {
      const action = chooseAiAction(state, {
        difficulty: DIFFICULTY.EXPERT,
        aiIndex: 1,
        seed: 88,
      });
      assert.equal(action.type, "play");
      assert.ok(state.players[1].hand.includes(action.tileId));
      state = applyAutoAction(state, action);
      assert.equal(state.board.length, 1);
    }
    section("later-round AI free opener respects winner start");
  } else {
    section("later-round AI free opener skipped (match ended on round 1)");
  }
}

console.log("\nPhase 5 AI tests passed.\n");
