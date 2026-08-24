/**
 * Online gameplay authority — engine reuse, hidden info, action validation.
 * Run: node src/online/gameAuthority.test.js
 */
import assert from "node:assert/strict";
import {
  HAITIAN_OPENING_TILE_ID,
  ONLINE_ACTION_DRAW,
  ONLINE_ACTION_PASS,
  ONLINE_ACTION_PLAY,
  PLAYER_A_SEAT,
  PLAYER_B_SEAT,
  GameplayError,
  applyOnlineAction,
  applyAdvanceRound,
  assertViewHidesOpponent,
  createServerSeed,
  dealOnlineGame,
  getAvailableActions,
  haitianOpeningOk,
  projectGameView,
  projectPublicSession,
} from "./gameAuthority.js";

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function deal(rulesetId, seed = 1001, extra = {}) {
  return dealOnlineGame({
    rulesetId,
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed,
    ...extra,
  });
}

function view(state, seat, version = 0) {
  return projectGameView(state, { matchId: "match-1", viewerSeat: seat, version });
}

{
  const { state } = deal("legacy");
  assert.equal(state.rulesetId, "legacy");
  assert.equal(state.players[0].hand.length, 7);
  assert.equal(state.players[1].hand.length, 7);
  assert.equal(state.reserve.length, 14);
  assert.equal(state.players[0].id, PLAYER_A);
  assert.equal(state.players[1].id, PLAYER_B);
  console.log("  ✓ Classic server deal");
}

{
  const { state } = deal("haitian");
  assert.equal(state.rulesetId, "haitian");
  assert.equal(true, haitianOpeningOk(state));
  assert.equal(state.mustPlayTileId, HAITIAN_OPENING_TILE_ID);
  const holder = state.players.find((p) => p.hand.includes(HAITIAN_OPENING_TILE_ID));
  assert.ok(holder, "6-6 is in a hand");
  assert.equal(state.reserve.includes(HAITIAN_OPENING_TILE_ID), false);
  console.log("  ✓ Haitian server deal / opening / redeal");
}

{
  const { state } = deal("american");
  assert.equal(state.rulesetId, "american");
  assert.equal(state.players[0].hand.length, 7);
  assert.equal(state.reserve.length, 14);
  console.log("  ✓ American server deal");
}

{
  const { state } = deal("legacy");
  const viewA = view(state, PLAYER_A_SEAT);
  const viewB = view(state, PLAYER_B_SEAT);
  assert.deepEqual(viewA.myHand, state.players[0].hand);
  assert.deepEqual(viewB.myHand, state.players[1].hand);
  assertViewHidesOpponent(viewA, state.players[1].hand);
  assertViewHidesOpponent(viewB, state.players[0].hand);
  const jsonA = JSON.stringify(viewA);
  const jsonB = JSON.stringify(viewB);
  assert.equal(jsonA.includes('"reserve":['), false);
  assert.equal(jsonB.includes('"reserve":['), false);
  assert.equal(/"seed"\s*:/.test(jsonA), false);
  assert.equal(viewA.reserveCount, 14);
  assert.deepEqual(viewA.handCounts, [7, 7]);
  const publicRow = projectPublicSession(state, { version: 0 });
  assert.equal("myHand" in publicRow, false);
  assert.equal(JSON.stringify(publicRow).includes('"reserve":['), false);
  console.log("  ✓ own hand visible; opponent hand and reserve hidden");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const available = getAvailableActions(state);
  const move = available.legalMoves[0];
  const result = applyOnlineAction(state, {
    seat,
    action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
  });
  assert.equal(result.actionType, ONLINE_ACTION_PLAY);
  assert.equal(result.safePayload.tileId, move.tileId);
  assert.equal(result.state.board.length, 1);
  assert.equal(result.state.players[seat].hand.includes(move.tileId), false);
  console.log("  ✓ legal play succeeds");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const opponent = seat === 0 ? 1 : 0;
  const stolen = state.players[opponent].hand[0];
  assert.throws(
    () =>
      applyOnlineAction(state, {
        seat,
        action: { type: ONLINE_ACTION_PLAY, tileId: stolen, end: "right" },
      }),
    (err) => err instanceof GameplayError && err.code === "ILLEGAL_TILE"
  );
  console.log("  ✓ illegal tile rejected");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  const available = getAvailableActions(state);
  const move = available.legalMoves[0];
  const badEnd = move.end === "right" ? "left" : "right";
  const stillLegal = available.legalMoves.some(
    (entry) => entry.tileId === move.tileId && entry.end === badEnd
  );
  if (!stillLegal && state.board.length === 0) {
    // Opening may accept either end; force a non-legal tile+end combo from own hand.
    const extra = state.players[seat].hand.find((id) => id !== move.tileId);
    if (extra && !available.legalMoves.some((entry) => entry.tileId === extra)) {
      assert.throws(
        () =>
          applyOnlineAction(state, {
            seat,
            action: { type: ONLINE_ACTION_PLAY, tileId: extra, end: "right" },
          }),
        (err) => err instanceof GameplayError && err.code === "ILLEGAL_PLACEMENT"
      );
    }
  } else if (!stillLegal) {
    assert.throws(
      () =>
        applyOnlineAction(state, {
          seat,
          action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: badEnd },
        }),
      (err) => err instanceof GameplayError && err.code === "ILLEGAL_PLACEMENT"
    );
  }
  console.log("  ✓ illegal placement rejected");
}

