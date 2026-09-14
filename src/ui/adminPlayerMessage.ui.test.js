/**
 * Admin DM overlay isolation + UI markers. No network.
 * Run: node src/ui/adminPlayerMessage.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const overlay = readFileSync(join(root, "src/components/AdminPlayerMessageOverlay.jsx"), "utf8");
const css = readFileSync(join(root, "src/components/AdminPlayerMessageOverlay.css"), "utf8");
const app = readFileSync(join(root, "src/App.jsx"), "utf8");
const hook = readFileSync(join(root, "src/hooks/useAdminPlayerMessages.js"), "utf8");
const onlineGame = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");
const victory = readFileSync(join(root, "src/components/LeoPipsVictoryOverlay.jsx"), "utf8");
const levelUp = readFileSync(join(root, "src/components/LevelUpOverlay.css"), "utf8");
const progression = readFileSync(join(root, "src/leopips/leopipsProgress.js"), "utf8");
const wallet = readFileSync(join(root, "src/leopips/leopipsEconomy.js"), "utf8");

assert.match(overlay, /Message from LeoDomino Admin|adminMessage\.title/);
assert.match(overlay, /data-admin-player-message-body/);
assert.match(overlay, /data-admin-player-message-close/);
assert.match(overlay, /createPortal/);
assert.doesNotMatch(overlay, /t\(messageText\)|translate.*messageText/);
assert.match(css, /z-index:\s*15000/);
assert.match(levelUp, /z-index:\s*12000/);
assert.match(victory, /2147483000/);
assert.match(app, /AdminPlayerMessageOverlay/);
assert.match(app, /playable \? \(/);
assert.match(hook, /listMyUnreadAdminMessages/);
assert.match(hook, /subscribeMyAdminPlayerMessages/);
assert.match(hook, /markMyAdminMessageRead/);
assert.match(hook, /isLeoPipsVictoryOverlayOpen/);
assert.match(hook, /acknowledgedRef/);
assert.doesNotMatch(hook, /abandon|forfeit|timeout|matchmaking|wallet|progression/i);
assert.doesNotMatch(onlineGame, /AdminPlayerMessageOverlay|useAdminPlayerMessages/);
assert.doesNotMatch(progression, /admin_player_messages|admin_send_player_message/);
assert.doesNotMatch(wallet, /admin_player_messages|admin_send_player_message/);

console.log("  ✓ adminPlayerMessage UI isolation");
