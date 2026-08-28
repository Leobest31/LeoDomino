/**
 * Account deletion UI contract.
 * Run: node src/ui/accountDeletion.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const settings = read("components/SettingsPanel.jsx");
const app = read("App.jsx");
const pending = read("components/AccountDeletionPending.jsx");
const en = read("i18n/locales/en.js");

assert.match(settings, /data-account-delete="true"/);
assert.match(settings, /data-account-delete-confirm="true"/);
assert.match(settings, /type="password"/);
assert.match(settings, /auth\.deleteAccountPassword/);
assert.match(settings, /deleteAccount\(deletePassword\)/);
assert.doesNotMatch(settings, /DELETE_ACCOUNT_CONFIRM_WORD/);
assert.doesNotMatch(settings, /deleteTyped/);
assert.match(settings, /auth\.deleteAccount/);
assert.match(settings, /isCloudAuth\(\)/);
assert.doesNotMatch(settings, /onClick=\{\(\) => tap\(deleteAccount\)\}/, "first tap does not delete");
assert.doesNotMatch(settings, /AUTH_ERROR\.MATCH_ACTIVE/);

assert.match(app, /playable = Boolean\(signedIn && !session\?\.deletionPending\)/);
assert.match(app, /AccountDeletionPending/);
assert.match(app, /session\?\.deletionPending/);
assert.match(app, /phase === "home" && playable/);
assert.match(app, /phase === "findMatch" && playable/);
assert.match(app, /phase === "friends" && playable/);
assert.match(app, /phase === "chat" && playable/);

assert.match(pending, /data-account-deletion-pending="true"/);
assert.match(pending, /deleteAccount\(password\)/);
assert.match(pending, /type="password"/);
assert.match(pending, /auth\.deletionPendingRetry/);
assert.doesNotMatch(pending, /setPhase\("home"\)/);
assert.doesNotMatch(pending, /AUTH_ERROR\.MATCH_ACTIVE/);

assert.match(en, /deleteAccount: "Delete Account"/);
assert.match(en, /deleteAccountPassword/);
assert.match(en, /errorDeletePassword/);
assert.doesNotMatch(en, /errorMatchActive/);
assert.doesNotMatch(en, /Type \{\{word\}\}/);
assert.match(en, /deletionPendingTitle/);

console.log("  ✓ account deletion UI contract");
