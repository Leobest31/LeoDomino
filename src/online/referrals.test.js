/**
 * Invite & Win client contract. Run: node src/online/referrals.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_APP_URL_ENV,
  ReferralError,
  applyPendingReferralAttribution,
  buildReferralLink,
  capturePendingReferralFromWindow,
  clearPendingReferralCode,
  copyText,
  ensureMyReferralCode,
  getAppOrigin,
  normalizeReferralCode,
  parseReferralCodeFromHref,
  readPendingReferralCode,
  referralNoticeKey,
  shareReferralInvite,
  writePendingReferralCode,
} from "./referrals.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/referrals.js"), "utf8");
const main = readFileSync(join(root, "src/main.jsx"), "utf8");
const provider = readFileSync(join(root, "src/auth/AuthProvider.jsx"), "utf8");
const example = readFileSync(join(root, ".env.example"), "utf8");

assert.equal(PUBLIC_APP_URL_ENV, "VITE_PUBLIC_APP_URL");
assert.match(example, /^VITE_PUBLIC_APP_URL=$/m);
assert.doesNotMatch(source, /trycloudflare/i);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role/i);
assert.match(main, /capturePendingReferralFromWindow/);
assert.match(provider, /applyPendingReferralAttribution/);
assert.match(source, /ensure_my_referral_code/);
assert.match(source, /apply_referral_code/);
assert.doesNotMatch(source, /status:\s*'validated'|pending -> validated/i);

assert.equal(normalizeReferralCode("abcd2345"), "ABCD2345");
assert.equal(normalizeReferralCode("ABCD2345"), "ABCD2345");
assert.equal(normalizeReferralCode("abc"), "");
assert.equal(normalizeReferralCode("IIIIIIII"), "");

assert.equal(parseReferralCodeFromHref("https://play.leodomino.com/invite?ref=abcd2345"), "ABCD2345");
assert.equal(parseReferralCodeFromHref("https://play.leodomino.com/invite/ABCD2345"), "ABCD2345");
assert.equal(parseReferralCodeFromHref("https://play.leodomino.com/#ref=ABCD2345"), "ABCD2345");
assert.equal(parseReferralCodeFromHref("https://play.leodomino.com/"), "");

{
  const origin = getAppOrigin({
    env: { VITE_PUBLIC_APP_URL: "https://play.leodomino.com/" },
    location: { origin: "https://random-name.trycloudflare.com" },
  });
  assert.equal(origin, "https://play.leodomino.com");
  assert.equal(
    buildReferralLink("ABCD2345", {
      env: { VITE_PUBLIC_APP_URL: "https://play.leodomino.com" },
    }),
    "https://play.leodomino.com/invite?ref=ABCD2345"
  );
}

{
  const origin = getAppOrigin({
    env: { VITE_PUBLIC_APP_URL: "" },
    location: { origin: "https://leodomino.app" },
  });
  assert.equal(origin, "https://leodomino.app");
}

{
  const origin = getAppOrigin({
    env: { VITE_PUBLIC_APP_URL: "" },
    location: { origin: "capacitor://localhost" },
  });
  assert.equal(origin, "");
}

function memoryWin(href = "https://play.leodomino.com/invite?ref=abcd2345") {
  const store = new Map();
  return {
    location: { href, pathname: "/invite", search: "?ref=abcd2345", hash: "", origin: "https://play.leodomino.com" },
    history: { state: null, replaceState(_state, _title, url) { this.last = url; } },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
    },
  };
}

{
  const win = memoryWin();
  assert.equal(capturePendingReferralFromWindow(win), "ABCD2345");
  assert.equal(readPendingReferralCode(win), "ABCD2345");
  assert.equal(writePendingReferralCode("ABCD2345", win), "ABCD2345");
  assert.equal(readPendingReferralCode(win), "ABCD2345");
}

{
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, "ensure_my_referral_code");
      return { data: "ABCD2345", error: null };
    },
  };
  const first = await ensureMyReferralCode(client);
  const second = await ensureMyReferralCode(client);
  assert.equal(first, "ABCD2345");
  assert.equal(second, "ABCD2345");
  assert.equal(calls.length, 2);
}

{
  const win = memoryWin();
  writePendingReferralCode("ABCD2345", win);
  const result = await applyPendingReferralAttribution({ win, ownCode: "ABCD2345" });
  assert.equal(result.status, "self");
  assert.equal(result.noticeKey, "referral.self");
  assert.equal(readPendingReferralCode(win), "");
}

{
  const win = memoryWin();
  writePendingReferralCode("WXYZ6789", win);
  const client = {
    async rpc(name, args) {
      assert.equal(name, "apply_referral_code");
      assert.equal(args.p_code, "WXYZ6789");
      return { data: "ref-1", error: null };
    },
  };
  const result = await applyPendingReferralAttribution({ win, client, ownCode: "ABCD2345" });
  assert.equal(result.status, "applied");
  assert.equal(result.noticeKey, "referral.applied");
  assert.equal(readPendingReferralCode(win), "");
}

{
  const win = memoryWin();
  writePendingReferralCode("WXYZ6789", win);
  const client = {
    async rpc() {
      return { data: null, error: { message: "cannot refer yourself" } };
    },
  };
  try {
    await ensureMyReferralCode(client);
    assert.fail("expected throw");
  } catch (error) {
    if (error instanceof ReferralError) {
      assert.equal(referralNoticeKey(error.code), "referral.self");
    }
  }
}

{
  const win = memoryWin();
  writePendingReferralCode("WXYZ6789", win);
  const client = {
    async rpc() {
      return { data: null, error: { message: "referrer already locked" } };
    },
  };
  const result = await applyPendingReferralAttribution({ win, client, ownCode: "ABCD2345" });
  assert.equal(result.status, "rejected");
  assert.equal(result.noticeKey, "referral.alreadyLocked");
  assert.equal(readPendingReferralCode(win), "");
}

{
  const win = memoryWin();
  writePendingReferralCode("WXYZ6789", win);
  const client = {
    async rpc() {
      return { data: null, error: { message: "referral window expired" } };
    },
  };
  const result = await applyPendingReferralAttribution({ win, client, ownCode: "ABCD2345" });
  assert.equal(result.status, "rejected");
  assert.equal(result.noticeKey, "referral.windowExpired");
  assert.equal(readPendingReferralCode(win), "");
}

{
  let shared;
  const result = await shareReferralInvite({
    title: "LeoDomino",
    text: "Play LeoDomino with me!",
    url: "https://play.leodomino.com/invite?ref=ABCD2345",
    share: async (payload) => {
      shared = payload;
    },
  });
  assert.equal(result, "shared");
  assert.equal(shared.url, "https://play.leodomino.com/invite?ref=ABCD2345");
  assert.match(shared.text, /Play LeoDomino with me!/);
}

{
  const copied = [];
  const result = await shareReferralInvite({
    title: "LeoDomino",
    text: "Play LeoDomino with me!",
    url: "https://play.leodomino.com/invite?ref=ABCD2345",
    share: undefined,
  });
  const ok = await copyText("ABCD2345", { writeText: async (value) => copied.push(value) });
  assert.equal(ok, true);
  assert.equal(copied[0], "ABCD2345");
  assert.ok(result === "copied" || result === "failed");
}

{
  const copied = [];
  const result = await shareReferralInvite({
    title: "LeoDomino",
    text: "Play LeoDomino with me!",
    url: "https://play.leodomino.com/invite?ref=ABCD2345",
    share: async () => {
      const error = new Error("not allowed");
      error.name = "NotAllowedError";
      throw error;
    },
  });
  const ok = await copyText("https://play.leodomino.com/invite?ref=ABCD2345", {
    writeText: async (value) => copied.push(value),
  });
  assert.ok(result === "copied" || result === "failed");
  assert.equal(ok, true);
  assert.equal(copied[0], "https://play.leodomino.com/invite?ref=ABCD2345");
}

{
  const result = await shareReferralInvite({
    title: "LeoDomino",
    text: "Play LeoDomino with me!",
    url: "https://play.leodomino.com/invite?ref=ABCD2345",
    share: async () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(result, "cancelled");
}

{
  const result = await shareReferralInvite({
    title: "LeoDomino",
    text: "Play LeoDomino with me!",
    url: "https://play.leodomino.com/invite?ref=ABCD2345",
    share: async () => {
      const error = new Error("not allowed");
      error.name = "NotAllowedError";
      throw error;
    },
  });
  assert.ok(result === "copied" || result === "failed");
}

{
  await assert.doesNotReject(async () => {
    const ok = await copyText("ABCD2345", {
      writeText: async () => {
        throw new Error("clipboard denied");
      },
    });
    assert.equal(typeof ok, "boolean");
  });
}

clearPendingReferralCode(memoryWin());
console.log("  ✓ referral client contract");
