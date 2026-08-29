/**
 * Pure online-table helpers — no network.
 * Run: node src/online/onlineTable.test.js
 */
import { destinationTileId } from "../game/destinationTarget.js";
import { END } from "../game/constants.js";
import { isAutoPlaceable, legalEndsForTile } from "../game/interaction.js";
import assert from "node:assert/strict";
import {
  assertNeverClassicRuleset,
  applyForfeitTerminalFields,
  asViewerSnapshot,
  occupancyTouchMissed,
  boardTilesFromView,
  canEnterAcceptedMatch,
  clearOnlineSession,
  equivalentPlayEnd,
  handTilesFromView,
  hasCoherentInteraction,
  INTERACTION_SOURCE_PUBLIC,
  INTERACTION_SOURCE_VIEWER,
  isInteractableTurn,
  isMatchOverView,
  isRealtimeSessionEvent,
  isRoundOverView,
  keepAuthoritativeView,
  legalMovesForPublicView,
  lockedRulesetId,
  mergeRealtimeSessionView,
  onlineDragGate,
  opponentHandCount,
  opaqueReserveIds,
  optimisticPlayPreview,
  persistOnlineSession,
  readOnlineSession,
  reconcileViewerHand,
  roundIdentityFromView,
  sanitizeGameView,
  sealRoundTable,
  shouldFlushPendingView,
  shouldRefreshViewerAfterRealtime,
  shouldReleaseBusy,
  tableEpochFromView,
  viewerHandMatchesCounts,
  draggableTileIds,
  isViewerTurn,
} from "./onlineTable.js";
import {
  HAITIAN_OPENING_TILE_ID,
  GameplayError,
  dealOnlineGame,
  projectGameView,
  projectPublicSession,
  applyOnlineAction,
  applyAdvanceRound,
  getAvailableActions,
  ONLINE_ACTION_PLAY,
  ONLINE_ACTION_DRAW,
  ONLINE_ACTION_PASS,
} from "./gameAuthority.js";
import { networkCallsForMove } from "./onlineMoveTrace.js";

assert.equal(lockedRulesetId("legacy"), "legacy");
assert.equal(lockedRulesetId("haitian"), "haitian");
assert.equal(lockedRulesetId("american"), "american");
assert.equal(lockedRulesetId("classic"), null, "Classic is never a stored ruleset id");
assert.throws(() => assertNeverClassicRuleset("classic"));

const store = new Map();
const memory = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

persistOnlineSession({ matchId: "match-1", rulesetId: "classic" }, memory);
assert.deepEqual(readOnlineSession(memory), { matchId: "match-1", rulesetId: null });
persistOnlineSession({ matchId: "match-1", rulesetId: "legacy" }, memory);
assert.deepEqual(readOnlineSession(memory), { matchId: "match-1", rulesetId: "legacy" });
clearOnlineSession(memory);
assert.equal(readOnlineSession(memory), null);

const dirty = {
  matchId: "match-1",
  rulesetId: "haitian",
  version: 3,
  viewerSeat: 0,
  myHand: ["6-6", "0-1"],
  board: [{ id: "5-5", left: 5, right: 5, orientation: "vertical" }],
  scores: [1, 0],
  handCounts: [6, 7],
  reserveCount: 14,
  seed: 99,
  dealSeed: 99,
  engineState: { players: [{ hand: ["1-2"] }, { hand: ["3-4"] }] },
  reserve: ["2-3", "4-4"],
  opponentHand: ["3-4"],
  players: [{ hand: ["6-6"] }],
  legalMoves: [{ tileId: "6-6", end: "right" }],
};
const clean = sanitizeGameView(dirty);
assert.equal(clean.rulesetId, "haitian");
assert.equal(clean.styleId, "haitian");
assert.deepEqual(clean.myHand, ["6-6", "0-1"]);
assert.equal("seed" in clean, false);
assert.equal("engineState" in clean, false);
assert.equal("reserve" in clean, false);
assert.equal("opponentHand" in clean, false);
assert.equal("players" in clean, false);
assert.equal(clean.reserveCount, 14);

const previous = sanitizeGameView({
  matchId: "match-1",
  rulesetId: "legacy",
  version: 2,
  myHand: ["0-0"],
  board: [],
  scores: [0, 0],
  handCounts: [7, 7],
  legalMoves: [],
});
assert.equal(keepAuthoritativeView(previous, null), previous);
assert.equal(keepAuthoritativeView(previous, {}).matchId, previous.matchId);
const next = keepAuthoritativeView(previous, {
  matchId: "match-1",
  rulesetId: "legacy",
  version: 3,
  myHand: ["0-0"],
  board: [],
  scores: [0, 0],
  handCounts: [6, 7],
  legalMoves: [],
});
assert.equal(next.version, 3);
assert.equal(next.handCounts[0], 6);

