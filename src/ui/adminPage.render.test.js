/**
 * AdminPage first-render regression: the visibility-effect TDZ crash.
 * Run: npx vite-node src/ui/adminPage.render.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { AuthContext } from "../auth/AuthContext.js";
import AdminPage from "../pages/AdminPage.jsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "pages/AdminPage.jsx"), "utf8");

const loadOverviewDecl = page.indexOf("const loadOverview = useCallback");
const loadUsersDecl = page.indexOf("const loadUsers = useCallback");
const loadLiveDecl = page.indexOf("const loadLiveMatches = useCallback");
const loadTopRpDecl = page.indexOf("const loadTopRp = useCallback");

assert.ok(loadOverviewDecl >= 0, "loadOverview is declared");
assert.ok(loadUsersDecl >= 0, "loadUsers is declared");
assert.ok(loadLiveDecl >= 0, "loadLiveMatches is declared");
assert.ok(loadTopRpDecl >= 0, "loadTopRp is declared");
assert.match(page, /AdminLeopipsPanels/);
assert.match(page, /data-admin-card-open=/);

const auth = {
  signedIn: true,
  authReady: true,
  session: { playerId: "staff-render-test", deletionPending: false },
  openLogin() {},
};

let html = "";
try {
  html = renderToString(
    h(
      I18nProvider,
      null,
      h(AuthContext.Provider, { value: auth }, h(AdminPage, { onBack() {} }))
    )
  );
} catch (error) {
  const message = String(error?.message || error);
  assert.fail(
    `AdminPage first render threw: ${message}\n${error?.stack || ""}`.replace(
      /before initialization/,
      "before initialization (TDZ)"
    )
  );
}

assert.doesNotMatch(
  html,
  /data-admin-crash/,
  "first render is not the Admin crash fallback"
);
assert.match(html, /data-admin="true"/);
assert.match(
  html,
  /data-admin-gate="checking"|Checking access/,
  "signed-in AdminPage mounts past the previous TDZ crash into the access-check gate"
);

console.log("admin page first render passed");
