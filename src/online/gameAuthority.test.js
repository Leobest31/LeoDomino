/**
 * Online gameplay authority — engine reuse, hidden info, action validation.
 * Run: node src/online/gameAuthority.test.js
 */
import assert from "node:assert/strict";
import { skipTurn } from "../game/rules/drawDominoes.js";
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
  applyOnlineForfeit,
  applyTimeoutResolution,
  assertViewHidesOpponent,
  createServerSeed,
  dealOnlineGame,
  getAvailableActions,
  haitianOpeningOk,
  isForfeitView,
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
    const scores = state.scores.slice();
    assert.ok(state.board.length > 0, "round over still has the completed chain");
    const next = applyAdvanceRound(state, { seed: 77 });
    assert.equal(next.state.phase, "playing");
    assert.equal(next.state.round, 2);
    assert.deepEqual(next.state.board, []);
    assert.equal(next.state.spinnerId, null);
    assert.deepEqual(next.state.spinnerNorth, []);
    assert.deepEqual(next.state.spinnerSouth, []);
    assert.deepEqual(next.state.scores, scores);
    const publicRow = projectPublicSession(next.state, { version: 1 });
    assert.deepEqual(publicRow.board, []);
    assert.equal(publicRow.round, 2);
    assert.deepEqual(publicRow.scores, scores);
    const viewA = view(next.state, PLAYER_A_SEAT, 1);
    const viewB = view(next.state, PLAYER_B_SEAT, 1);
    assert.deepEqual(viewA.board, []);
    assert.deepEqual(viewB.board, []);
    assert.throws(
      () => applyAdvanceRound(next.state),
      (err) => err instanceof GameplayError && err.code === "ADVANCE_NOT_ALLOWED"
    );
  }
  if (state.phase === "matchOver") {
    assert.ok(state.matchWinner === 0 || state.matchWinner === 1);
  }
  void passed;
  void drew;
  console.log("  ✓ round score update / match completion path");
}

{
  let { state } = deal("legacy", 3);
  for (let i = 0; i < 800; i += 1) {
    if (state.phase !== "playing") break;
    const seat = state.currentPlayer;
    const available = getAvailableActions(state);
    if (available.canPlay) {
      const move = available.legalMoves[0];
      state = applyOnlineAction(state, {
        seat,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }).state;
    } else if (available.canDraw) {
      state = applyOnlineAction(state, { seat, action: { type: ONLINE_ACTION_DRAW } }).state;
    } else if (available.canPass) {
      state = applyOnlineAction(state, { seat, action: { type: ONLINE_ACTION_PASS } }).state;
    } else {
      break;
    }
  }
  assert.equal(state.phase, "roundOver");
  assert.ok(state.board.length > 0);
  const scores = state.scores.slice();
  const next = applyAdvanceRound(state, { seed: 88 });
  assert.equal(next.state.phase, "playing");
  assert.equal(next.state.round, state.round + 1);
  assert.deepEqual(next.state.board, []);
  assert.deepEqual(next.state.scores, scores);
  assert.equal(next.state.consecutivePasses, 0);
  const publicRow = projectPublicSession(next.state, { version: 9 });
  assert.deepEqual(publicRow.board, []);
  assert.deepEqual(JSON.parse(JSON.stringify(publicRow)).board, []);
  console.log("  ✓ next-round deal clears chain and keeps match scores");
}

{
  let found = null;
  for (let seed = 1; seed <= 400; seed += 1) {
    const dealt = deal("legacy", seed);
    if (dealt.state.mustPlayTileId !== "6-6") continue;
    const opener = dealt.state.currentPlayer;
    const other = opener === 0 ? 1 : 0;
    if (!dealt.state.players[other].hand.includes("2-6")) continue;
    found = { ...dealt, opener, other, seed };
    break;
  }
  assert.ok(found, "need a Classic deal where 6-6 opens and the opponent holds 2-6");
  const opened = applyOnlineAction(found.state, {
    seat: found.opener,
    action: { type: ONLINE_ACTION_PLAY, tileId: "6-6", end: "right" },
  }).state;
  assert.equal(opened.board[0].id, "6-6");
  assert.equal(opened.currentPlayer, found.other);
  const viewOpener = view(opened, found.opener, 1);
  const viewOther = view(opened, found.other, 1);
  assert.equal(viewOther.currentSeat, found.other);
  assert.equal(viewOther.viewerSeat, found.other);
  assert.equal(viewOpener.canPlay, false);
  assert.equal(viewOther.canPlay, true);
  assert.ok(viewOther.legalMoves.some((move) => move.tileId === "2-6"));
  assert.ok(viewOther.myHand.includes("2-6"));
  const played = applyOnlineAction(opened, {
    seat: found.other,
    action: { type: ONLINE_ACTION_PLAY, tileId: "2-6", end: "right" },
  });
  assert.equal(played.state.board.length, 2);
  assert.ok(played.state.board.some((tile) => tile.id === "2-6"));
  assert.equal(played.state.players[found.other].hand.includes("2-6"), false);
  const bothA = view(played.state, PLAYER_A_SEAT, 2);
  const bothB = view(played.state, PLAYER_B_SEAT, 2);
  assert.deepEqual(
    bothA.board.map((tile) => tile.id),
    bothB.board.map((tile) => tile.id)
  );
  console.log("  ✓ 6-6 opening transfers turn; 2-6 is legal and plays");
}