{
  const roundOver = sanitizeGameView({
    matchId: "match-1",
    rulesetId: "legacy",
    version: 12,
    phase: "roundOver",
    round: 1,
    myHand: ["0-0"],
    board: [{ id: "5-5", left: 5, right: 5 }],
    scores: [10, 4],
    handCounts: [0, 3],
    legalMoves: [],
  });
  const started = sanitizeGameView({
    matchId: "match-1",
    rulesetId: "legacy",
    version: 13,
    phase: "playing",
    round: 2,
    myHand: ["1-1", "2-2"],
    board: [],
    spinner: { id: null, north: [], south: [] },
    scores: [10, 4],
    handCounts: [7, 7],
    legalMoves: [],
  });
  const applied = keepAuthoritativeView(roundOver, started);
  assert.equal(applied.phase, "playing");
  assert.equal(applied.round, 2);
  assert.deepEqual(applied.board, []);
  assert.deepEqual(applied.scores, [10, 4]);
  const stale = keepAuthoritativeView(applied, roundOver);
  assert.equal(stale, applied);
  assert.deepEqual(stale.board, []);
  assert.notEqual(tableEpochFromView(roundOver), tableEpochFromView(applied));
  assert.equal(
    roundIdentityFromView(roundOver),
    roundIdentityFromView({ matchId: "match-1", round: 1, phase: "playing" })
  );
  assert.equal(roundIdentityFromView(applied), "match-1:2");
  assert.equal(tableEpochFromView(applied), roundIdentityFromView(applied));
}

assert.equal(boardTilesFromView({ board: [] }).length, 0);

const faces = handTilesFromView({ myHand: ["6-6", "2-5"] });
assert.deepEqual(faces[0], { id: "6-6", left: 6, right: 6 });
assert.equal(boardTilesFromView({ board: [{ id: "5-5", left: 5, right: 5 }] })[0].id, "5-5");

const opaque = opaqueReserveIds(3);
assert.deepEqual(opaque, ["online-reserve-0", "online-reserve-1", "online-reserve-2"]);
assert.equal(opaque.some((id) => /^\d-\d$/.test(id)), false, "reserve placeholders are not tile ids");

assert.equal(
  canEnterAcceptedMatch(
    { id: "m1", host: { playerId: "a" }, opponent: { playerId: "b" } },
    "a"
  ),
  true
);
assert.equal(
  canEnterAcceptedMatch(
    { id: "m1", host: { playerId: "a" }, opponent: { playerId: "b" } },
    "c"
  ),
  false
);

assert.equal(isRealtimeSessionEvent({ table: "game_sessions" }), true);
assert.equal(isRealtimeSessionEvent({ table: "game_secrets" }), false);

{
  const opening = { board: [{ id: "4-4", left: 4, right: 4, orientation: "vertical" }] };
  assert.equal(destinationTileId("left", opening), "4-4");
  assert.equal(destinationTileId("right", opening), "4-4");
  const againstFour = [
    { tileId: "0-4", end: END.LEFT },
    { tileId: "0-4", end: END.RIGHT },
  ];
  assert.deepEqual(legalEndsForTile(againstFour, "0-4"), [END.LEFT, END.RIGHT]);
  assert.equal(isAutoPlaceable(againstFour, "0-4"), false);
}

{
  const openingSix = {
    board: [{ id: "6-6", left: 6, right: 6, orientation: "vertical" }],
  };
  const twoSixMoves = [
    { tileId: "2-6", end: END.LEFT },
    { tileId: "2-6", end: END.RIGHT },
  ];
  assert.equal(isAutoPlaceable(twoSixMoves, "2-6"), false);
  assert.deepEqual(legalEndsForTile(twoSixMoves, "2-6"), [END.LEFT, END.RIGHT]);
  assert.equal(equivalentPlayEnd(twoSixMoves, "2-6", openingSix), END.RIGHT);
  assert.equal(destinationTileId(END.LEFT, openingSix), destinationTileId(END.RIGHT, openingSix));
}

{
  const same = keepAuthoritativeView(next, {
    matchId: "match-1",
    rulesetId: "legacy",
    version: 3,
    myHand: ["0-0"],
    board: [],
    scores: [0, 0],
    handCounts: [6, 7],
    legalMoves: [],
  });
  assert.equal(same, next);
}

const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function realtimeRow(state, version) {
  const pub = projectPublicSession(state, { version });
  return {
    table: "game_sessions",
    new: {
      version: pub.version,
      current_seat: pub.currentSeat,
      phase: pub.phase,
      status: pub.status,
      round: pub.round,
      board: pub.board,
      spinner: pub.spinner,
      hand_counts: pub.handCounts,
      reserve_count: pub.reserveCount,
      scores: pub.scores,
      round_result: pub.roundResult,
      match_winner_seat: pub.matchWinnerSeat,
    },
  };
}

function viewerOf(state, seat, version, matchId = "match-1") {
  return asViewerSnapshot(
    projectGameView(state, { matchId, viewerSeat: seat, version })
  );
}

function applyRealtimeThenViewer(previous, state, version, seat) {
  const merged = mergeRealtimeSessionView(previous, realtimeRow(state, version));
  return keepAuthoritativeView(merged, viewerOf(state, seat, version, previous.matchId));
}

function playOnce(state) {
  const available = getAvailableActions(state);
  const move = available.legalMoves[0];
  assert.ok(move, "expected a legal play");
  return {
    state: applyOnlineAction(state, {
      seat: state.currentPlayer,
      action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
    }).state,
    move,
  };
}

function driveUntil(state, predicate, limit = 800) {
  let current = state;
  for (let i = 0; i < limit; i += 1) {
    if (predicate(current)) return current;
    if (current.phase !== "playing") return current;
    const available = getAvailableActions(current);
    if (available.canPlay) {
      const move = available.legalMoves[0];
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
      }).state;
    } else if (available.canDraw) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_DRAW },
      }).state;
    } else if (available.canPass) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_PASS },
      }).state;
    } else {
      return current;
    }
  }
  return current;
}

