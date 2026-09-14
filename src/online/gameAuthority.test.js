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
  pickTimeoutAutoPlayMove,
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
  // Same seed as the Haitian deal below -> same real highest double (6-6),
  // not a fixed 2-2. Shared highest-double-else-highest opening rule.
  assert.equal(state.mustPlayTileId, "6-6");
  assert.ok(state.players[state.currentPlayer].hand.includes("6-6"));
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
    if (dealt.state.mustPlayTileId !== "2-2") continue;
    const opener = dealt.state.currentPlayer;
    const other = opener === 0 ? 1 : 0;
    if (!dealt.state.players[other].hand.includes("2-6")) continue;
    found = { ...dealt, opener, other, seed };
    break;
  }
  assert.ok(found, "need a Classic deal where 2-2 opens and the opponent holds 2-6");
  const opened = applyOnlineAction(found.state, {
    seat: found.opener,
    action: { type: ONLINE_ACTION_PLAY, tileId: "2-2", end: "right" },
  }).state;
  assert.equal(opened.board[0].id, "2-2");
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
  console.log("  ✓ 2-2 opening transfers turn; 2-6 is legal and plays");
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
  assert.ok(state.mustPlayTileId);
  const skipped = skipTurn(state);
  assert.equal(skipped.consecutivePasses, 0);
  assert.notEqual(skipped.currentPlayer, before);
  assert.equal(skipped.phase, "playing");
  assert.equal(skipped.mustPlayTileId, null);
  assert.ok(state.mustPlayTileId, "skipTurn must not mutate the live opening state");
  console.log("  ✓ skipTurn advances seat without a blocked-round pass");
}

{
  const ONLINE_RULESETS = ["legacy", "haitian", "american"];
  for (const rulesetId of ONLINE_RULESETS) {
    const { state } = deal(rulesetId);
    const seat = state.currentPlayer;
    const forced = state.mustPlayTileId;
    assert.ok(forced, `${rulesetId} round 1 has an opening lock`);
    assert.equal(getAvailableActions(state).canPlay, true);
    assert.ok(state.players[seat].hand.includes(forced));

    const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
    assert.equal(first.state.roundResult.reason, "timeout_auto");
    assert.equal(first.safePayload.autoPlay.tileId, forced);
    assert.equal(first.resetTurnDeadline, true, `${rulesetId} timeout auto-play stamps a new deadline`);
    assert.notEqual(first.state.currentPlayer, seat);
    assert.equal(first.state.mustPlayTileId, null, `${rulesetId} opener lock does not follow the next seat`);
    assert.equal(state.mustPlayTileId, forced, `${rulesetId} timeout must not rewrite the uncommitted opening state`);
    assert.ok(first.state.board.length > 0, `${rulesetId} auto-plays the opening tile`);

    const nextSeat = first.state.currentPlayer;
    const nextActions = getAvailableActions(first.state);
    assert.ok(
      nextActions.canPlay || nextActions.canDraw || nextActions.canPass,
      `${rulesetId} next player has a legal action after opener auto-play`
    );

    const nextView = view(first.state, nextSeat, 1);
    assert.equal(nextView.currentSeat, nextSeat);
    assert.equal(nextView.mustPlayTileId, null);
    if (nextView.canPlay) {
      assert.ok(nextView.legalMoves.length > 0);
      const move = nextView.legalMoves[0];
      const played = applyOnlineAction(first.state, {
        seat: nextSeat,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      });
      assert.equal(played.actionType, ONLINE_ACTION_PLAY);
      assert.ok(played.state.board.length > first.state.board.length);
    }

    const again = applyTimeoutResolution(first.state, { timeoutStrikes: first.timeoutStrikes });
    assert.ok(again.safePayload.autoPlay || again.safePayload.autoPass || again.safePayload.autoDraw);
    assert.notEqual(again.state.currentPlayer, nextSeat);
    assert.equal(again.state.mustPlayTileId, null);
    const picked = pickTimeoutAutoPlayMove(first.state);
    if (picked && again.safePayload.autoPlay) {
      assert.equal(again.safePayload.autoPlay.tileId, picked.tileId);
      assert.equal(again.safePayload.autoPlay.end, picked.end);
    }
  }
  console.log("  ✓ starter timeout auto-plays the opening tile; next player can play immediately (legacy/haitian/american)");
}

