/**
 * Dual-compat commit_online_game_transition result mapping.
 * Run: node src/online/commitTransitionResult.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameplayError, getAvailableActions } from "./gameAuthority.js";
import {
  commitConflictCode,
  committedTransitionFromRpc,
  gameplayErrorFromCommitRaise,
  throwIfCommitConflict,
} from "./commitTransitionResult.js";
import {
  createMemoryGameStore,
  handleEnterOnlineMatch,
  handleGetGameView,
  handleResolveTurnTimeout,
  handleSubmitGameAction,
} from "./gameplayHandler.js";
import { keepAuthoritativeView } from "./onlineTable.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLAYER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAYER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MATCH_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function readyMatch(rulesetId = "legacy") {
  return {
    id: MATCH_ID,
    ruleset_id: rulesetId,
    player_a: PLAYER_A,
    player_b: PLAYER_B,
    status: "ready",
  };
}

/**
 * Memory CAS still throws. Hosted SQL returns HTTP 200 { ok: false }.
 * This wrapper is the Edge adapter path: interpret the body, never succeed it.
 */
function withHostedCommitBodies(store) {
  const innerCommit = store.commitTransition.bind(store);
  store.commitTransition = async (args) => {
    try {
      const committed = await innerCommit(args);
      return committedTransitionFromRpc({
        ok: true,
        version: committed.version,
        turnDeadlineAt: committed.turnDeadlineAt,
        timeoutStrikes: committed.timeoutStrikes,
      });
    } catch (error) {
      if (error?.code === "STALE_VERSION" || error?.code === "TIMEOUT_NOT_DUE") {
        const session = await store.loadSession(args.matchId);
        return committedTransitionFromRpc({
          ok: false,
          code: error.code,
          version: session?.version,
        });
      }
      throw gameplayErrorFromCommitRaise(error) ?? error;
    }
  };
  return store;
}

{
  assert.equal(commitConflictCode({ ok: true, version: 3 }), "");
  assert.equal(commitConflictCode({ version: 3, turnDeadlineAt: "x" }), "");
  assert.equal(commitConflictCode(null), "");
  assert.equal(commitConflictCode({ ok: false, code: "STALE_VERSION", version: 4 }), "STALE_VERSION");
  assert.equal(
    commitConflictCode({ ok: false, code: "TIMEOUT_NOT_DUE", version: 2 }),
    "TIMEOUT_NOT_DUE"
  );
  assert.equal(commitConflictCode({ ok: false, code: "OTHER" }), "");
  console.log("  ✓ ok:true and legacy success payloads are not conflicts");
}

{
  assert.throws(
    () => throwIfCommitConflict({ ok: false, code: "STALE_VERSION", version: 1 }),
    (err) => err instanceof GameplayError && err.code === "STALE_VERSION"
  );
  assert.throws(
    () => throwIfCommitConflict({ ok: false, code: "TIMEOUT_NOT_DUE", version: 1 }),
    (err) => err instanceof GameplayError && err.code === "TIMEOUT_NOT_DUE"
  );
  throwIfCommitConflict({ ok: true, version: 2 });
  throwIfCommitConflict({ version: 2 });
  assert.throws(
    () => throwIfCommitConflict({ ok: false, code: "OTHER" }),
    (err) => err instanceof GameplayError && err.code === "GAMEPLAY_FAILED"
  );
  console.log("  ✓ new SQL {ok:false,code} maps to GameplayError");
}

{
  const leaked = { ok: false, code: "STALE_VERSION", version: 6 };
  assert.equal(leaked.version, 6, "the 200 body still carries a version number");
  assert.throws(
    () => committedTransitionFromRpc(leaked),
    (err) => err instanceof GameplayError && err.code === "STALE_VERSION"
  );
  assert.throws(
    () => committedTransitionFromRpc([{ ok: false, code: "STALE_VERSION", version: 6 }]),
    (err) => err instanceof GameplayError && err.code === "STALE_VERSION"
  );
  assert.throws(
    () => committedTransitionFromRpc({ ok: false, code: "TIMEOUT_NOT_DUE", version: 2 }),
    (err) => err instanceof GameplayError && err.code === "TIMEOUT_NOT_DUE"
  );
  const ok = committedTransitionFromRpc({
    ok: true,
    version: 3,
    turnDeadlineAt: "2026-09-03T00:00:00.000Z",
    timeoutStrikes: [0, 1],
  });
  assert.equal(ok.version, 3);
  assert.equal(ok.turnDeadlineAt, "2026-09-03T00:00:00.000Z");
  const legacy = committedTransitionFromRpc({ version: 4, turn_deadline_at: "x" });
  assert.equal(legacy.version, 4);
  assert.equal(legacy.turnDeadlineAt, "x");
  console.log("  ✓ RPC {ok:false,code:STALE_VERSION} throws conflict, never a success payload");
}

