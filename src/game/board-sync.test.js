/**
 * Regression: human + AI plays must share one board array.
 * Every applied play (either seat) must appear in state.board.
 */
import assert from "node:assert/strict";
import {
  startMatch,
  getAvailableActions,
  playTile,
  drawTile,
  passTurn,
  applyAiTurn,
  PHASE,
  DIFFICULTY,
} from "./index.js";

const HUMAN = 0;
const AI = 1;

function playLegal(state, playerIndex) {
  assert.equal(state.currentPlayer, playerIndex);
  const { legalMoves } = getAvailableActions(state);
  assert.ok(legalMoves.length > 0, `player ${playerIndex} has no legal moves`);
  const move = legalMoves[0];
  return playTile(state, move.tileId, move.end);
}

function advanceAiUntilBoardGrowsOrTurnEnds(state, difficulty) {
  let current = state;
  let guard = 0;
  const beforeIds = new Set(current.board.map((tile) => tile.id));

  while (current.phase === PHASE.PLAYING && current.currentPlayer === AI && guard < 40) {
    guard += 1;
    const next = applyAiTurn(current, { difficulty, aiIndex: AI });
    assert.ok(next);

    const gained = next.board.map((tile) => tile.id).filter((id) => !beforeIds.has(id));
    if (gained.length) {
      assert.equal(gained.length, 1, "AI play must add exactly one shared board tile");
      assert.ok(
        next.board.some((tile) => tile.id === gained[0]),
        "AI tile must live on the single shared board"
      );
      return { state: next, gained };
    }

    if (next.currentPlayer !== AI || next.phase !== PHASE.PLAYING) {
      return { state: next, gained: [] };
    }
    current = next;
  }

  return { state: current, gained: [] };
}

function runMatch(seed, difficulty) {
  let state = startMatch({ seed, targetScore: 100, playerCount: 2 });
  let humanPlays = 0;
  let aiPlays = 0;
  let steps = 0;

  while (state.phase === PHASE.PLAYING && steps < 500) {
    steps += 1;
    const boardBefore = state.board.length;
    const idsBefore = state.board.map((tile) => tile.id);

    if (state.currentPlayer === HUMAN) {
      const actions = getAvailableActions(state);
      if (actions.legalMoves.length > 0) {
        state = playLegal(state, HUMAN);
        humanPlays += 1;
        assert.equal(
          state.board.length,
          boardBefore + 1,
          "human play must append to shared board"
        );
      } else if (actions.canDraw) {
        state = drawTile(state);
      } else if (actions.canPass) {
        state = passTurn(state);
      } else {
        break;
      }
    } else {
      const { state: next, gained } = advanceAiUntilBoardGrowsOrTurnEnds(state, difficulty);
      state = next;
      if (gained.length) aiPlays += 1;
    }

    // Previously played tiles must never be removed mid-round.
    if (state.phase === PHASE.PLAYING) {
      assert.ok(
        state.board.length >= boardBefore,
        "board must never shrink during a round"
      );
      for (const id of idsBefore) {
        assert.ok(
          state.board.some((tile) => tile.id === id),
          `played tile ${id} disappeared from shared board`
        );
      }
    }

    const ids = state.board.map((tile) => tile.id);
    assert.equal(new Set(ids).size, ids.length, "board tile ids must be unique");
    for (const tile of state.board) {
      assert.ok(state.byId[tile.id], `board tile ${tile.id} missing from byId`);
    }
  }

  assert.ok(humanPlays + aiPlays > 0, "match must produce plays");
  assert.ok(aiPlays > 0, `expected AI plays on seed ${seed}, got ${aiPlays}`);
  return { humanPlays, aiPlays, boardLen: state.board.length, steps, phase: state.phase };
}

const seeds = [11, 42, 99, 2024, 7777, 31415];
for (const seed of seeds) {
  const result = runMatch(seed, DIFFICULTY.MEDIUM);
  console.log(
    `seed ${seed}: human=${result.humanPlays} ai=${result.aiPlays} board=${result.boardLen} steps=${result.steps} phase=${result.phase}`
  );
}

console.log("Shared-board AI/human play regression passed.");
