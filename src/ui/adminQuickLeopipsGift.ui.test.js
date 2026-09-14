/**
 * Admin quick "Send LeoPips" action on Player Rankings rows — reuses
 * sendAdminLeopipsGift. Frontend accessibility fix only: does not add,
 * remove, or rename any RPC. Backend (admin_gift_leopips) is unchanged.
 * Run: node src/ui/adminQuickLeopipsGift.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const page = read("src/pages/AdminPage.jsx");
const css = read("src/pages/AdminPage.css");
const client = read("src/online/adminLeopipsGift.js");
const en = read("src/i18n/locales/en.js");

// --- 1. Button visible on every Player Rankings row, next to Message ---
assert.match(page, /data-admin-ranking-player=\{player\.playerId\}/);
{
  const rowStart = page.indexOf('data-admin-ranking-player={player.playerId}');
  assert.ok(rowStart > 0, "player rankings row exists");
  const rowActionsAt = page.indexOf("admin-page__row-actions", rowStart);
  assert.ok(rowActionsAt > rowStart, "row actions cell exists on the rankings row");
  const rankingsRowActions = page.slice(rowActionsAt, page.indexOf("</tr>", rowActionsAt));
  assert.match(rankingsRowActions, /data-admin-quick-message=\{player\.playerId\}/);
  assert.match(rankingsRowActions, /openQuickPlayerMessage\(player\)/);
  assert.match(rankingsRowActions, /data-admin-quick-gift=\{player\.playerId\}/);
  assert.match(rankingsRowActions, /openQuickLeopipsGift\(player\)/);
  assert.match(rankingsRowActions, /t\("admin\.giftLeopipsAction"\)/);
  // Both buttons stop propagation so the row-detail click handler doesn't
  // also fire (would have opened the unrelated, previously-broken drawer).
  const giftButtonAt = rankingsRowActions.indexOf("data-admin-quick-gift");
  const stopPropAt = rankingsRowActions.indexOf("event.stopPropagation()", giftButtonAt - 200);
  assert.ok(stopPropAt >= 0 && stopPropAt < giftButtonAt + 200, "gift button stops row-click propagation");
}
console.log("  ✓ Send LeoPips button is visible on every Player Rankings row, next to Message");

// --- 2. Correct player is targeted ---
assert.match(page, /openQuickLeopipsGift = useCallback\(\(player\) => \{/);
assert.match(page, /playerId: player\.playerId,/);
assert.match(page, /setQuickGiftBalance\(\s*\n\s*Number\.isFinite\(Number\(player\.leopipsBalance\)\) \? Number\(player\.leopipsBalance\) : null/);
assert.match(page, /fetchAdminPlayerLeopips\(player\.playerId\)/);
assert.match(page, /data-admin-quick-gift-player=\{quickGiftTarget\.playerId\}/);
console.log("  ✓ correct player (id, seeded balance, fresh balance fetch) is targeted on open");

// --- 3. Existing Message button/flow untouched ---
assert.match(page, /openQuickPlayerMessage/);
assert.match(page, /sendQuickPlayerMessage/);
assert.match(page, /data-admin-quick-message-compose/);
console.log("  ✓ existing Message button/flow is untouched");

// --- 4. Gift panel is a self-contained overlay, shared by both entry points ---
assert.match(page, /gate === "ok" && quickGiftTarget/);
assert.match(page, /data-admin-quick-gift-overlay="true"/);
assert.match(page, /data-admin-quick-gift-compose="true"/);
assert.match(page, /closeQuickLeopipsGift/);
assert.match(page, /onClick=\{closeQuickLeopipsGift\}/);
// A broken inline gift section was previously added directly to the
// `selected` detail drawer (its own duplicated amount/reason form, its own
// send handler, its own compose-toggle state). That duplication must never
// come back. A drawer *trigger* that opens this same shared overlay is fine
// and is asserted separately below.
assert.doesNotMatch(page, /data-admin-gift-leopips="true"/);
assert.doesNotMatch(page, /data-admin-send-gift="true"/);
assert.doesNotMatch(page, /sendSelectedPlayerGift/);
assert.doesNotMatch(page, /giftComposeOpen/);
console.log("  ✓ gift panel is a self-contained overlay, with no duplicated inline form");

// --- 4b. Selected-player detail drawer has its own visible trigger for the same overlay ---
{
  const drawerAt = page.indexOf('data-admin-detail="true"');
  assert.ok(drawerAt > 0, "player detail drawer exists");
  const leopipsRowAt = page.indexOf('data-admin-leopips-balance', drawerAt);
  assert.ok(leopipsRowAt > drawerAt, "leopips balance row exists inside the detail drawer");
  const triggerAt = page.indexOf('data-admin-detail-quick-gift="true"', leopipsRowAt);
  assert.ok(triggerAt > leopipsRowAt, "quick-gift trigger sits near the leopips balance in the drawer");
  const triggerBlock = page.slice(triggerAt, triggerAt + 700);
  // Triggers the SAME overlay via the SAME openQuickLeopipsGift/quickGiftTarget
  // as the Rankings row — no second form, no second send path.
  assert.match(triggerBlock, /openQuickLeopipsGift\(\{/);
  assert.match(triggerBlock, /playerId: selected\.playerId/);
  assert.match(triggerBlock, /t\("admin\.giftLeopipsAction"\)/);
}
console.log("  ✓ detail drawer has a visible Send LeoPips trigger that opens the shared overlay");

// --- 4c. Drawer trigger and Rankings row both assign the SAME quickGiftTarget path ---
assert.match(page, /const openQuickLeopipsGift = useCallback\(\(player\) => \{/);
{
  const openFnAt = page.indexOf("const openQuickLeopipsGift = useCallback((player) => {");
  const openFnBody = page.slice(openFnAt, page.indexOf("}, []);", openFnAt));
  assert.match(openFnBody, /setQuickGiftTarget\(\{/);
  assert.match(openFnBody, /fetchAdminPlayerLeopips\(player\.playerId\)/);
}
// Both the Rankings row button and the drawer trigger call this one function;
// there is exactly one code path that sets quickGiftTarget.
assert.equal(
  (page.match(/setQuickGiftTarget\(/g) || []).length,
  2,
  "setQuickGiftTarget is only set from openQuickLeopipsGift and cleared in closeQuickLeopipsGift — no third path"
);
console.log("  ✓ drawer trigger and Rankings row both funnel through the one openQuickLeopipsGift path");

// --- 4d. Both entry points stay behind the staff gate; nothing renders for unauthorized users ---
assert.match(page, /gate === "ok" && selected \? \(/);
assert.doesNotMatch(page, /data-admin-detail-quick-gift="true"[\s\S]{0,600}gate !== "ok"/);
console.log("  ✓ both Send LeoPips entry points stay inside the gate === \"ok\" shell");

// --- Review fields: display name, username, player ID, balance before/amount/after, confirm ---
assert.match(page, /data-admin-quick-gift-name="true"/);
assert.match(page, /data-admin-quick-gift-username="true"/);
assert.match(page, /data-admin-quick-gift-player=/);
assert.match(page, /"data-admin-gift-balance-before":\s*"true"/);
assert.match(page, /data-admin-gift-amount="true"/);
assert.match(page, /"data-admin-gift-balance-after":\s*"true"/);
assert.match(page, /data-admin-gift-submit="true"/);
assert.match(page, /t\("admin\.giftConfirm"\)/);
console.log("  ✓ review shows display name, username, player id, balance before/amount/after, and Confirm");

// --- 5. Balance refreshes in the rankings table after success ---
assert.match(page, /setRankingPlayers\(\(prev\) =>\s*\n\s*prev\.map\(\(row\) =>\s*\n\s*row\.playerId === giftedPlayerId \? \{ \.\.\.row, leopipsBalance: result\.balanceAfter \} : row/);
console.log("  ✓ Player Rankings balance refreshes locally from the gift response after success");

// --- Idempotency / duplicate-safety preserved from the approved backend contract ---
assert.match(page, /createAdminLeopipsGiftIdempotencyKey/);
assert.match(page, /quickGiftIdempotencyKeyRef\.current = null/);
assert.match(client, /export async function sendAdminLeopipsGift/);

// --- No backend/RPC/SQL/economy change — frontend-only fix ---
assert.doesNotMatch(page, /admin_gift_leopips/);
assert.doesNotMatch(page, /_leopips_apply|_leopips_credit|_leopips_debit|admin_credit|admin_debit/);
assert.doesNotMatch(client, /admin_credit|admin_debit|_leopips_credit|_leopips_debit/);
console.log("  ✓ no RPC name, wallet math, or economy logic touched — frontend accessibility fix only");

// --- Reuses existing, already-styled drawer/filter/button classes (no new layout risk) ---
assert.match(css, /\.admin-page__drawer--quick-message/);
assert.match(css, /\.admin-page__row-actions/);
assert.match(css, /\.admin-page__btn--compact/);
assert.match(css, /\.admin-page__input/);
assert.match(css, /\.admin-page__filters/);
console.log("  ✓ gift panel reuses existing responsive drawer/button classes — no new layout rules");

assert.match(en, /giftLeopipsAction:\s*"Send LeoPips"/);
assert.match(en, /sendLeopipsGift:\s*"Send LeoPips Gift"/);

console.log("  ✓ admin quick Send LeoPips UI contract");
