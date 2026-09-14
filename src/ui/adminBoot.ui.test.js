/**
 * /admin never-blank contract: error boundaries + AdminPage gates + SPA fallback.
 * Run: node src/ui/adminBoot.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { ADMIN_ERROR, adminErrorI18nKey } from "../online/adminDashboard.js";
import { isAdminLocation } from "../online/adminRoute.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const page = read("pages/AdminPage.jsx");
const boot = read("pages/AdminBoot.jsx");
const en = read("i18n/locales/en.js");
const vite = readFileSync(join(repo, "vite.config.js"), "utf8");
const staffSql = readFileSync(join(repo, "supabase/migrations/20260828280000_staff_roles.sql"), "utf8");

assert.equal(isAdminLocation({ pathname: "/admin", hash: "" }), true);

assert.match(app, /isAdminLocation/);
assert.match(app, /<AdminErrorBoundary/, "Admin render failures have a dedicated boundary");
assert.match(app, /<AdminPage onBack=\{handleAdminBack\}/);
assert.match(app, /playable = Boolean\(signedIn && !session\?\.deletionPending/);
assert.match(app, /phase === "admin" && playable/);

assert.match(boot, /data-admin-boot=\{boot\}/);
assert.match(boot, /checkingSession|unauthenticated|expired/);
assert.match(boot, /data-admin-crash="true"/);
assert.match(boot, /data-admin-panel-error="true"/);
assert.match(boot, /AdminPanelErrorBoundary/);
assert.match(boot, /AdminSessionPage/);
assert.match(boot, /token\|jwt\|password\|secret/);

assert.match(page, /data-admin-gate="checking"/);
assert.match(page, /data-admin-gate="denied"/);
assert.match(page, /data-admin-gate="ok"/);
assert.match(page, /data-admin-gate="error"/);
assert.match(page, /AdminPanelErrorBoundary resetKey=\{section\}/);
assert.match(page, /AdminLeopipsPanels/);
assert.match(page, /visibilitychange/);
assert.match(page, /onClick=\{\(\) => void checkAccess\(\)\}/);
assert.match(page, /onClick=\{\(\) => void loadOverview\(\)\}/);
assert.match(page, /const loadOverview = useCallback/);
assert.match(page, /window.addEventListener\("focus"/);

assert.equal(adminErrorI18nKey({ code: ADMIN_ERROR.AUTH }), "admin.signInRequired");
assert.equal(adminErrorI18nKey({ code: ADMIN_ERROR.FORBIDDEN }), "admin.accessDeniedBody");
assert.equal(adminErrorI18nKey({ code: ADMIN_ERROR.BACKEND }), "admin.backendUnavailable");

assert.match(staffSql, /moderator/);
assert.match(staffSql, /owner/);
assert.match(en, /renderError:/);
assert.match(en, /panelRenderError:/);
assert.match(en, /checkingSession:/);
assert.match(en, /signInAgain:/);

assert.match(vite, /navigateFallback: "\/index.html"/);
assert.doesNotMatch(app, /SERVICE_ROLE|service_role/);
assert.doesNotMatch(page, /SERVICE_ROLE|service_role/);
assert.doesNotMatch(boot, /SERVICE_ROLE|service_role/);

console.log("admin boot UI contract passed");
