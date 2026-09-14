/**
 * Admin Live Match message + email UI markers (bake / live Admin architecture).
 * Run: node src/ui/adminLiveMessage.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bakePage = join(
  process.env.TEMP || process.env.TMP || "",
  "leodomino-testers-admin-align/src/pages/AdminPage.jsx"
);
const pagePath = existsSync(bakePage) ? bakePage : join(root, "src/pages/AdminPage.jsx");
const page = readFileSync(pagePath, "utf8");
const client = readFileSync(join(root, "src/online/adminPlayerMessages.js"), "utf8");
const emailClient = readFileSync(join(root, "src/online/adminV1.js"), "utf8");
const onlineGame = readFileSync(join(root, "src/pages/OnlineGamePage.jsx"), "utf8");

assert.match(page, /data-admin-live-message="a"/);
assert.match(page, /data-admin-live-message="b"/);
assert.match(page, /data-admin-live-message-compose/);
assert.match(page, /data-admin-live-player-email="a"/);
assert.match(page, /data-admin-live-player-email="b"/);
assert.match(page, /openLivePlayerMessage\(liveSelected\.playerA\)/);
assert.match(page, /openLivePlayerMessage\(liveSelected\.playerB\)/);
assert.match(page, /fetchAdminPlayerEmail/);
assert.match(page, /sendAdminPlayerMessage/);
assert.match(page, /data-admin-player-email/);
assert.match(page, /data-admin-send-message/);
assert.doesNotMatch(page, /getSupabaseClient|SERVICE_ROLE|service_role/);
assert.match(client, /admin_send_player_message/);
assert.match(client, /is_staff|ADMIN_ERROR\.FORBIDDEN|staff required/i);
assert.match(emailClient, /admin_get_player_email/);
assert.doesNotMatch(onlineGame, /admin_send_player_message|data-admin-live-message/);

console.log(`  ✓ admin live message UI (${existsSync(bakePage) ? "bake" : "repo"})`);