function findDrawState(rulesetId) {
  for (let seed = 1; seed <= 400; seed += 1) {
    let current = dealOnlineGame({
      rulesetId,
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
      seed,
    }).state;
    for (let i = 0; i < 250; i += 1) {
      if (current.phase !== "playing") break;
      const available = getAvailableActions(current);
      if (!available.canPlay && available.canDraw && current.reserve.length > 0) {
        return current;
      }
      if (available.canPlay) {
        const move = available.legalMoves[0];
        current = applyOnlineAction(current, {
          seat: current.currentPlayer,
          action: { type: ONLINE_ACTION_PLAY, tileId: move.tileId, end: move.end },
        }).state;
      } else if (available.canDraw) {
        current = applyOnlineAction(current, {
          seat: current.currentPlayer,
          action: { type: ONLINE_ACTION_DRAW },
        }).state;
      } else if (available.canPass) {
        current = applyOnlineAction(current, {
          seat: current.currentPlayer,
          action: { type: ONLINE_ACTION_PASS },
        }).state;
      } else {
        break;
      }
    }
  }
  return null;
}

{
  assert.equal(
    isViewerTurn({ viewerSeat: "0", currentSeat: "0", phase: "playing" }),
    true
  );
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const waiter = actor === 0 ? 1 : 0;
  const waiting = viewerOf(state, waiter, 0);
  const { state: after, move } = playOnce(state);
  const merged = mergeRealtimeSessionView(waiting, realtimeRow(after, 1));
  assert.equal(merged.version, 1);
  assert.equal(merged.currentSeat, waiter);
  assert.equal(merged.interactionSource, INTERACTION_SOURCE_PUBLIC);
  assert.deepEqual(merged.legalMoves, []);
  assert.equal(merged.canPlay, false);
  assert.equal(merged.canDraw, false);
  assert.equal(merged.canPass, false);
  assert.equal(isInteractableTurn(merged), false);
  assert.equal(hasCoherentInteraction(merged), false);
  const recovered = keepAuthoritativeView(merged, viewerOf(after, waiter, 1));
  assert.equal(recovered.interactionSource, INTERACTION_SOURCE_VIEWER);
  assert.equal(isInteractableTurn(recovered), true);
  assert.ok(recovered.legalMoves.length > 0, "1. Realtime-before-HTTP recovers from Edge viewer");
  assert.equal(
    onlineDragGate({
      isHumanTurn: isInteractableTurn(recovered),
      busy: false,
      legalMoves: recovered.legalMoves,
      tileId: recovered.legalMoves[0].tileId,
    }),
    "ok"
  );
  void move;
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const { state: after } = playOnce(state);
  const httpFirst = viewerOf(after, actor, 1);
  assert.equal(httpFirst.interactionSource, INTERACTION_SOURCE_VIEWER);
  const kept = keepAuthoritativeView(httpFirst, mergeRealtimeSessionView(httpFirst, realtimeRow(after, 1)));
  assert.equal(kept, httpFirst, "2. HTTP-before-Realtime keeps the viewer snapshot");
  assert.equal(kept.interactionSource, INTERACTION_SOURCE_VIEWER);
  assert.deepEqual(kept.myHand, httpFirst.myHand);
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const newer = viewerOf(state, state.currentPlayer, 4);
  const older = viewerOf(state, state.currentPlayer, 3);
  assert.equal(keepAuthoritativeView(newer, older), newer, "3. older snapshot cannot overwrite newer");
  const olderPublic = mergeRealtimeSessionView(older, {
    table: "game_sessions",
    new: { version: 2, current_seat: 0, phase: "playing", board: [], hand_counts: [7, 7] },
  });
  assert.equal(olderPublic, older);
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const { state: after } = playOnce(state);
  const publicOnly = mergeRealtimeSessionView(viewerOf(state, actor, 0), realtimeRow(after, 1));
  const fuller = viewerOf(after, actor, 1);
  assert.equal(publicOnly.interactionSource, INTERACTION_SOURCE_PUBLIC);
  assert.equal(fuller.interactionSource, INTERACTION_SOURCE_VIEWER);
  assert.equal(
    keepAuthoritativeView(fuller, publicOnly),
    fuller,
    "4. same-version fuller viewer snapshot wins"
  );
  assert.equal(keepAuthoritativeView(publicOnly, fuller).interactionSource, INTERACTION_SOURCE_VIEWER);
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const prePlay = viewerOf(state, actor, 0);
  const { state: after, move } = playOnce(state);
  const merged = mergeRealtimeSessionView(prePlay, realtimeRow(after, 1));
  assert.equal(merged.myHand.includes(move.tileId), true, "public merge does not invent a new hand");
  assert.deepEqual(merged.legalMoves, []);
  assert.equal(
    legalMovesForPublicView(merged).length,
    0,
    "5. mismatched myHand must not produce legalMoves"
  );
  assert.equal(isInteractableTurn(merged), false);
  const recovered = keepAuthoritativeView(merged, viewerOf(after, actor, 1));
  assert.equal(recovered.myHand.includes(move.tileId), false);
  assert.equal(viewerHandMatchesCounts(recovered), true);
  assert.equal(isInteractableTurn(recovered), false, "after own play it is the opponent turn");
}

