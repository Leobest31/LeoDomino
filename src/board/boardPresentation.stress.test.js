/**
 * Stress: hundreds of random matches — every board snapshot must obey
 * official connections and visual facing fidelity after layout.
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
} from "../game/index.js";
import { layoutBoard } from "./layoutEngine.js";
import { validateBoardPresentation } from "./connectionDisplay.js";

const HUMAN = 0;
const AI = 1;

const VIEWPORTS = [
  { width: 360, height: 280 }, // phone
  { width: 768, height: 420 }, // tablet
  { width: 1100, height: 520 }, // desktop
];

const TILE_SIZE = { w: 40, h: 76 };

function findCenterIndex(board, openingId, spinnerId) {
  if (spinnerId) {
    const i = board.findIndex((t) => t.id === spinnerId);
    if (i >= 0) return i;
  }
  if (!openingId) return 0;
  const i = board.findIndex((t) => t.id === openingId);
  return i >= 0 ? i : 0;
}

function assertBoardOk(board, openingId, label, spinnerId = null) {
  const logicalOnly = validateBoardPresentation(board);
  assert.equal(logicalOnly.ok, true, `${label} logical ${JSON.stringify(logicalOnly)}`);

  if (board.length < 2) return;

  const centerIndex = findCenterIndex(board, openingId, spinnerId);
  for (const viewport of VIEWPORTS) {
    const result = validateBoardPresentation(board, {
      layoutFn: layoutBoard,
      centerIndex,
      viewport,
      tileSize: TILE_SIZE,
    });
    assert.equal(
      result.ok,
      true,
      `${label} visual ${viewport.width}x${viewport.height}: ${JSON.stringify(result)}`
    );
  }
}

function playOneHuman(state) {
  const actions = getAvailableActions(state);
  if (actions.legalMoves.length > 0) {
    const move = actions.legalMoves[0];
    return playTile(state, move.tileId, move.end);
  }
  if (actions.canDraw) return drawTile(state);
  if (actions.canPass) return passTurn(state);
  return state;
}

function advanceAi(state, difficulty) {
  let current = state;
  let guard = 0;
  while (current.phase === PHASE.PLAYING && current.currentPlayer === AI && guard < 50) {
    guard += 1;
    const next = applyAiTurn(current, { difficulty, aiIndex: AI });
    if (!next) break;
    current = next;
    if (current.currentPlayer !== AI || current.phase !== PHASE.PLAYING) break;
  }
  return current;
}

function runSeed(seed, difficulty) {
  let state = startMatch({ seed, targetScore: 100, playerCount: 2 });
  let openingId = state.board[0]?.id ?? null;
  let steps = 0;
  let boardsChecked = 0;

  assertBoardOk(state.board, openingId, `seed ${seed} open`, state.spinnerId);

  while (state.phase === PHASE.PLAYING && steps < 400) {
    steps += 1;
    const beforeLen = state.board.length;

    if (state.currentPlayer === HUMAN) {
      state = playOneHuman(state);
    } else {
      state = advanceAi(state, difficulty);
    }

    if (state.board.length === 1) {
      openingId = state.board[0].id;
    }

    if (state.board.length !== beforeLen || steps % 3 === 0) {
      boardsChecked += 1;
      assertBoardOk(state.board, openingId, `seed ${seed} step ${steps}`, state.spinnerId);
    }

    if (state.phase === PHASE.ROUND_OVER || state.phase === PHASE.MATCH_OVER) {
      assertBoardOk(state.board, openingId, `seed ${seed} end`, state.spinnerId);
      break;
    }
  }

  return { steps, boardsChecked, boardLen: state.board.length, phase: state.phase };
}

const SEEDS = [];
for (let i = 0; i < 200; i += 1) {
  SEEDS.push(1000 + i * 17);
}
// Extra mixed difficulties
const DIFFS = [DIFFICULTY.EASY, DIFFICULTY.MEDIUM, DIFFICULTY.HARD];

let totalBoards = 0;
let games = 0;
for (let i = 0; i < SEEDS.length; i += 1) {
  const difficulty = DIFFS[i % DIFFS.length];
  const summary = runSeed(SEEDS[i], difficulty);
  totalBoards += summary.boardsChecked;
  games += 1;
}

assert.ok(games >= 200, "expected 200 random games");
assert.ok(totalBoards >= 400, `expected many board checks, got ${totalBoards}`);

console.log(
  `Board presentation stress passed: ${games} games, ${totalBoards} board audits across ${VIEWPORTS.length} viewports.`
);