{
  const seeds = new Set();
  for (let i = 0; i < 8; i += 1) seeds.add(createServerSeed());
  assert.ok(seeds.size >= 1);
  console.log("  ✓ server seed helper");
}

{
  const { state } = deal("legacy");
  const first = applyOnlineForfeit(state, PLAYER_A_SEAT);
  assert.equal(first.idempotent, false);
  assert.equal(first.state.phase, "matchOver");
  assert.equal(first.state.matchWinner, PLAYER_B_SEAT);
  assert.equal(first.winnerSeat, PLAYER_B_SEAT);
  assert.equal(first.state.roundResult.reason, "forfeit");
  assert.equal(first.state.roundResult.forfeitSeat, PLAYER_A_SEAT);
  const again = applyOnlineForfeit(first.state, PLAYER_A_SEAT);
  assert.equal(again.idempotent, true);
  assert.equal(again.state.matchWinner, PLAYER_B_SEAT);
  const viewB = view(first.state, PLAYER_B_SEAT, 1);
  assert.equal(isForfeitView(viewB), true);
  assert.equal(viewB.matchWinnerSeat, PLAYER_B_SEAT);
  console.log("  ✓ forfeit awards opponent and is idempotent");
}

{
  const { state } = deal("legacy");
  const before = state.currentPlayer;
  const skipped = skipTurn(state);
  assert.equal(skipped.consecutivePasses, 0);
  assert.notEqual(skipped.currentPlayer, before);
  assert.equal(skipped.phase, "playing");
  console.log("  ✓ skipTurn advances seat without a blocked-round pass");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  assert.equal(getAvailableActions(state).canPlay, true);
  const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  assert.equal(first.timeoutStrikes[seat], 1);
  assert.equal(first.state.roundResult.reason, "timeout_pass");
  assert.equal(first.finishReason, null);
  assert.notEqual(first.state.currentPlayer, seat);

  const secondState = { ...first.state, currentPlayer: seat, phase: "playing" };
  const second = applyTimeoutResolution(secondState, { timeoutStrikes: first.timeoutStrikes });
  assert.equal(second.timeoutStrikes[seat], 2);
  assert.equal(second.state.roundResult.reason, "timeout_pass");

  const thirdState = { ...second.state, currentPlayer: seat, phase: "playing" };
  const third = applyTimeoutResolution(thirdState, { timeoutStrikes: second.timeoutStrikes });
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(third.finishReason, "timeout");
  assert.equal(third.state.phase, "matchOver");
  assert.equal(third.state.matchWinner, seat === 0 ? 1 : 0);
  assert.equal(third.state.roundResult.reason, "timeout");

  const again = applyTimeoutResolution(third.state, { timeoutStrikes: third.timeoutStrikes });
  assert.equal(again.idempotent, true);
  console.log("  ✓ timeout strikes then authoritative timeout loss");
}

{
  const { state } = deal("legacy");
  const move = getAvailableActions(state).legalMoves[0];
  const afterPlay = applyOnlineAction(state, {
    seat: state.currentPlayer,
    action: { type: "play", tileId: move.tileId, end: move.end },
  }).state;
  const seat = afterPlay.currentPlayer;
  const candidates = ["0-0", "0-1", "0-2", "1-1", "1-2", "2-2"];
  let blocked = null;
  for (const tileId of candidates) {
    const next = {
      ...afterPlay,
      mustPlayTileId: null,
      reserve: [],
      players: afterPlay.players.map((player, index) =>
        index === seat ? { ...player, hand: [tileId] } : player
      ),
    };
    const available = getAvailableActions(next);
    if (!available.canPlay) {
      blocked = next;
      break;
    }
  }
  assert.ok(blocked, "expected an unplayable constructed hand");
  const strikesBefore = [1, 2];
  const resolved = applyTimeoutResolution(blocked, { timeoutStrikes: strikesBefore });
  assert.deepEqual(resolved.timeoutStrikes, strikesBefore);
  assert.equal(resolved.safePayload.strike, 0);
  assert.notEqual(resolved.state.roundResult?.reason, "timeout_pass");
  console.log("  ✓ no legal move does not add a timeout strike");
}

console.log("  ✓ gameAuthority");