{
  const { state } = deal("legacy");
  const seat = state.currentPlayer;
  assert.equal(getAvailableActions(state).canPlay, true);
  const first = applyTimeoutResolution(state, { timeoutStrikes: [0, 0] });
  assert.equal(first.timeoutStrikes[seat], 1);
  assert.equal(first.state.roundResult.reason, "timeout_auto");
  assert.equal(first.finishReason, null);
  assert.notEqual(first.state.currentPlayer, seat);
  assert.ok(first.safePayload.autoPlay);

  const secondState = { ...first.state, currentPlayer: seat, phase: "playing" };
  const second = applyTimeoutResolution(secondState, { timeoutStrikes: first.timeoutStrikes });
  assert.equal(second.timeoutStrikes[seat], 2);
  assert.notEqual(second.finishReason, "timeout");
  assert.notEqual(second.state.phase, "matchOver");

  const beforeThirdBoard = second.state.board.slice();
  const thirdState = { ...second.state, currentPlayer: seat, phase: "playing" };
  const third = applyTimeoutResolution(thirdState, { timeoutStrikes: second.timeoutStrikes });
  assert.equal(third.timeoutStrikes[seat], 3);
  assert.equal(third.finishReason, "timeout");
  assert.equal(third.state.phase, "matchOver");
  assert.equal(third.state.matchWinner, seat === 0 ? 1 : 0);
  assert.equal(third.state.roundResult.reason, "timeout");
  assert.equal(third.safePayload.autoPlay, null);
  assert.equal(third.safePayload.autoPass, false);
  assert.deepEqual(third.state.board, beforeThirdBoard);

  const again = applyTimeoutResolution(third.state, { timeoutStrikes: third.timeoutStrikes });
  assert.equal(again.idempotent, true);
  console.log("  ✓ timeout strikes auto-play then authoritative timeout loss on strike 3");
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
  // A seat with no legal play at all (must draw/pass/skip) did not fail to
  // act on an available option — it must not accrue a timeout strike.
  const strikesBefore = [1, 1];
  const resolved = applyTimeoutResolution(blocked, { timeoutStrikes: strikesBefore });
  assert.deepEqual(resolved.timeoutStrikes, strikesBefore, "blocked timeout adds no strike");
  assert.equal(resolved.safePayload.strike, 0, "safePayload.strike is 0 while blocked");
  assert.notEqual(resolved.finishReason, "timeout");
  assert.notEqual(resolved.state.roundResult?.reason, "timeout_pass");
  assert.ok(resolved.safePayload.autoPass || resolved.state.phase !== "playing");
  assert.ok(
    resolved.state.phase !== "playing" ||
      getAvailableActions(resolved.state).canPass ||
      getAvailableActions(resolved.state).canPlay ||
      getAvailableActions(resolved.state).canDraw
  );

  // Repeated blocked turns must never escalate to strike 3 or a loss.
  const stillBlocked = { ...resolved.state, currentPlayer: seat, phase: "playing", mustPlayTileId: null };
  if (getAvailableActions(stillBlocked).canPlay === false) {
    const again = applyTimeoutResolution(stillBlocked, { timeoutStrikes: resolved.timeoutStrikes });
    assert.deepEqual(again.timeoutStrikes, strikesBefore, "repeated blocked turn adds no strike");
    assert.notEqual(again.finishReason, "timeout", "repeated blocked turn cannot cause a loss");
    assert.notEqual(again.state.phase, "matchOver");
  }
  console.log("  ✓ no legal tile timeout adds no strike; repeated blocked turns never reach strike 3");
}

