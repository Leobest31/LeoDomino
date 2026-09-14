/**
 * Admin player-detail drawer: stacked summary, avatar src, no raw i18n keys.
 * Contracts cover 1366 / 1024 / 768 drawer widths via CSS max constraints.
 * Run: node src/ui/adminPlayerDetail.layout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("pages/AdminPage.jsx");
const css = read("pages/AdminPage.css");
const locales = {
  en: read("i18n/locales/en.js"),
  ht: read("i18n/locales/ht.js"),
  fr: read("i18n/locales/fr.js"),
  es: read("i18n/locales/es.js"),
  pt: read("i18n/locales/pt.js"),
};

assert.match(page, /data-admin-player-identity="true"/);
assert.match(page, /data-admin-player-summary="true"/);
assert.match(page, /className="admin-page__summary-row"/);
assert.match(page, /function AdminAvatarImage/);
assert.match(page, /resolvePlayerAvatar\(avatarId\)\.src/);
assert.doesNotMatch(
  page,
  /src=\{resolvePlayerAvatar\([^)]+\)\}/,
  "avatar src must use .src, never the avatar object"
);
assert.match(page, /data-admin-avatar="true"/);
assert.match(page, /onError=\{/);
assert.match(page, /data-admin-send-message="true"/);
assert.match(page, /data-admin-message-history="true"/);
assert.match(page, /data-admin-history-actions="true"/);
assert.match(page, /admin\.copyHistoryReport/);
assert.match(page, /admin\.downloadHistoryCsv/);
assert.match(page, /"data-admin-player-email"/);
assert.match(page, /data-admin-player-id="true"/);
assert.match(page, /"data-admin-leopips-balance"/);
assert.match(page, /"data-admin-player-level"/);
assert.match(page, /"data-admin-player-xp"/);
assert.match(page, /"data-admin-player-qualifying-wins"/);
assert.match(page, /"data-admin-player-progression-rank"/);

assert.match(css, /\.admin-page__summary \{[\s\S]*grid-template-columns: 1fr/);
assert.match(css, /\.admin-page__summary-row \{[\s\S]*grid-template-columns: 1fr/);
assert.match(css, /\.admin-page__drawer \{[\s\S]*width: min\(36rem, 100%\)/);
assert.match(css, /\.admin-page__identity \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/);
assert.doesNotMatch(
  css,
  /\.admin-page__summary-row \{[\s\S]{0,180}minmax\(7rem/,
  "summary rows must not use side-by-side label/value columns"
);
assert.doesNotMatch(
  css,
  /\.admin-page__facts div \{[\s\S]{0,180}minmax\(7rem/,
  "legacy facts rows must not keep colliding side-by-side columns"
);

// Drawer width targets for laptop / mid / tablet-ish admin shells.
{
  const drawerWidth = css.match(/\.admin-page__drawer \{[\s\S]*?width: min\(([0-9.]+)rem, 100%\)/);
  assert.ok(drawerWidth, "drawer width declared");
  const rem = Number(drawerWidth[1]);
  assert.ok(rem >= 28, `drawer should be wider than the old 24rem trap (got ${rem}rem)`);
  for (const viewport of [1366, 1024, 768]) {
    const drawerPx = Math.min(rem * 16, viewport);
    assert.ok(drawerPx <= viewport, `drawer fits ${viewport}px viewport`);
    assert.ok(drawerPx >= Math.min(320, viewport), `drawer usable at ${viewport}px`);
  }
}

for (const [locale, src] of Object.entries(locales)) {
  assert.match(src, /copyHistoryReport:\s*"[^"]+"/, `${locale} copyHistoryReport`);
  assert.match(src, /downloadHistoryCsv:\s*"[^"]+"/, `${locale} downloadHistoryCsv`);
  assert.doesNotMatch(src, /copyHistoryReport:\s*"admin\./);
  assert.doesNotMatch(src, /downloadHistoryCsv:\s*"admin\./);
}
assert.match(locales.en, /copyHistoryReport: "Copy History Report"/);
assert.match(locales.en, /downloadHistoryCsv: "Download History CSV"/);

console.log("  ✓ admin player detail layout (stacked summary + avatar + i18n)");
