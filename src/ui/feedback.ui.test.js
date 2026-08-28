/**
 * Send Feedback + Rate LeoDomino Settings UI contract.
 * Run: node src/ui/feedback.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const settings = read("components/SettingsPanel.jsx");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");
const fr = read("i18n/locales/fr.js");
const es = read("i18n/locales/es.js");
const pt = read("i18n/locales/pt.js");
const home = read("pages/HomePage.jsx");
const example = read("../.env.example");

assert.match(settings, /data-settings-feedback="true"/);
assert.match(settings, /data-settings-feedback-submit="true"/);
assert.match(settings, /data-settings-rate="true"/);
assert.match(settings, /data-settings-rate-btn="true"/);
assert.match(settings, /submitMyFeedback/);
assert.match(settings, /feedbackSending/);
assert.match(settings, /disabled=\{!feedbackReady\}/);
assert.match(settings, /validateFeedbackInput/);
assert.match(settings, /FEEDBACK_MIN_LENGTH/);
assert.match(settings, /showFeedbackMinHint/);
assert.match(settings, /Boolean\(feedbackLength\) && feedbackLength < FEEDBACK_MIN_LENGTH/);
assert.match(settings, /feedback\.minHint/);
assert.match(settings, /data-settings-feedback-min="true"/);
assert.match(settings, /setFeedbackCategory\("general"\)/);
assert.match(settings, /setFeedbackBody\(""\)/);
assert.match(settings, /canOpenStoreListing/);
assert.match(settings, /disabled=\{!canRate\}/);
assert.match(settings, /feedback\.rateComingSoon/);
assert.doesNotMatch(settings, /getSupabaseClient|createClient/);
assert.doesNotMatch(settings, /star-rating|requestReview|InAppReview/);
assert.doesNotMatch(home, /data-settings-feedback|Send Feedback/);

assert.ok(
  settings.indexOf("data-settings-feedback") < settings.indexOf("data-settings-rate"),
  "Send Feedback appears before Rate LeoDomino"
);
assert.ok(
  settings.indexOf("data-settings-rate") < settings.indexOf("settings-panel__legal"),
  "Rate LeoDomino appears before Legal"
);

assert.match(en, /title: "Send Feedback"/);
assert.match(en, /minHint: "Minimum 20 characters"/);
assert.match(ht, /minHint: "Minimòm 20 karaktè"/);
assert.match(fr, /minHint: "Minimum 20 caractères"/);
assert.match(es, /minHint: "Mínimo 20 caracteres"/);
assert.match(pt, /minHint: "Mínimo de 20 caracteres"/);
assert.match(en, /rateTitle: "Rate LeoDomino"/);
assert.match(en, /rateComingSoon: "Coming soon"/);
assert.match(example, /VITE_PLAY_STORE_URL=/);
assert.match(example, /VITE_APP_STORE_URL=/);

console.log("  ✓ feedback + rate Settings UI contract");
