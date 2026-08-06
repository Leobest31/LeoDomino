/**
 * One-shot QA probe — mass matches, multiplayer, save/load continuity.
 * Run: node scripts/qa-mass-matches.mjs
 */
import assert from "node:assert/strict";
import {
  DIFFICULTY_ORDER,
  PHASE,
  startMatch,
  applyAiTurn,
  startNextRound,
} from "../src/game/index.js";
import {
  isValidSavedMatch,
  MATCH_SAVE_VERSION,
  sanitizeSelectedId,
} from "../src/persistence/matchSave.js";
import { layoutBoard } from "../src/board/layoutEngine.js";

function playToEnd(state, difficulty, seed, maxPlies = 400) {
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < maxPlies) {
    state = applyAiTurn(state, {
      difficulty,
      aiIndex: state.currentPlayer,
      seed: seed + guard,
    });
    guard += 1;
  }
  return { state, plies: guard };
}

function playFullMatch(options) {
  const { seed, difficulty, playerCount, targetScore = 50, playerIds } = options;
  let state = startMatch({
    seed,
    playerCount,
    playerIds,
    targetScore,
  });
  let rounds = 0;
  let totalPlies = 0;
  const maxRounds = 80;

  while (state.phase !== PHASE.MATCH_OVER && rounds < maxRounds) {
    const { state: next, plies } = playToEnd(state, difficulty, seed + rounds * 1000);
    state = next;
    totalPlies += plies;
    rounds += 1;

    if (state.phase === PHASE.ROUND_OVER) {
      assert.ok(state.roundResult, "roundResult present");
      assert.ok(
        Number.isInteger(state.roundResult.winnerIndex),
        `winnerIndex integer (got ${state.roundResult.winnerIndex})`
      );
      assert.equal(state.scores.length, playerCount);
      for (const s of state.scores) {
        assert.ok(Number.isFinite(s) && s >= 0, `score non-negative: ${s}`);
      }
      const ids = state.board.map((p) => p.id).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, "unique board tile ids");
      state = startNextRound(state, { seed: seed + rounds * 17 });
    } else if (state.phase === PHASE.MATCH_OVER) {
      break;
    } else if (state.phase === PHASE.PLAYING) {
      throw new Error(`stuck in PLAYING after ${plies} plies (seed=${seed})`);
    } else {
      throw new Error(`unexpected phase ${state.phase}`);
    }
  }

  assert.equal(
    state.phase,
    PHASE.MATCH_OVER,
    `match should end (seed=${seed}, rounds=${rounds})`
  );
  assert.ok(
    state.matchWinner != null && state.scores[state.matchWinner] >= targetScore,
    "match winner reached target"
  );
  return { rounds, totalPlies, scores: state.scores.slice(), winner: state.matchWinner };
}

const results = {
  matches2p: 0,
  matches3p: 0,
  matches4p: 0,
  failures: [],
  byDifficulty: {},
};

console.log("=== 2-player mass matches (300) ===");
for (let i = 0; i < 300; i += 1) {
  const difficulty = DIFFICULTY_ORDER[i % DIFFICULTY_ORDER.length];
  const seed = 10000 + i * 13;
  try {
    const r = playFullMatch({
      seed,
      difficulty,
      playerCount: 2,
      playerIds: ["you", "rival"],
      targetScore: 50,
    });
    results.matches2p += 1;
    results.byDifficulty[difficulty] = (results.byDifficulty[difficulty] || 0) + 1;
    if (i % 50 === 0) {
      console.log(
        `  #${i} ${difficulty} rounds=${r.rounds} plies=${r.totalPlies} scores=${r.scores}`
      );
    }
  } catch (err) {
    results.failures.push({
      kind: "2p",
      seed,
      difficulty,
      message: String(err.message || err),
    });
    console.error(`FAIL 2p seed=${seed} ${difficulty}:`, err.message || err);
  }
}

console.log("=== 3-player matches (40) ===");
for (let i = 0; i < 40; i += 1) {
  const difficulty = DIFFICULTY_ORDER[i % DIFFICULTY_ORDER.length];
  const seed = 20000 + i * 19;
  try {
    const r = playFullMatch({
      seed,
      difficulty,
      playerCount: 3,
      playerIds: ["a", "b", "c"],
      targetScore: 50,
    });
    results.matches3p += 1;
    if (i % 10 === 0) {
      console.log(`  #${i} ${difficulty} rounds=${r.rounds} scores=${r.scores}`);
    }
  } catch (err) {
    results.failures.push({
      kind: "3p",
      seed,
      difficulty,
      message: String(err.message || err),
    });
    console.error(`FAIL 3p seed=${seed}:`, err.message || err);
  }
}