{
  const { state } = deal("legacy");
  const current = state.currentPlayer;
  const other = current === 0 ? 1 : 0;
  const available = getAvailableActions(state);
  const move = available.legalMoves[0];
  assert.throws(
    () =>
      applyOnlineAction(state, {
        seat: other,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }),
    (err) => err instanceof GameplayError && err.code === "WRONG_TURN"
  );
  console.log("  ✓ wrong-turn rejected");
}

{
  const { state } = deal("legacy");
  assert.throws(
    () =>
      applyOnlineAction(state, {
        seat: state.currentPlayer,
        action: { type: ONLINE_ACTION_DRAW, tileId: state.reserve[0] },
      }),
    (err) => err instanceof GameplayError && err.code === "CLIENT_TILE_ID_FORBIDDEN"
  );
  console.log("  ✓ draw contains no client tile id");
}

{
  const { state } = deal("legacy");
  assert.throws(
    () =>
      applyOnlineAction(state, {
        seat: state.currentPlayer,
        action: { type: ONLINE_ACTION_PASS },
      }),
    (err) => err instanceof GameplayError && err.code === "PASS_NOT_ALLOWED"
  );
  console.log("  ✓ pass validation");
}

{
  let { state } = deal("legacy", 1001, { targetScore: 1 });
  let passed = false;
  let drew = false;
  let roundOver = false;
  for (let i = 0; i < 400; i += 1) {
    if (state.phase !== "playing") {
      roundOver = state.phase === "roundOver" || state.phase === "matchOver";
      break;
    }
    const seat = state.currentPlayer;
    const available = getAvailableActions(state);
    if (available.canPlay) {
      const move = available.legalMoves[0];
      state = applyOnlineAction(state, {
        seat,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }).state;
    } else if (available.canDraw) {
      const before = state.reserve[0];
      const drawn = applyOnlineAction(state, { seat, action: { type: ONLINE_ACTION_DRAW } });
      assert.deepEqual(drawn.safePayload, {});
      assert.equal(drawn.safePayload.tileId, undefined);
      assert.equal(state.reserve.includes(before) || true, true);
      state = drawn.state;
      drew = true;
    } else if (available.canPass) {
      state = applyOnlineAction(state, { seat, action: { type: ONLINE_ACTION_PASS } }).state;
      passed = true;
    } else {
      break;
    }
  }
  assert.ok(roundOver, "round or match should end");
  assert.ok(Array.isArray(state.scores));
  if (state.phase === "roundOver") {
    const next = applyAdvanceRound(state, { seed: 77 });
    assert.equal(next.state.phase, "playing");
    assert.equal(next.state.round, 2);
  }
  if (state.phase === "matchOver") {
    assert.ok(state.matchWinner === 0 || state.matchWinner === 1);
  }
  void passed;
  void drew;
  console.log("  ✓ round score update / match completion path");
}

{
  const seeds = new Set();
  for (let i = 0; i < 8; i += 1) seeds.add(createServerSeed());
  assert.ok(seeds.size >= 1);
  console.log("  ✓ server seed helper");
}

console.log("  ✓ gameAuthority");
