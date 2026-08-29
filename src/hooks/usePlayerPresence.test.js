/**
 * App-shell presence heartbeat hook contract.
 * Run: node src/hooks/usePlayerPresence.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "src/hooks/usePlayerPresence.js"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");
const pages = [
  "pages/HomePage.jsx",
  "pages/FriendsPage.jsx",
  "pages/ChatPage.jsx",
  "pages/ChallengePage.jsx",
  "pages/AdminPage.jsx",
  "pages/FindMatchPage.jsx",
  "pages/GamePage.jsx",
  "pages/OnlineGamePage.jsx",
  "components/ProfilePanel.jsx",
].map((rel) => {
  try {
    return readFileSync(join(root, "src", rel), "utf8");
  } catch {
    return "";
  }
});

assert.match(app, /usePlayerPresence\(\)/);
assert.equal((app.match(/usePlayerPresence\(/g) || []).length, 1, "one app-shell heartbeat");
assert.match(hook, /setInterval\(beat, PLAYER_PRESENCE_HEARTBEAT_MS\)/);
assert.match(hook, /visibilitychange/);
assert.match(hook, /pageshow/);
assert.match(hook, /resume/);
assert.match(hook, /focus/);
assert.match(hook, /deletionPending/);
assert.match(hook, /isCloudAuth\(\)/);
assert.doesNotMatch(hook, /p_player_id/);
for (const source of pages) {
  if (!source) continue;
  assert.doesNotMatch(source, /usePlayerPresence/, "pages do not start a second heartbeat");
}

console.log("  ✓ player presence hook contract");