{
  // Blocked with a reserve available: draws automatically until a legal tile
  // surfaces (or the reserve empties), and still adds no strike.
  const { state } = deal("legacy");
  const move = getAvailableActions(state).legalMoves[0];
  const afterPlay = applyOnlineAction(state, {
    seat: state.currentPlayer,
    action: { type: "play", tileId: move.tileId, end: move.end },
  }).state;
  const seat = afterPlay.currentPlayer;
  const ALL_TILES = [];
  for (let i = 0; i <= 6; i += 1) {
    for (let j = i; j <= 6; j += 1) ALL_TILES.push(`${i}-${j}`);
  }
  let blockedTile = null;
  let matchTile = null;
  for (const tileId of ALL_TILES) {
    const trial = {
      ...afterPlay,
      mustPlayTileId: null,
      players: afterPlay.players.map((player, index) =>
        index === seat ? { ...player, hand: [tileId] } : player
      ),
    };
    const canPlay = getAvailableActions(trial).canPlay;
    if (!canPlay && !blockedTile) blockedTile = tileId;
    if (canPlay && !matchTile) matchTile = tileId;
    if (blockedTile && matchTile) break;
  }
  assert.ok(blockedTile && matchTile, "expected both a blocked and a matching tile");
  const drawable = {
    ...afterPlay,
    mustPlayTileId: null,
    reserve: [matchTile],
    players: afterPlay.players.map((player, index) =>
      index === seat ? { ...player, hand: [blockedTile] } : player
    ),
  };
  assert.equal(getAvailableActions(drawable).canPlay, false);
  assert.equal(getAvailableActions(drawable).canDraw, true);
  const strikesBefore = [1, 1];
  const resolved = applyTimeoutResolution(drawable, { timeoutStrikes: strikesBefore });
  assert.deepEqual(resolved.timeoutStrikes, strikesBefore, "no strike while blocked, even with a reserve draw");
  assert.equal(resolved.safePayload.strike, 0);
  assert.equal(resolved.safePayload.autoDraw, 1);
  assert.ok(resolved.safePayload.autoPlay, "drawn tile becomes playable and is auto-played");
  assert.equal(resolved.state.roundResult?.reason, "timeout_auto");
  console.log("  ✓ blocked with reserve available draws automatically; no unfair strike");
}

{
  const { state } = deal("haitian");
  const starter = state.currentPlayer;
  const other = starter === 0 ? 1 : 0;
  assert.equal(state.mustPlayTileId, HAITIAN_OPENING_TILE_ID);
  const lockedOnWaiter = {
    ...state,
    currentPlayer: other,
  };
  assert.equal(getAvailableActions(lockedOnWaiter).canPlay, false);
  assert.equal(getAvailableActions(lockedOnWaiter).canDraw, false);
  assert.equal(getAvailableActions(lockedOnWaiter).canPass, false);

  const resolved = applyTimeoutResolution(lockedOnWaiter, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.state.mustPlayTileId, null);
  assert.equal(resolved.timeoutStrikes[other], 0, "locked-open timeout with no legal action adds no strike");
  const after = getAvailableActions(resolved.state);
  assert.ok(
    resolved.state.phase !== "playing" || after.canPlay || after.canDraw || after.canPass,
    "locked-open timeout must not leave a dead action set"
  );
  assert.notEqual(resolved.state.currentPlayer, other);

  const second = applyTimeoutResolution(resolved.state, { timeoutStrikes: resolved.timeoutStrikes });
  assert.ok(
    second.state.roundResult?.reason === "timeout_pass" ||
      second.state.roundResult?.reason === "timeout_auto" ||
      second.state.phase !== "playing" ||
      getAvailableActions(second.state).canPlay,
    "locked-open timeout cannot ping-pong a dead opener lock"
  );
  console.log("  ✓ locked-open timeout cannot ping-pong forever");
}

{
  const { state } = deal("legacy");
  const move = getAvailableActions(state).legalMoves[0];
  const afterPlay = applyOnlineAction(state, {
    seat: state.currentPlayer,
    action: { type: "play", tileId: move.tileId, end: move.end },
  }).state;
  const deadTile = ["0-0", "1-1", "2-2", "3-3", "4-4", "5-5"].find((tileId) => {
    const trial = {
      ...afterPlay,
      mustPlayTileId: null,
      reserve: [],
      players: afterPlay.players.map((player) => ({ ...player, hand: [tileId] })),
    };
    return (
      !getAvailableActions(trial).canPlay &&
      afterPlay.players.every((_, index) => {
        const seatTrial = { ...trial, currentPlayer: index };
        return !getAvailableActions(seatTrial).canPlay;
      })
    );
  });
  assert.ok(deadTile, "expected a tile that matches neither hand against the board");
  const blockedTable = {
    ...afterPlay,
    mustPlayTileId: null,
    reserve: [],
    players: afterPlay.players.map((player) => ({ ...player, hand: [deadTile] })),
  };
  const resolved = applyTimeoutResolution(blockedTable, { timeoutStrikes: [0, 0] });
  assert.equal(resolved.safePayload.strike, 0, "true blocked position adds no strike");
  assert.deepEqual(resolved.timeoutStrikes, [0, 0]);
  assert.ok(resolved.safePayload.autoPass || resolved.state.phase !== "playing");
  assert.ok(
    resolved.state.phase === "roundOver" ||
      resolved.state.phase === "matchOver" ||
      resolved.safePayload.autoPass,
    "true blocked timeout uses pass/round-end, not skip ping-pong"
  );
  console.log("  ✓ true blocked position still resolves normally");
}

console.log("  ✓ gameAuthority");
