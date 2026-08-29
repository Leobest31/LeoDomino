/**
 * Signed-in presence client contract. No network.
 * Run: node src/online/playerPresence.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  PLAYER_PRESENCE_HEARTBEAT_MS,
  PRESENCE_ERROR,
  PRESENCE_ONLINE_GRACE_MS,
  PresenceError,
  touchMyPresence,
} from "./playerPresence.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/playerPresence.js"), "utf8");
const hook = readFileSync(join(root, "src/hooks/usePlayerPresence.js"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");
const home = readFileSync(join(root, "src/pages/HomePage.jsx"), "utf8");

assert.equal(PLAYER_PRESENCE_HEARTBEAT_MS, 25 * 1000);
assert.equal(PRESENCE_ONLINE_GRACE_MS, 75 * 1000);
assert.match(source, /rpc\("touch_my_presence"\)/);
assert.doesNotMatch(source, /p_player_id|player_id:/);
assert.doesNotMatch(source, /\.from\(/);
assert.doesNotMatch(source, /admin_list_users|player_presence/);
assert.match(hook, /PLAYER_PRESENCE_HEARTBEAT_MS/);
assert.match(hook, /visibilitychange/);
assert.match(hook, /pageshow/);
assert.match(hook, /document\.visibilityState === "hidden"/);
assert.match(hook, /inFlightRef/);
assert.match(app, /usePlayerPresence\(\)/);
assert.equal((app.match(/usePlayerPresence\(/g) || []).length, 1);
assert.doesNotMatch(home, /usePlayerPresence/);
assert.doesNotMatch(hook, /setInterval[\s\S]*setInterval/);

{
  const loaded = await touchMyPresence({
    rpc: async (name, args) => {
      assert.equal(name, "touch_my_presence");
      assert.equal(args, undefined);
      return { data: { ok: true, last_seen_at: "2026-08-29T07:30:00.000Z" }, error: null };
    },
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.lastSeenAt, "2026-08-29T07:30:00.000Z");
}

{
  const missing = await touchMyPresence({
    rpc: async () => ({ data: null, error: { message: "function touch_my_presence does not exist", code: "42883" } }),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.unavailable, true);
}

await assert.rejects(
  () =>
    touchMyPresence({
      rpc: async () => ({ data: null, error: { message: "authentication required", code: "28000" } }),
    }),
  (error) => error instanceof PresenceError && error.code === PRESENCE_ERROR.AUTH
);

console.log("  ✓ player presence client contract");
