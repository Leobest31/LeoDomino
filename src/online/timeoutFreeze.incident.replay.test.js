/**
 * Fixture replay for timeout-freeze incidents (Haitian + Classic).
 * Uses frozen playing-state JSON only — does not touch hosted matches.
 * Run: node src/online/timeoutFreeze.incident.replay.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTimeoutResolution, getAvailableActions } from "./gameAuthority.js";
import {
  createMemoryGameStore,
  handleSweepDueTimeouts,
} from "./gameplayHandler.js";

const root = join(dirname(fileURLToPath(import.meta.url)));
const haitian = JSON.parse(
  readFileSync(join(root, "fixtures/timeoutFreeze.haitian.98bd12ce.json"), "utf8")
);
const classic = JSON.parse(
  readFileSync(join(root, "fixtures/timeoutFreeze.classic.6628833b.json"), "utf8")
);
const classicCass509 = JSON.parse(
  readFileSync(join(root, "fixtures/timeoutFreeze.classic.029da58a.json"), "utf8")
);

function hydrateFixture(fixture, { occupancySeats = 0, version = 42 } = {}) {
  const engine = structuredClone(fixture.engineState);
  const matchId = fixture.matchId;
  const playerA = engine.players[0].id;
  const playerB = engine.players[1].id;
  const store = createMemoryGameStore([
    {
      id: matchId,
      ruleset_id: fixture.rulesetId,
      player_a: playerA,
      player_b: playerB,
      status: "playing",
    },
  ]);
  store.sessions.set(matchId, {
    matchId,
    rulesetId: fixture.rulesetId,
    version,
    status: "playing",
    phase: "playing",
    currentSeat: fixture.currentSeat ?? engine.currentPlayer,
    turnDeadlineAt: new Date(Date.now() - 5_000).toISOString(),
    timeoutStrikes: (fixture.timeoutStrikes || [0, 0]).slice(),
    board: engine.board,
    scores: engine.scores,
    round: engine.round,
    handCounts: engine.players.map((p) => p.hand.length),
    reserveCount: Array.isArray(engine.reserve) ? engine.reserve.length : 0,
  });
  store.secrets.set(matchId, {
    matchId,
    engineState: engine,
    seed: 1,
  });
  return { store, matchId, occupancySeats, version, engine };
}

async function assertIncidentResolves(fixture, label) {
  const available = getAvailableActions(fixture.engineState);
  assert.equal(available.canPlay, true, `${label}: legal move must exist`);
  assert.ok(
    available.legalMoves.some((m) => m.tileId === "1-5"),
    `${label}: 1-5 must be legal`
  );
  assert.equal(fixture.engineState.currentPlayer, 1, `${label}: active seat jus`);
  assert.deepEqual(fixture.engineState.players[1].hand, ["1-5"]);
  assert.deepEqual(fixture.engineState.reserve, []);

  const preview = applyTimeoutResolution(fixture.engineState, {
    timeoutStrikes: fixture.timeoutStrikes || [0, 0],
  });
  assert.equal(preview.safePayload?.autoPlay?.tileId, "1-5", `${label}: autoplay picks 1-5`);
  assert.equal(preview.safePayload?.matchOver, true, `${label}: preview finishes match`);
  assert.equal(preview.state.phase, "matchOver");
  assert.equal(preview.state.matchWinner, 1);

  for (const occupancySeats of [2, 1, 0]) {
    const { store, matchId, version } = hydrateFixture(fixture, { occupancySeats });
    const swept = await handleSweepDueTimeouts({
      store,
      candidates: [
        {
          match_id: matchId,
          version,
          occupancy_seats: occupancySeats,
          turn_deadline_at: store.sessions.get(matchId).turnDeadlineAt,
        },
      ],
    });
    assert.equal(swept.results[0].status, "resolved", `${label} occ=${occupancySeats}`);
    assert.equal(swept.results[0].occupancySeats, occupancySeats);
    const timeout = store.actions.find((row) => row.actionType === "timeout");
    assert.ok(timeout, `${label}: timeout action committed`);
    assert.equal(timeout.payload?.autoPlay?.tileId, "1-5");
    assert.equal(store.matches.get(matchId).status, "finished", `${label}: match finishes`);
    assert.ok(
      (store.secrets.get(matchId).engineState.board || []).some((t) => t.id === "1-5"),
      `${label}: 1-5 on board`
    );
  }
  console.log(`  ✓ ${label} replay: autoplay 1-5 finishes (occ 2/1/0)`);
}

await assertIncidentResolves(haitian, "Haitian 98bd12ce");
await assertIncidentResolves(classic, "Classic 6628833b");

{
  const fixture = classicCass509;
  assert.equal(fixture.rulesetId, "legacy");
  assert.deepEqual(fixture.scores, [0, 85]);
  assert.deepEqual(fixture.timeoutStrikes, [1, 0]);
  assert.equal(fixture.engineState.phase, "playing");
  assert.equal(fixture.engineState.currentPlayer, 0);
  const available = getAvailableActions(fixture.engineState);
  assert.equal(available.canPlay, false);
  assert.equal(available.canDraw, false);
  assert.equal(available.canPass, true);
  const preview = applyTimeoutResolution(fixture.engineState, {
    timeoutStrikes: fixture.timeoutStrikes,
  });
  assert.equal(preview.safePayload?.autoPass, true);
  // Blocked (no legal play, no draw): the recorded incident's resolution
  // must not add a timeout strike.
  assert.equal(preview.safePayload?.strike, 0);
  assert.deepEqual(preview.timeoutStrikes, [1, 0]);

  for (const occupancySeats of [2, 1, 0]) {
    const { store, matchId, version } = hydrateFixture(fixture, {
      occupancySeats,
      version: fixture.version ?? 130,
    });
    const swept = await handleSweepDueTimeouts({
      store,
      candidates: [
        {
          match_id: matchId,
          version,
          occupancy_seats: occupancySeats,
          turn_deadline_at: store.sessions.get(matchId).turnDeadlineAt,
        },
      ],
    });
    assert.equal(swept.results[0].status, "resolved", `CASS509 occ=${occupancySeats}`);
    assert.equal(swept.results[0].casResult, "committed");
    const timeout = store.actions.find((row) => row.actionType === "timeout");
    assert.ok(timeout, "CASS509: timeout action committed");
    assert.equal(timeout.payload?.autoPass, true);
    assert.equal(timeout.payload?.strike, 0);
    assert.deepEqual(store.sessions.get(matchId).timeoutStrikes, [1, 0]);
  }
  console.log("  ✓ CASS509/LELAO 029da58a overdue pass resolves with no strike (occ 2/1/0)");
}

console.log("  ✓ timeout freeze incident replay fixtures");