{
  for (const rulesetId of ["legacy", "haitian", "american"]) {
    const drawState = findDrawState(rulesetId);
    assert.ok(drawState, `need a ${rulesetId} state with no legal play and reserve tiles`);
    const seat = drawState.currentPlayer;
    const other = seat === 0 ? 1 : 0;
    const waiting = asViewerSnapshot({
      ...viewerOf(drawState, seat, 8),
      version: 8,
      currentSeat: other,
      canPlay: false,
      canDraw: false,
      canPass: false,
      legalMoves: [],
    });
    const merged = mergeRealtimeSessionView(waiting, realtimeRow(drawState, 9));
    assert.equal(merged.canDraw, false, `${rulesetId} Realtime must not copy stale canDraw`);
    assert.equal(merged.canPass, false);
    assert.equal(isInteractableTurn(merged), false);
    const recovered = keepAuthoritativeView(merged, viewerOf(drawState, seat, 9));
    assert.equal(recovered.canDraw, true, `6. ${rulesetId} canDraw true after turn transfer when reserve > 0`);
    assert.equal(recovered.canPass, false);
    assert.equal(recovered.canPlay, false);
    assert.equal(isInteractableTurn(recovered), true);
    assert.deepEqual(recovered.legalMoves, []);
  }
}

{
  const passState = findDrawState("legacy");
  assert.ok(passState);
  let emptied = passState;
  while (emptied.phase === "playing" && emptied.reserve.length > 0 && getAvailableActions(emptied).canDraw) {
    emptied = applyOnlineAction(emptied, {
      seat: emptied.currentPlayer,
      action: { type: ONLINE_ACTION_DRAW },
    }).state;
  }
  const available = getAvailableActions(emptied);
  if (emptied.phase === "playing" && emptied.reserve.length === 0 && !available.canPlay) {
    const view = viewerOf(emptied, emptied.currentPlayer, 11);
    assert.equal(view.canDraw, false, "7. canDraw false when reserve empty");
    assert.equal(view.canPass, true, "7. canPass true only when rules/reserve allow");
    assert.equal(view.reserveCount, 0);
  } else {
    const view = viewerOf(passState, passState.currentPlayer, 11);
    assert.equal(view.canPass, false, "7. canPass stays false while reserve has tiles");
    assert.equal(view.canDraw, true);
  }
}

{
  const drawState = findDrawState("legacy");
  assert.ok(drawState);
  let current = drawState;
  let draws = 0;
  while (
    current.phase === "playing" &&
    getAvailableActions(current).canDraw &&
    draws < 20
  ) {
    const before = current.reserve.length;
    const seat = current.currentPlayer;
    current = applyOnlineAction(current, {
      seat,
      action: { type: ONLINE_ACTION_DRAW },
    }).state;
    assert.equal(current.reserve.length, before - 1);
    const view = viewerOf(current, seat, 12 + draws);
    assert.equal(view.myHand.length, current.players[seat].hand.length);
    assert.equal(view.reserveCount, current.reserve.length);
    draws += 1;
    if (getAvailableActions(current).canPlay) break;
  }
  assert.ok(draws >= 1, "8. repeated draws until playable or reserve empty");
  const available = getAvailableActions(current);
  assert.ok(available.canPlay || available.canPass || current.phase !== "playing");
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const { state: after } = playOnce(state);
  const applied = viewerOf(after, state.currentPlayer, 6);
  assert.equal(shouldReleaseBusy(5, applied), true, "9. busy clears when version advanced");
  assert.equal(shouldReleaseBusy(6, applied), false);
  assert.equal(shouldReleaseBusy(-1, applied), false);
  const staleHttp = viewerOf(state, state.currentPlayer, 5);
  assert.equal(keepAuthoritativeView(applied, staleHttp), applied, "9. stale HTTP cannot re-lock");
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  let current = state;
  let live = viewerOf(current, current.currentPlayer, 0);
  for (let version = 1; version <= 8; version += 1) {
    if (current.phase !== "playing") break;
    const available = getAvailableActions(current);
    if (!available.canPlay) {
      if (available.canDraw) {
        current = applyOnlineAction(current, {
          seat: current.currentPlayer,
          action: { type: ONLINE_ACTION_DRAW },
        }).state;
      } else if (available.canPass) {
        current = applyOnlineAction(current, {
          seat: current.currentPlayer,
          action: { type: ONLINE_ACTION_PASS },
        }).state;
      } else {
        break;
      }
    } else {
      current = playOnce(current).state;
    }
    live = applyRealtimeThenViewer(live, current, version, live.viewerSeat);
    const actorView = applyRealtimeThenViewer(live, current, version, current.currentPlayer);
    if (current.phase === "playing" && getAvailableActions(current).canPlay) {
      assert.equal(isInteractableTurn(actorView), true, "10. Classic later turn stays interactable");
      assert.ok(draggableTileIds(actorView).length > 0, "10. Classic drag after many version transitions");
      assert.equal(
        onlineDragGate({
          isHumanTurn: isInteractableTurn(actorView),
          busy: false,
          legalMoves: actorView.legalMoves,
          tileId: actorView.legalMoves[0].tileId,
        }),
        "ok"
      );
    }
  }
}

