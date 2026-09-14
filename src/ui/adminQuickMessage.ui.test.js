/**
 * Admin quick Message action on player lists — reuses sendAdminPlayerMessage.
 * Run: node src/ui/adminQuickMessage.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("src/pages/AdminPage.jsx");
const css = read("src/pages/AdminPage.css");
const client = read("src/online/adminPlayerMessages.js");
const onlineGame = read("src/pages/OnlineGamePage.jsx");
const matchmaking = read("src/online/matchmaking.js");
const en = read("src/i18n/locales/en.js");

assert.match(page, /data-admin-quick-message=\{/);
assert.match(page, /openQuickPlayerMessage/);
assert.match(page, /sendQuickPlayerMessage/);
assert.match(page, /sendAdminPlayerMessage\(quickDmTarget\.playerId/);
assert.match(page, /data-admin-quick-message-compose/);
assert.match(page, /data-admin-quick-message-submit/);
assert.match(page, /data-admin-quick-message-status/);
assert.match(page, /data-admin-quick-message-player=\{quickDmTarget\.playerId\}/);
assert.match(page, /event\.stopPropagation\(\)/);

assert.match(page, /data-admin-user=\{user\.playerId\}/);
assert.match(page, /openQuickPlayerMessage\(user\)/);
assert.match(page, /data-admin-ranking-player=\{player\.playerId\}/);
assert.match(page, /openQuickPlayerMessage\(player\)/);
assert.match(page, /data-admin-live-player=\{row\.playerId\}/);
assert.match(page, /openQuickPlayerMessage\(row\)/);

assert.match(page, /data-admin-send-message="true"/);
assert.match(page, /sendSelectedPlayerMessage/);
assert.match(page, /sendAdminPlayerMessage\(selected\.playerId/);

assert.match(page, /gate === "ok" && quickDmTarget/);
assert.match(page, /probeAmIStaff/);
assert.doesNotMatch(page, /SERVICE_ROLE|service_role/);
assert.doesNotMatch(client, /SERVICE_ROLE|service_role/);
assert.match(client, /admin_send_player_message/);
assert.doesNotMatch(onlineGame, /openQuickPlayerMessage|data-admin-quick-message/);
assert.doesNotMatch(matchmaking, /sendAdminPlayerMessage|admin_send_player_message/);
assert.doesNotMatch(matchmaking, /openQuickPlayerMessage/);
assert.doesNotMatch(page, /leopips_debit|_leopips_credit|createMatchRequest/);

assert.match(en, /messageAction:\s*"Message"/);
assert.match(css, /\.admin-page__row-actions/);
assert.match(css, /\.admin-page__btn--compact/);
assert.match(css, /\.admin-page__drawer--quick-message/);

assert.match(page, /setQuickDmStatus\(\{ kind: "ok", key: "admin\.messageSent" \}\)/);
assert.match(page, /adminErrorI18nKey\(error, "admin\.messageSendFailed"\)/);
assert.match(page, /admin\.messageEmpty/);

console.log("  ✓ admin quick Message UI contract");
