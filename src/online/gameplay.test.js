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
        subscribe() {
          captured.subscribed = true;
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
  const client = mockClient(async () => ({ data: {}, error: null }));
  const stop = subscribeGameSession("match-1", () => {}, client);
  assert.equal(client.captured.realtime.filter.table, "game_sessions");
  assert.doesNotMatch(JSON.stringify(client.captured), /game_secrets/);
  stop();
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