{
  const haitian = dealOnlineGame({
    rulesetId: "haitian",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  }).state;
  const starter = haitian.currentPlayer;
  const other = starter === 0 ? 1 : 0;
  const starterView = viewerOf(haitian, starter, 0);
  const otherView = viewerOf(haitian, other, 0);
  assert.equal(starterView.mustPlayTileId, HAITIAN_OPENING_TILE_ID, "11. Haitian must play 6-6");
  assert.deepEqual(draggableTileIds(starterView), [HAITIAN_OPENING_TILE_ID]);
  assert.equal(
    starterView.legalMoves.every((move) => move.tileId === HAITIAN_OPENING_TILE_ID),
    true
  );
  assert.equal(isInteractableTurn(starterView), true);
  assert.equal(isInteractableTurn(otherView), false);
  assert.deepEqual(draggableTileIds(otherView), []);
  assert.throws(
    () =>
      applyOnlineAction(haitian, {
        seat: other,
        action: { type: ONLINE_ACTION_PLAY, tileId: HAITIAN_OPENING_TILE_ID, end: "right" },
      }),
    (err) => err instanceof GameplayError && err.code === "WRONG_TURN"
  );
  const opened = applyOnlineAction(haitian, {
    seat: starter,
    action: { type: ONLINE_ACTION_PLAY, tileId: HAITIAN_OPENING_TILE_ID, end: "right" },
  }).state;
  assert.equal(opened.currentPlayer, other);
  const afterStarter = applyRealtimeThenViewer(starterView, opened, 1, starter);
  const afterOther = applyRealtimeThenViewer(otherView, opened, 1, other);
  assert.equal(afterStarter.currentSeat, other);
  assert.equal(isInteractableTurn(afterStarter), false);
  assert.equal(isInteractableTurn(afterOther), true, "12. Haitian subsequent turn is interactable");
  assert.ok(afterOther.legalMoves.length > 0);
  assert.ok(draggableTileIds(afterOther).length > 0);
}

{
  const american = dealOnlineGame({
    rulesetId: "american",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  }).state;
  assert.equal(american.rulesetId, "american");
  const starter = american.currentPlayer;
  const other = starter === 0 ? 1 : 0;
  const starterView = viewerOf(american, starter, 0);
  assert.ok(starterView.legalMoves.length > 0, "13. American opening legalMoves from viewer snapshot");
  assert.ok(draggableTileIds(starterView).length > 0, "13. American first tile is draggable");
  const { state: opened, move } = playOnce(american);
  const otherView = applyRealtimeThenViewer(viewerOf(american, other, 0), opened, 1, other);
  assert.equal(isInteractableTurn(otherView), true);
  assert.ok(otherView.legalMoves.length > 0, "14. American subsequent legalMoves");
  const actorAfter = viewerOf(opened, starter, 1);
  const otherAfter = viewerOf(opened, other, 1);
  assert.deepEqual(
    (actorAfter.spinner?.id ?? null) === (otherAfter.spinner?.id ?? null),
    true,
    "14. spinner remains server-authoritative on both seats"
  );
  void move;
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const waiter = actor === 0 ? 1 : 0;
  const { state: after } = playOnce(state);
  const actorView = viewerOf(after, actor, 1);
  const waiterView = viewerOf(after, waiter, 1);
  assert.equal(actorView.version, waiterView.version);
  assert.deepEqual(
    actorView.board.map((tile) => tile.id),
    waiterView.board.map((tile) => tile.id)
  );
  assert.deepEqual(actorView.scores, waiterView.scores);
  assert.equal(actorView.currentSeat, waiter);
  assert.equal(waiterView.currentSeat, waiter);
  assert.equal(actorView.viewerSeat, actor);
  assert.equal(waiterView.viewerSeat, waiter);
  assert.equal(opponentHandCount(actorView), 7);
  assert.equal(opponentHandCount(waiterView), 6);
  assert.equal(actorView.handCounts[actor], 6);
  assert.equal(waiterView.handCounts[actor], 6);
  assert.equal(isInteractableTurn(waiterView), true);
  assert.equal(isInteractableTurn(actorView), false);
}

{
  let { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 3,
  });
  state = driveUntil(state, (current) => current.phase !== "playing");
  assert.equal(state.phase, "roundOver");
  assert.ok(state.board.length > 0);
  const scores = state.scores.slice();
  const round1ViewA = viewerOf(state, 0, 8);
  const next = applyAdvanceRound(state, { seed: 88 });
  assert.equal(next.state.round, 2);
  assert.deepEqual(next.state.board, []);
  assert.deepEqual(next.state.scores, scores);
  const mergedA = mergeRealtimeSessionView(round1ViewA, realtimeRow(next.state, 9));
  assert.deepEqual(mergedA.board, [], "16. Realtime round 2 public board is empty");
  assert.equal(mergedA.round, 2);
  assert.deepEqual(mergedA.myHand, [], "16. stale round-1 hand is dropped on round change");
  const viewA = keepAuthoritativeView(mergedA, viewerOf(next.state, 0, 9));
  const viewB = viewerOf(next.state, 1, 9);
  assert.deepEqual(viewA.board, []);
  assert.deepEqual(viewB.board, []);
  assert.equal(viewA.round, 2);
  assert.equal(viewB.round, 2);
  assert.deepEqual(viewA.scores, scores);
  assert.equal(viewA.version, viewB.version);
  assert.equal(viewA.myHand.length, 7);
  assert.equal(viewB.myHand.length, 7);
}

