/**
 * Send Feedback client contract. No network.
 * Run: node src/online/feedback.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  FEEDBACK_ERROR,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  FeedbackError,
  buildFeedbackPayload,
  normalizeFeedbackBody,
  normalizeFeedbackCategory,
  submitMyFeedback,
  validateFeedbackInput,
} from "./feedback.js";
import {
  APP_STORE_URL_ENV,
  PLAY_STORE_URL_ENV,
  canOpenStoreListing,
  getConfiguredStoreUrl,
  isOfficialAppStoreUrl,
  isOfficialPlayStoreUrl,
  openConfiguredStoreListing,
} from "../legal/storeLinks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/feedback.js"), "utf8");
const settings = readFileSync(join(root, "src/components/SettingsPanel.jsx"), "utf8");

assert.match(source, /rpc\("submit_my_feedback"/);
assert.doesNotMatch(source, /email|displayName|display_name|gps|contacts|device_id|opponent/i);
assert.doesNotMatch(source, /friend_messages|game_secrets|match dump/i);
assert.match(source, /APP_VERSION/);
assert.match(source, /getPlatform/);
assert.match(source, /VITE_BUILD_NUMBER/);
assert.match(settings, /submitMyFeedback/);
assert.doesNotMatch(settings, /getSupabaseClient|createClient/);

assert.equal(normalizeFeedbackCategory("BUG"), "bug");
assert.equal(normalizeFeedbackCategory("nope"), "");
assert.equal(normalizeFeedbackBody("  hello  "), "hello");
assert.equal(validateFeedbackInput({ category: "general", body: "x".repeat(19) }), FEEDBACK_ERROR.TOO_SHORT);
assert.equal(validateFeedbackInput({ category: "general", body: "x".repeat(20) }), null);
assert.equal(
  validateFeedbackInput({ category: "general", body: "x".repeat(FEEDBACK_MAX_LENGTH + 1) }),
  FEEDBACK_ERROR.TOO_LONG
);
assert.equal(validateFeedbackInput({ category: "other", body: "x".repeat(40) }), FEEDBACK_ERROR.INVALID_CATEGORY);
assert.equal(FEEDBACK_MIN_LENGTH, 20);

{
  const payload = buildFeedbackPayload({
    category: "Feature",
    body: "  Please add a rematch button soon.  ",
    platform: "android",
    appVersion: "1.0.0",
    buildNumber: "42",
  });
  assert.deepEqual(payload, {
    p_category: "feature",
    p_body: "Please add a rematch button soon.",
    p_app_version: "1.0.0",
    p_platform: "android",
    p_build_number: "42",
  });
  assert.equal("email" in payload, false);
  assert.equal("p_player_id" in payload, false);
  assert.equal("p_status" in payload, false);
}

{
  const calls = [];
  const client = {
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: { ok: true, id: "fb-1" }, error: null };
    },
  };
  const result = await submitMyFeedback(
    { category: "bug", body: "The board tiles overlap on a small phone." },
    client
  );
  assert.equal(result.ok, true);
  assert.equal(result.id, "fb-1");
  assert.equal(calls[0].name, "submit_my_feedback");
  assert.equal(calls[0].payload.p_category, "bug");
  assert.equal(calls[0].payload.p_player_id, undefined);
}

await assert.rejects(
  () => submitMyFeedback({ category: "bug", body: "too short" }, { rpc() { throw new Error("should not call"); } }),
  (err) => err instanceof FeedbackError && err.code === FEEDBACK_ERROR.TOO_SHORT
);

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "FEEDBACK_RATE_LIMIT", code: "P0001" } };
    },
  };
  await assert.rejects(
    () => submitMyFeedback({ category: "general", body: "The table felt too dark during night matches." }, client),
    (err) => err.code === FEEDBACK_ERROR.RATE_LIMIT
  );
}

{
  const client = {
    async rpc() {
      return { data: null, error: { message: "FEEDBACK_CATEGORY" } };
    },
  };
  await assert.rejects(
    () => submitMyFeedback({ category: "general", body: "The table felt too dark during night matches." }, client),
    (err) => err.code === FEEDBACK_ERROR.INVALID_CATEGORY
  );
}

assert.equal(isOfficialPlayStoreUrl("https://play.google.com/store/apps/details?id=com.leodomino.app"), true);
assert.equal(isOfficialPlayStoreUrl("https://example.com/leodomino"), false);
assert.equal(isOfficialAppStoreUrl("https://apps.apple.com/app/id000"), true);
assert.equal(isOfficialAppStoreUrl("http://apps.apple.com/app/id000"), false);
assert.equal(getConfiguredStoreUrl("android", { [PLAY_STORE_URL_ENV]: "" }), "");
assert.equal(getConfiguredStoreUrl("ios", { [APP_STORE_URL_ENV]: "" }), "");
assert.equal(getConfiguredStoreUrl("web", {
  [PLAY_STORE_URL_ENV]: "https://play.google.com/store/apps/details?id=com.leodomino.app",
}), "");
assert.equal(canOpenStoreListing("android", {}), false);
assert.equal(
  openConfiguredStoreListing("android", {}, () => {
    throw new Error("must not open");
  }),
  false
);

console.log("  ✓ send feedback client contract");
