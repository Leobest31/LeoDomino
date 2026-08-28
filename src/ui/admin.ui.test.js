/**
 * Admin Dashboard V1 Phase 1 UI contract.
 * Run: node src/ui/admin.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const page = read("pages/AdminPage.jsx");
const css = read("pages/AdminPage.css");
const settings = read("components/SettingsPanel.jsx");
const home = read("pages/HomePage.jsx");
const en = read("i18n/locales/en.js");
const client = read("online/adminDashboard.js");
const sql = readFileSync(join(root, "..", "supabase/migrations/20260828290000_admin_dashboard_phase1.sql"), "utf8");

assert.match(app, /"admin"/);
assert.match(app, /<AdminPage/);
assert.match(app, /phase === "admin" && playable/);
assert.match(app, /probeAmIStaff/);
assert.match(app, /isAdminLocation/);
assert.match(app, /enterAdminLocation/);
assert.match(app, /leaveAdminLocation/);
assert.match(app, /goBackFromAdmin/);
assert.match(app, /handleAdminBack/);
assert.match(app, /onBack=\{handleAdminBack\}/);
assert.match(app, /showAdmin=\{typeof staffRole === "string"\}/);
assert.doesNotMatch(app, /localStorage|sessionStorage/);
assert.doesNotMatch(app, /supabaseClient|@supabase\/supabase-js|SERVICE_ROLE/);

assert.match(page, /data-admin="true"/);
assert.match(page, /data-admin-back="true"/);
assert.match(page, /common\.back/);
assert.match(page, /AdminBackBar/);
assert.doesNotMatch(page, /admin-page__home/);
assert.doesNotMatch(page, /admin\.backHome/);
assert.match(page, /data-admin-gate="denied"/);
assert.match(page, /data-admin-gate="ok"/);
assert.match(page, /data-admin-gate="checking"/);
assert.match(page, /probeAmIStaff/);
assert.match(page, /fetchAdminOverview/);
assert.match(page, /fetchAdminUsers/);
assert.match(page, /overviewCardsFromPayload/);
assert.match(page, /data-admin-overview="true"/);
assert.match(page, /data-admin-users="true"/);
assert.match(page, /data-admin-search="true"/);
assert.match(page, /data-admin-page="true"/);
assert.match(page, /data-admin-detail="true"/);
assert.match(page, /data-admin-nav-item=\{id\}/);
assert.match(page, /data-admin-card=\{card.id\}/);
assert.match(page, /"globalRp"/);
assert.match(page, /"liveMatches"/);
assert.match(page, /is-disabled/);
assert.match(page, /admin\.comingNext/);
assert.match(page, /admin\.accessDenied/);
assert.match(page, /setOffset\(offset \+ ADMIN_PAGE_SIZE\)/);
assert.match(page, /searchInput/);
assert.doesNotMatch(page, /localStorage|sessionStorage/);
assert.doesNotMatch(page, /email|phone|password|raw_user_meta_data|accountAge|service_role/i);
assert.doesNotMatch(page, /getSupabaseClient|createClient|SERVICE_ROLE/);
assert.doesNotMatch(page, /settle_match_global_rp|findMatch|onPlayVsLeoBest/);

assert.match(css, /#070b14|#05070d/);
assert.match(css, /color-gold/);
assert.match(css, /color-success/);
assert.match(css, /admin-page__topbar/);
assert.match(css, /admin-page__back/);
assert.match(css, /safe-area-inset-top/);
assert.match(css, /min-height: 44px/);
assert.doesNotMatch(css, /admin-page__home/);

assert.match(settings, /data-settings-admin="true"/);
assert.match(settings, /showAdmin/);
assert.match(settings, /admin\.openAdmin/);
assert.doesNotMatch(settings, /getSupabaseClient|createClient/);
assert.match(home, /showAdmin=\{Boolean\(showAdmin\)\}/);
assert.match(home, /onOpenAdmin/);

assert.match(client, /dropPrivateKeys|PRIVATE_FIELD/);
assert.match(sql, /public\.is_staff\('moderator'\)/);
assert.doesNotMatch(sql, /email|phone|password|raw_user_meta_data/i);

assert.match(page, /admin\.metricUnavailable/);
assert.match(page, /data-admin-card-unavailable/);
assert.match(page, /gate === "ok" && selected/);
assert.doesNotMatch(client, /\.from\(/);
assert.match(en, /globalOnlineUsers: "Global Online Users"/);
assert.match(en, /metricUnavailable: "Not available yet"/);
assert.match(en, /activeMatchPlayers: "Active Match Players"/);

console.log("  ✓ admin dashboard phase 1 UI contract");