{
  let { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 1001,
    targetScore: 1,
  });
  state = driveUntil(state, (current) => current.phase === "matchOver" || current.phase === "roundOver");
  if (state.phase === "roundOver") {
    const advanced = applyAdvanceRound(state, { seed: 1 });
    if (advanced.state.phase === "matchOver") state = advanced.state;
  }
  if (state.phase !== "matchOver") {
    state = driveUntil(state, (current) => current.phase === "matchOver", 1200);
  }
  if (state.phase === "matchOver") {
    const viewA = viewerOf(state, 0, 20);
    const viewB = viewerOf(state, 1, 20);
    assert.equal(viewA.matchWinnerSeat, state.matchWinner);
    assert.equal(viewB.matchWinnerSeat, state.matchWinner);
    assert.equal(viewA.phase, "matchOver");
    assert.equal(isInteractableTurn(viewA), false);
    assert.equal(isInteractableTurn(viewB), false);
    assert.throws(
      () =>
        applyOnlineAction(state, {
          seat: state.matchWinner ?? 0,
          action: { type: ONLINE_ACTION_PLAY, tileId: "0-0", end: "right" },
        }),
      (err) => err instanceof GameplayError && err.code === "ROUND_NOT_ACTIVE",
      "17. match-over blocks further actions"
    );
  } else {
    const { state: opened } = playOnce(
      dealOnlineGame({
        rulesetId: "legacy",
        playerAId: PLAYER_A,
        playerBId: PLAYER_B,
        seed: 2001,
      }).state
    );
    assert.throws(
      () =>
        applyOnlineAction({ ...opened, phase: "matchOver" }, {
          seat: opened.currentPlayer,
          action: { type: ONLINE_ACTION_PASS },
        }),
      (err) => err instanceof GameplayError && err.code === "ROUND_NOT_ACTIVE"
    );
  }
}

{
  for (const rulesetId of ["legacy", "haitian", "american"]) {
    const { state } = dealOnlineGame({
      rulesetId,
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
      seed: 2001,
    });
    const starter = state.currentPlayer;
    const other = starter === 0 ? 1 : 0;
    const starterView = viewerOf(state, starter, 0);
    const otherView = viewerOf(state, other, 0);
    assert.ok(starterView.legalMoves.length > 0, `${rulesetId} starter has server legalMoves`);
    assert.equal(otherView.legalMoves.length, 0);
    assert.ok(draggableTileIds(starterView).length > 0);
    assert.deepEqual(draggableTileIds(otherView), []);
    const echoed = mergeRealtimeSessionView(starterView, realtimeRow(state, 0));
    assert.deepEqual(
      echoed.legalMoves.map((move) => move.tileId),
      starterView.legalMoves.map((move) => move.tileId),
      `${rulesetId} same-version realtime keeps server legalMoves`
    );
  }
}

{
  const prePlay = asViewerSnapshot({
    matchId: "match-1",
    rulesetId: "legacy",
    version: 5,
    phase: "playing",
    status: "playing",
    viewerSeat: 0,
    currentSeat: 0,
    myHand: ["0-3", "4-5"],
    board: [
      { id: "6-6", left: 6, right: 6, orientation: "vertical" },
      { id: "2-6", left: 2, right: 6, orientation: "horizontal" },
    ],
    scores: [0, 0],
    handCounts: [2, 4],
    legalMoves: [{ tileId: "4-5", end: "left" }],
    canPlay: true,
    canDraw: false,
    canPass: false,
  });
  const playResult = asViewerSnapshot({
    ...prePlay,
    version: 6,
    currentSeat: 1,
    myHand: ["0-3"],
    board: [
      ...prePlay.board,
      { id: "4-5", left: 4, right: 5, orientation: "horizontal" },
    ],
    handCounts: [1, 4],
    legalMoves: [],
    canPlay: false,
    canDraw: false,
    canPass: false,
  });
  const ownPlayRow = {
    table: "game_sessions",
    new: {
      version: 6,
      current_seat: 1,
      phase: "playing",
      status: "playing",
      board: playResult.board,
      hand_counts: [1, 4],
    },
  };
  const mergedFromPrePlay = mergeRealtimeSessionView(prePlay, ownPlayRow);
  assert.equal(mergedFromPrePlay.interactionSource, INTERACTION_SOURCE_PUBLIC);
  assert.deepEqual(mergedFromPrePlay.legalMoves, []);
  const keptPlay = keepAuthoritativeView(mergedFromPrePlay, playResult);
  assert.deepEqual(keptPlay.myHand, ["0-3"]);
  assert.equal(keepAuthoritativeView(playResult, mergedFromPrePlay), playResult);
  assert.equal(shouldFlushPendingView(playResult, mergedFromPrePlay), false);
  assert.equal(shouldFlushPendingView(mergedFromPrePlay, playResult), true);
}

{
  const opened = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  }).state;
  const actor = opened.currentPlayer;
  const first = viewerOf(opened, actor, 0).legalMoves[0];
  const afterFirst = applyOnlineAction(opened, {
    seat: actor,
    action: { type: ONLINE_ACTION_PLAY, tileId: first.tileId, end: first.end },
  }).state;
  const prePlay = viewerOf(opened, actor, 0);
  assert.equal(
    reconcileViewerHand(prePlay.myHand, {
      ...prePlay,
      board: afterFirst.board,
      handCounts: afterFirst.players.map((player) => player.hand.length),
    }).includes(first.tileId),
    false
  );
}

