/**
 * Admin selected-player detail drawer: Player Match History restoration.
 * Verifies adminPlayerMatchHistory.js + adminPlayerHistoryExport.js are wired
 * into production (not standalone), Copy History / Download CSV work, no
 * Global RP UI is present, and the whole drawer stays behind the staff gate.
 * Static source inspection only — never calls a network RPC or mutates data.
 * Run: node src/ui/adminPlayerMatchHistory.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("src/pages/AdminPage.jsx");
const css = read("src/pages/AdminPage.css");
const historyModule = read("src/online/adminPlayerMatchHistory.js");
const exportModule = read("src/online/adminPlayerHistoryExport.js");
const en = read("src/i18n/locales/en.js");

// --- 1. Both modules are imported by production code, not standalone files ---
assert.match(
  page,
  /import\s*\{[^}]*fetchAdminPlayerMatchHistory[^}]*\}\s*from\s*"\.\.\/online\/adminPlayerMatchHistory\.js"/s
);
assert.match(
  page,
  /import\s*\{\s*formatCopyReport,\s*toCsvBlob\s*\}\s*from\s*"\.\.\/online\/adminPlayerHistoryExport\.js"/
);
console.log("  ✓ both restored modules have a production import in AdminPage.jsx");

// --- 2. Selected-player detail panel mounts (existing drawer, unchanged gate) ---
assert.match(page, /gate === "ok" && selected \? \(/);
assert.match(page, /data-admin-detail="true"/);
console.log("  ✓ selected-player detail panel mounts behind the existing staff gate");

// --- 3. History loads through the existing staff reader, keyed on selected player ---
assert.match(page, /const \[matchHistory, setMatchHistory\] = useState\(/);
assert.match(page, /void fetchAdminPlayerMatchHistory\(selected\.playerId, \{/);
assert.match(page, /}, \[gate, selected\?\.playerId\]\);/);
assert.match(page, /const loadMoreMatchHistory = useCallback/);
assert.match(page, /admin\.matchHistoryUnavailable/);
console.log("  ✓ match history loads through fetchAdminPlayerMatchHistory (admin_list_player_match_history)");

// --- 4. Copy History action is wired (not a dangling button) ---
assert.match(page, /data-admin-copy-history="true"[\s\S]{0,40}onClick=\{\(\) => void copyPlayerHistoryReport\(\)\}/);
assert.match(page, /const copyPlayerHistoryReport = useCallback\(async \(\) => \{/);
assert.match(page, /formatCopyReport\(\{/);
assert.match(page, /navigator\.clipboard\.writeText\(text\)/);
console.log("  ✓ Copy History Report is wired to formatCopyReport + clipboard");

// --- 5. Download CSV action is wired (not a dangling button) ---
assert.match(page, /data-admin-download-history="true"[\s\S]{0,40}onClick=\{\(\) => downloadPlayerHistoryCsv\(\)\}/);
assert.match(page, /const downloadPlayerHistoryCsv = useCallback\(\(\) => \{/);
assert.match(page, /toCsvBlob\(\{/);
console.log("  ✓ Download History CSV is wired to toCsvBlob + client-side download");

// --- 6. History list renders loading / error / empty states + pagination ---
assert.match(page, /data-admin-match-history="true"/);
assert.match(page, /data-admin-match-history-loading="true"/);
assert.match(page, /data-admin-match-history-error="true"/);
assert.match(page, /data-admin-match-history-empty="true"/);
assert.match(page, /data-admin-match-history-more="true"/);
console.log("  ✓ loading / error / empty / load-more states are present");

// --- 7. No Global RP columns or labels anywhere in the restored history UI ---
assert.doesNotMatch(page, /globalRp|global_rp|rpDelta|hideGlobalRp/i);
assert.doesNotMatch(historyModule, /globalRp|global_rp|rp_delta/i);
assert.doesNotMatch(exportModule, /globalRp|global_rp|rp_delta/i);
console.log("  ✓ no Global RP columns or labels in the restored Player Match History UI");

// --- 8. Send LeoPips reuses the existing secure gift helper (no new RPC) ---
assert.match(page, /sendAdminLeopipsGift/);
assert.doesNotMatch(page, /admin_gift_leopips/);
assert.match(historyModule, /admin_list_player_match_history/);
console.log("  ✓ Send LeoPips still reuses sendAdminLeopipsGift; no new RPC introduced");

// --- 9. i18n: no raw-key fallback for the restored strings ---
for (const key of [
  "reportCopied",
  "copyHistoryFailed",
  "csvDownloaded",
  "matchHistoryOpponent",
  "result",
  "resultWin",
  "resultLoss",
  "resultUnknown",
  "noMatchHistory",
  "loadMore",
]) {
  assert.match(en, new RegExp(`\\b${key}:\\s*"[^"]+"`), `en.admin.${key} must be a real translation`);
}
console.log("  ✓ restored Player Match History strings are translated, not raw-key fallbacks");

// --- 10. CSS backs the new list/section classes (no unstyled markup) ---
assert.match(css, /\.admin-page__match-history \{/);
assert.match(css, /\.admin-page__match-history-list \{/);
assert.match(css, /\.admin-page__match-history-item \{/);
console.log("  ✓ match history list has backing CSS");

console.log("  ✓ admin Player Match History restoration contract");
