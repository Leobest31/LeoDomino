/**
 * Gameplay client adapter — mocked Functions invoke, no network.
 * Run: node src/online/gameplay.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameplayClientError,
  advanceOnlineRound,
  enterOnlineMatch,
  getGameView,
  submitGameAction,
  resolveTurnTimeout,
  subscribeGameSession,
} from "./gameplay.js";
import { NETWORK_REQUEST_TIMEOUT_MS } from "./serviceHealth.js";

function mockClient(handler) {
  const captured = {};
  return {
    captured,
    functions: {
      async invoke(name, init) {
        captured.name = name;
        captured.body = init.body;
        return handler(name, init);
      },
    },
    channel(name) {
      captured.channel = name;
      return {
        on(kind, filter, _cb) {
          captured.realtime = { kind, filter };
          return this;
        },
        subscribe(statusCb) {
          captured.subscribed = true;
          captured.subscribeStatus = statusCb;
        },
      };
    },
    removeChannel() {
      captured.removed = true;
    },
  };
}

{
  const client = mockClient(async () => ({ data: { version: 0 }, error: null }));
  await enterOnlineMatch("match-1", client);
  assert.equal(client.captured.name, "online-game");
  assert.equal(client.captured.body.op, "enter_online_match");
  assert.equal(client.captured.body.matchId, "match-1");
  assert.equal("seed" in client.captured.body, false);
}

{
  const client = mockClient(async () => ({
    data: null,
    error: { message: "nope", context: { code: "NOT_A_PLAYER" } },
  }));
  await assert.rejects(
    () => getGameView("match-1", client),
    (err) => err instanceof GameplayClientError && err.code === "NOT_A_PLAYER"
  );
}

{
  const client = mockClient(async () => ({ data: { version: 1 }, error: null }));
  await submitGameAction("match-1", 0, { type: "draw" }, client);
  assert.equal(client.captured.body.op, "submit_game_action");
  assert.equal(client.captured.body.expectedVersion, 0);
  assert.deepEqual(client.captured.body.action, { type: "draw" });
  assert.equal("tileId" in client.captured.body.action, false);
}

{
  const client = mockClient(async () => ({ data: { version: 2 }, error: null }));
  await advanceOnlineRound("match-1", 1, client);
  assert.equal(client.captured.body.op, "advance_online_round");
}

{
  const client = mockClient(async () => ({ data: { version: 3 }, error: null }));
  await resolveTurnTimeout("match-1", 2, client);
  assert.equal(client.captured.body.op, "resolve_turn_timeout");
  assert.equal(client.captured.body.expectedVersion, 2);
}

{
  const client = mockClient(async () => ({
    data: { error: { code: "TIMEOUT_NOT_DUE", message: "timeout not due" } },
    error: { message: "Edge function returned a non-2xx status code" },
  }));
  await assert.rejects(
    () => resolveTurnTimeout("match-1", 2, client),
    (err) => err instanceof GameplayClientError && err.code === "TIMEOUT_NOT_DUE"
  );
  const stale = mockClient(async () => ({
    data: { error: { code: "STALE_VERSION", message: "expected_version does not match" } },
    error: { message: "Edge function returned a non-2xx status code" },
  }));
  await assert.rejects(
    () => resolveTurnTimeout("match-1", 2, stale),
    (err) => err instanceof GameplayClientError && err.code === "STALE_VERSION"
  );
}

{
  const client = mockClient(async () => ({ data: {}, error: null }));
  const stop = subscribeGameSession("match-1", () => {}, client);
  assert.equal(client.captured.realtime.filter.table, "game_sessions");
  assert.equal(typeof client.captured.subscribeStatus, "function");
  assert.doesNotMatch(JSON.stringify(client.captured), /game_secrets/);
  stop();
}

// ---------------------------------------------------------------------------
// Freeze-incident regression: a stalled/dropped Edge Function request must
// settle as a catchable error within a bounded time, never hang forever.
// A hung invoke() is indistinguishable from a legitimately in-flight one and
// permanently wedges every caller that guards against concurrent refreshes
// (useOnlineMatch's refreshInFlightRef).
// ---------------------------------------------------------------------------

{
  let capturedInit = null;
  const client = {
    functions: {
      async invoke(name, init) {
        capturedInit = init;
        return { data: { version: 0 }, error: null };
      },
    },
  };
  await getGameView("match-1", client);
  assert.equal(capturedInit.timeout, NETWORK_REQUEST_TIMEOUT_MS);
  console.log("  ✓ every invoke() call requests a bounded timeout from functions.invoke");
}

{
  // Mirrors functions-js's own real behavior (verified against the installed
  // @supabase/functions-js source): when a `timeout` option is supplied, a
  // fetch that never resolves on its own still settles — as {data:null,
  // error} — once the timeout elapses, never as an unbounded hang. The mock
  // uses a short delay standing in for the real NETWORK_REQUEST_TIMEOUT_MS
  // (proven forwarded by the previous test) so this test stays fast; if
  // gameplay.js ever stops passing `timeout` at all, this mock's Promise
  // never resolves and the test times out, failing loudly.
  const client = {
    functions: {
      invoke(name, init) {
        return new Promise((resolve) => {
          if (!init.timeout) return; // never resolves — reproduces the pre-fix hang
          setTimeout(() => {
            resolve({
              data: null,
              error: {
                name: "FunctionsFetchError",
                message: "Failed to send a request to the Edge Function",
                context: { name: "AbortError", message: "The user aborted a request." },
              },
            });
          }, 20);
        });
      },
    },
  };
  const startedAt = Date.now();
  await assert.rejects(
    () => getGameView("match-1", client),
    (err) => err instanceof GameplayClientError
  );
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 2000, `settled at ${elapsedMs}ms, not hung`);
  console.log("  ✓ a stalled request settles (rejects) once the client's own timeout elapses, never hangs");
}

{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const page = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
  const gamePage = readFileSync(join(root, "src/pages/GamePage.jsx"), "utf8");
  const onlinePage = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
  const hook = readFileSync(join(root, "src/hooks/useOnlineMatch.js"), "utf8");
  assert.doesNotMatch(page, /enterOnlineMatch|getGameView|submitGameAction/);
  assert.doesNotMatch(gamePage, /enterOnlineMatch|getGameView|submitGameAction/);
  assert.match(onlinePage, /useOnlineMatch/);
  assert.match(hook, /enterOnlineMatch/);
  assert.match(hook, /submitGameAction/);
  assert.match(hook, /resolveTurnTimeout/);
}

console.log("  ✓ gameplay client adapter");