{
  const preview = optimisticPlayPreview({
    tileId: "6-6",
    end: "right",
    left: 6,
    right: 6,
    orientation: "vertical",
  });
  assert.equal(preview.hideOnly, false);
  assert.equal(preview.tile.id, "6-6");
  const spinner = optimisticPlayPreview({
    tileId: "5-5",
    end: "north",
    left: 5,
    right: 5,
    orientation: "vertical",
  });
  assert.equal(spinner.hideOnly, true);
  assert.equal(optimisticPlayPreview(null), null);
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  });
  const actor = state.currentPlayer;
  const waiter = actor === 0 ? 1 : 0;
  const before = viewerOf(state, actor, 0);
  const { state: after } = playOnce(state);
  const httpFirst = viewerOf(after, actor, 1);
  const echoed = mergeRealtimeSessionView(httpFirst, realtimeRow(after, 1));
  assert.equal(
    shouldRefreshViewerAfterRealtime(httpFirst, echoed, { busy: false }),
    false,
    "22. HTTP-before-Realtime must not duplicate getGameView"
  );
  const waiting = viewerOf(state, waiter, 0);
  const mergedWaiter = mergeRealtimeSessionView(waiting, realtimeRow(after, 1));
  assert.equal(
    shouldRefreshViewerAfterRealtime(waiting, mergedWaiter, { busy: false }),
    true,
    "opponent Realtime-before-HTTP still refreshes private view"
  );
  const actorMerged = mergeRealtimeSessionView(before, realtimeRow(after, 1));
  assert.equal(
    shouldRefreshViewerAfterRealtime(before, actorMerged, {
      busy: true,
      inFlightBaseVersion: 0,
    }),
    false,
    "actor in-flight HTTP skips echo getGameView"
  );
  assert.deepEqual(networkCallsForMove({
    isActor: true,
    hasCoherentViewerAtNewVersion: true,
    versionAdvanced: true,
  }), { submitGameAction: 1, getGameView: 0 });
  assert.deepEqual(networkCallsForMove({
    isActor: false,
    hasCoherentViewerAtNewVersion: false,
    versionAdvanced: true,
  }), { submitGameAction: 0, getGameView: 1 });
}

{
  let current = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 2001,
  }).state;
  let actions = 0;
  let live = viewerOf(current, current.currentPlayer, 0);
  for (let version = 1; actions < 16 && version < 80; version += 1) {
    if (current.phase === "roundOver") {
      current = applyAdvanceRound(current, { seed: 40 + version }).state;
      live = applyRealtimeThenViewer(live, current, version, current.currentPlayer);
      assert.deepEqual(live.board, [], "round 2 board empty after auto-advance state");
      continue;
    }
    if (current.phase !== "playing") break;
    const available = getAvailableActions(current);
    if (available.canPlay) {
      current = playOnce(current).state;
    } else if (available.canDraw) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_DRAW },
      }).state;
    } else if (available.canPass) {
      current = applyOnlineAction(current, {
        seat: current.currentPlayer,
        action: { type: ONLINE_ACTION_PASS },
      }).state;
    } else {
      break;
    }
    actions += 1;
    live = applyRealtimeThenViewer(live, current, version, current.currentPlayer);
    if (getAvailableActions(current).canPlay && current.phase === "playing") {
      assert.equal(isInteractableTurn(live), true, "7. Classic 15+ alternating stays interactable");
      assert.ok(draggableTileIds(live).length > 0);
    }
  }
  assert.ok(actions >= 15, `Classic 15+ alternating online moves, got ${actions}`);
}

{
  assert.equal(
    isRoundOverView({ phase: "roundOver", status: "round_over" }),
    true
  );
  assert.equal(
    isRoundOverView({ phase: "matchOver", status: "match_over" }),
    false
  );
}