console.log("=== 4-player matches (40) ===");
for (let i = 0; i < 40; i += 1) {
  const difficulty = DIFFICULTY_ORDER[i % DIFFICULTY_ORDER.length];
  const seed = 30000 + i * 23;
  try {
    const r = playFullMatch({
      seed,
      difficulty,
      playerCount: 4,
      playerIds: ["a", "b", "c", "d"],
      targetScore: 50,
    });
    results.matches4p += 1;
    if (i % 10 === 0) {
      console.log(`  #${i} ${difficulty} rounds=${r.rounds} scores=${r.scores}`);
    }
  } catch (err) {
    results.failures.push({
      kind: "4p",
      seed,
      difficulty,
      message: String(err.message || err),
    });
    console.error(`FAIL 4p seed=${seed}:`, err.message || err);
  }
}

console.log("=== Save/load continuity (JSON snapshot round-trip) ===");
{
  let state = startMatch({ seed: 4242, playerIds: ["you", "rival"], targetScore: 100 });
  for (let i = 0; i < 12 && state.phase === PHASE.PLAYING; i += 1) {
    state = applyAiTurn(state, {
      difficulty: "medium",
      aiIndex: state.currentPlayer,
      seed: 4242 + i,
    });
  }
  const payload = {
    version: MATCH_SAVE_VERSION,
    savedAt: Date.now(),
    matchStartedAt: Date.now() - 1000,
    difficulty: "medium",
    selectedId: sanitizeSelectedId(state, state.players[0].hand[0] ?? null),
    state,
  };
  assert.equal(isValidSavedMatch(payload), true, "saved payload valid");
  const cloned = JSON.parse(JSON.stringify(payload));
  assert.equal(isValidSavedMatch(cloned), true, "cloned payload valid");
  let resumed = cloned.state;
  let guard = 0;
  while (resumed.phase === PHASE.PLAYING && guard < 300) {
    resumed = applyAiTurn(resumed, {
      difficulty: "medium",
      aiIndex: resumed.currentPlayer,
      seed: 9000 + guard,
    });
    guard += 1;
  }
  assert.ok(
    resumed.phase === PHASE.ROUND_OVER || resumed.phase === PHASE.MATCH_OVER,
    "resumed match continues to end"
  );
  console.log(`  resume OK after ${guard} plies → ${resumed.phase}`);
}

console.log("=== Full-board layout (near-complete chains, 3 viewports) ===");
{
  let state = startMatch({ seed: 9991, playerIds: ["a", "b"], targetScore: 500 });
  let guard = 0;
  while (state.phase === PHASE.PLAYING && guard < 400) {
    state = applyAiTurn(state, {
      difficulty: "hard",
      aiIndex: state.currentPlayer,
      seed: 9991 + guard,
    });
    guard += 1;
  }
  const boardLen = state.board.length;
  console.log(`  board length at round end: ${boardLen}`);

  const viewports = [
    { name: "phone", width: 360, height: 280 },
    { name: "tablet", width: 768, height: 420 },
    { name: "desktop", width: 1100, height: 520 },
  ];
  const size = { w: 40, h: 76 };
  const centerIndex = 0;

  for (const vp of viewports) {
    const { placements, tileScale } = layoutBoard(
      state.board,
      centerIndex,
      { width: vp.width, height: vp.height },
      size
    );
    assert.equal(placements.length, boardLen, `${vp.name} placement count`);

    // placements.w/h are already axis-aligned AABB sizes from the layout engine.
    const boxes = placements.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      rot: p.rotation ?? 0,
    }));

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y;
        assert.equal(overlap, false, `${vp.name} overlap ${a.id}/${b.id}`);
      }
    }

    for (const b of boxes) {
      assert.ok(b.x >= -0.5, `${vp.name} left clip ${b.id}`);
      assert.ok(b.y >= -0.5, `${vp.name} top clip ${b.id}`);
      assert.ok(b.x + b.w <= vp.width + 0.5, `${vp.name} right clip ${b.id}`);
      assert.ok(b.y + b.h <= vp.height + 0.5, `${vp.name} bottom clip ${b.id}`);
      assert.ok(b.rot === 0 || b.rot === 90, `${vp.name} rotation ${b.rot}`);
    }
    console.log(
      `  ${vp.name}: ${boxes.length} tiles, scale=${tileScale}, no overlap, in-bounds`
    );
  }
}

console.log("\n=== SUMMARY ===");
console.log(
  JSON.stringify(
    {
      matches2p: results.matches2p,
      matches3p: results.matches3p,
      matches4p: results.matches4p,
      byDifficulty: results.byDifficulty,
      failures: results.failures.length,
      failureDetails: results.failures.slice(0, 10),
    },
    null,
    2
  )
);

if (results.failures.length) {
  process.exitCode = 1;
} else {
  console.log("ALL QA MASS CHECKS PASSED");
}