{
  const stale = gameplayErrorFromCommitRaise(new Error("stale expected_version"));
  assert.equal(stale.code, "STALE_VERSION");
  const coded = gameplayErrorFromCommitRaise({ message: "could not serialize", code: "40001" });
  assert.equal(coded.code, "STALE_VERSION");
  const due = gameplayErrorFromCommitRaise(new Error("timeout not due"));
  assert.equal(due.code, "TIMEOUT_NOT_DUE");
  const already = new GameplayError("STALE_VERSION", "expected_version does not match");
  assert.equal(gameplayErrorFromCommitRaise(already), already);
  assert.equal(gameplayErrorFromCommitRaise(new Error("commit arguments required")), null);
  console.log("  ✓ old SQL RAISE stale / timeout-not-due maps to GameplayError");
}

{
  const edge = readFileSync(join(root, "supabase/functions/online-game/index.js"), "utf8");
  assert.match(edge, /throwIfCommitConflict|committedTransitionFromRpc/);
  assert.match(edge, /committedTransitionFromRpc\(data\)/);
  assert.match(edge, /gameplayErrorFromCommitRaise/);
  assert.match(edge, /commit_online_game_transition/);
  assert.doesNotMatch(
    edge,
    /return \{\s*version: data\?\.version/,
    "Edge must not treat the RPC body as success before conflict mapping"
  );
  const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
  assert.match(
    hook,
    /error\?\.code === "STALE_VERSION"[\s\S]*refreshView\(\)/,
    "client refreshes authoritative state after STALE_VERSION"
  );
  console.log("  ✓ Edge commitTransition is dual-compat");
}

{
  const store = withHostedCommitBodies(createMemoryGameStore([readyMatch()]));
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const secret = store.secrets.get(MATCH_ID);
  const seat = secret.engineState.currentPlayer;
  const actor = seat === 0 ? PLAYER_A : PLAYER_B;
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
  ]);
  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one play persists");
  assert.equal(rejected.length, 1, "loser is a conflict, not a viewer");
  assert.equal(rejected[0].reason.code, "STALE_VERSION");
  assert.equal(rejected[0].value, undefined);
  assert.equal(fulfilled[0].value?.myHand != null, true);
  assert.equal(store.actions.length, 1);
  assert.equal(store.sessions.get(MATCH_ID).version, 1);
  const winner = fulfilled[0].value;
  const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(viewA.version, winner.version);
  assert.equal(viewB.version, winner.version);
  assert.deepEqual(viewA.board, viewB.board);
  assert.equal(viewA.currentSeat, viewB.currentSeat);
  assert.equal(viewA.board.length, winner.board.length);
  const staleHttp = { ...viewA, version: 0, board: [] };
  assert.equal(
    keepAuthoritativeView(viewA, staleHttp).version,
    viewA.version,
    "stale same-match HTTP cannot overwrite the persisted version"
  );
  console.log("  ✓ hosted-body play/play: one persist, one conflict, refresh converges");
}

{
  const store = withHostedCommitBodies(createMemoryGameStore([readyMatch()]));
  const view = await handleEnterOnlineMatch({
    userId: PLAYER_A,
    matchId: MATCH_ID,
    store,
    createSeed: () => 1001,
  });
  const secret = store.secrets.get(MATCH_ID);
  const move = getAvailableActions(secret.engineState).legalMoves[0];
  const actor = secret.engineState.currentPlayer === 0 ? PLAYER_A : PLAYER_B;
  store.sessions.get(MATCH_ID).turnDeadlineAt = new Date(Date.now() - 25).toISOString();
  store.enableCommitYield();
  const results = await Promise.allSettled([
    handleSubmitGameAction({
      userId: actor,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      action: { type: "play", tileId: move.tileId, end: move.end },
      store,
    }),
    handleResolveTurnTimeout({
      userId: PLAYER_B,
      matchId: MATCH_ID,
      expectedVersion: view.version,
      store,
    }),
  ]);
  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1, "play vs timeout: one persist");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "STALE_VERSION");
  assert.equal(store.actions.length, 1);
  assert.equal(store.sessions.get(MATCH_ID).version, 1);
  const viewA = await handleGetGameView({ userId: PLAYER_A, matchId: MATCH_ID, store });
  const viewB = await handleGetGameView({ userId: PLAYER_B, matchId: MATCH_ID, store });
  assert.equal(viewA.version, 1);
  assert.equal(viewB.version, 1);
  assert.deepEqual(viewA.board, viewB.board);
  await assert.rejects(
    () =>
      handleSubmitGameAction({
        userId: actor,
        matchId: MATCH_ID,
        expectedVersion: 0,
        action: { type: "play", tileId: move.tileId, end: move.end },
        store,
      }),
    (err) => err.code === "STALE_VERSION"
  );
  console.log("  ✓ hosted-body play/timeout: one persist, retry at N still conflicts");
}

console.log("  ✓ commitTransitionResult");