{
  let { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 3,
  });
  state = driveUntil(state, (current) => current.phase !== "playing");
  assert.equal(state.phase, "roundOver", "B. round 1 ended");
  assert.ok(state.board.length > 0, "A. round 1 chain is non-empty");
  const round1Ids = state.board.map((tile) => tile.id);
  const scoresAfterRound1 = state.scores.slice();
  const roundOverA = viewerOf(state, 0, 8);
  const roundOverB = viewerOf(state, 1, 8);
  assert.equal(isRoundOverView(roundOverA), true);
  assert.deepEqual(
    boardTilesFromView(roundOverA).map((tile) => tile.id),
    round1Ids,
    "roundOver still renders the completed chain until the next round"
  );
  assert.equal(
    roundIdentityFromView(roundOverA),
    "match-1:1",
    "round identity is matchId + round, not phase"
  );
  assert.equal(roundIdentityFromView(roundOverA), roundIdentityFromView(roundOverB));

  const next = applyAdvanceRound(state, { seed: 88 });
  assert.equal(next.state.round, 2, "C. next authoritative round starts");
  assert.deepEqual(next.state.board, [], "C. server deals an empty board");
  assert.deepEqual(next.state.scores, scoresAfterRound1, "E. match scores preserved");
  assert.equal(next.state.rulesetId, "legacy");

  const nextRow = realtimeRow(next.state, 9);
  const omitted = { table: "game_sessions", new: { ...nextRow.new } };
  delete omitted.new.board;
  delete omitted.new.spinner;
  const leftover = {
    table: "game_sessions",
    new: { ...nextRow.new, board: state.board.slice() },
  };
  const jsonEmpty = {
    table: "game_sessions",
    new: { ...nextRow.new, board: JSON.stringify([]) },
  };

  for (const [label, payload] of [
    ["full public row", nextRow],
    ["omitted board", omitted],
    ["leftover round-1 board", leftover],
    ["json empty board", jsonEmpty],
  ]) {
    const mergedA = mergeRealtimeSessionView(roundOverA, payload);
    const mergedB = mergeRealtimeSessionView(roundOverB, payload);
    const renderedA = boardTilesFromView(mergedA);
    const renderedB = boardTilesFromView(mergedB);
    assert.equal(mergedA.round, 2, `${label}: round 2`);
    assert.equal(renderedA.length, 0, `D. ${label}: zero tiles from round 1`);
    assert.equal(
      renderedA.some((tile) => round1Ids.includes(tile.id)),
      false,
      `D. ${label}: no round-1 tile ids`
    );
    assert.deepEqual(mergedA.scores, scoresAfterRound1, `E. ${label}: scores`);
    assert.equal(mergedA.matchId, "match-1", `${label}: matchId unchanged`);
    assert.equal(mergedA.myHand.length, 0, `F. ${label}: stale hand dropped`);
    assert.equal(roundIdentityFromView(mergedA), "match-1:2");
    assert.notEqual(roundIdentityFromView(roundOverA), roundIdentityFromView(mergedA));
    const resurrected = mergeRealtimeSessionView(mergedA, leftover);
    assert.equal(
      boardTilesFromView(resurrected).length,
      0,
      `G. ${label}: leftover placements cannot reappear`
    );
    assert.equal(mergedA.round, mergedB.round, `H. ${label}: same round`);
    assert.equal(
      roundIdentityFromView(mergedA),
      roundIdentityFromView(mergedB),
      `H. ${label}: same round identity`
    );
    assert.deepEqual(
      renderedA.map((tile) => tile.id),
      renderedB.map((tile) => tile.id),
      `H. ${label}: same board`
    );
  }

  const sealedLeftover = sealRoundTable(
    mergeRealtimeSessionView(roundOverA, leftover),
    {
      ...viewerOf(next.state, 0, 9),
      board: state.board.slice(),
    }
  );
  assert.equal(boardTilesFromView(sealedLeftover).length, 0);

  const viewA = keepAuthoritativeView(
    mergeRealtimeSessionView(roundOverA, leftover),
    viewerOf(next.state, 0, 9)
  );
  const viewB = viewerOf(next.state, 1, 9);
  assert.equal(viewA.round, 2);
  assert.equal(viewB.round, 2);
  assert.equal(viewA.version, viewB.version, "H. same game_sessions version");
  assert.deepEqual(boardTilesFromView(viewA), []);
  assert.deepEqual(boardTilesFromView(viewB), []);
  assert.equal(viewA.myHand.length, 7, "F. next round has its own hand");
  assert.equal(viewB.myHand.length, 7);
  assert.deepEqual(viewA.scores, scoresAfterRound1);
  assert.equal(viewA.matchId, viewB.matchId);
  assert.equal(roundIdentityFromView(viewA), roundIdentityFromView(viewB));
}

{
  const playing = asViewerSnapshot({
    matchId: "m-forfeit",
    version: 4,
    viewerSeat: 1,
    phase: "playing",
    status: "playing",
    currentSeat: 1,
    scores: [20, 10],
    board: [],
    myHand: ["0-1"],
    legalMoves: [{ tileId: "0-1", end: "left" }],
    canPlay: true,
    canDraw: false,
    canPass: false,
    rulesetId: "legacy",
  });
  const merged = mergeRealtimeSessionView(playing, {
    table: "game_sessions",
    new: {
      version: 5,
      phase: "matchOver",
      status: "match_over",
      match_winner_seat: 1,
      round_result: { reason: "forfeit", forfeitSeat: 0, winnerIndex: 1 },
      scores: [20, 10],
    },
  });
  assert.equal(isMatchOverView(merged), true);
  assert.equal(merged.matchWinnerSeat, 1);
  assert.equal(merged.roundResult.reason, "forfeit");
  assert.equal(
    shouldRefreshViewerAfterRealtime(playing, merged, { busy: true, inFlightBaseVersion: 4 }),
    true,
    "winner refreshes even if an in-flight action was pending"
  );
  const terminal = applyForfeitTerminalFields(playing, { winnerSeat: 1, forfeitSeat: 0 });
  assert.equal(terminal.matchWinnerSeat, 1);
  assert.equal(isMatchOverView(terminal), true);
  const seatZeroWin = applyForfeitTerminalFields(playing, { winnerSeat: 0, forfeitSeat: 1 });
  assert.equal(seatZeroWin.matchWinnerSeat, 0);
  assert.equal(occupancyTouchMissed({ ok: true, touched: false }), true);
  assert.equal(occupancyTouchMissed({ ok: true, touched: true }), false);
  assert.equal(occupancyTouchMissed({ ok: true }), false);
}

{
  const { state } = dealOnlineGame({
    rulesetId: "legacy",
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    seed: 1001,
  });
  const previous = {
    ...viewerOf(state, 0, 0),
    turnDeadlineAt: "2026-08-29T12:01:00.000Z",
    timeoutStrikes: [1, 0],
    serverNow: "2026-08-29T12:00:20.000Z",
    deadlineReceivedAt: "2026-08-29T12:00:20.000Z",
    deadlineReceivedMono: 9,
  };
  const merged = mergeRealtimeSessionView(previous, {
    table: "game_sessions",
    new: {
      version: 0,
      current_seat: previous.currentSeat,
      phase: "playing",
      turn_deadline_at: previous.turnDeadlineAt,
      timeout_strikes: [1, 0],
    },
  });
  assert.equal(merged.turnDeadlineAt, previous.turnDeadlineAt);
  assert.deepEqual(merged.timeoutStrikes, [1, 0]);
  assert.equal(merged.deadlineReceivedMono, 9);
  console.log("  ✓ realtime merge keeps the server deadline");
}

console.log("  ✓ online table helpers");
