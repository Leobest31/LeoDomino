/**
 * Invite Friends / referral UI contract.
 * Run: node src/ui/referralInvite.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const home = read("pages/HomePage.jsx");
const profile = read("components/ProfilePanel.jsx");
const app = read("App.jsx");
const main = read("main.jsx");
const provider = read("auth/AuthProvider.jsx");
const referrals = read("online/referrals.js");
const hook = read("hooks/useReferralInvite.js");
const en = read("i18n/locales/en.js");

assert.match(home, /data-home-cta="inviteFriends"/);
assert.match(home, /referral\.inviteFriends/);
assert.match(home, /useReferralInvite/);
assert.match(home, /id="friend"/);
assert.match(home, /onPress=\{showComingSoon\}/);
assert.doesNotMatch(home, /id="friend"[\s\S]{0,200}inviteFriends/);

assert.match(profile, /data-referral="true"/);
assert.match(profile, /data-referral-code="true"/);
assert.match(profile, /data-referral-copy="true"/);
assert.match(profile, /data-referral-invite="true"/);
assert.match(profile, /referral\.yourCode/);
assert.match(profile, /referral\.inviteFriends/);

assert.match(app, /capturePendingReferralFromWindow/);
assert.match(main, /capturePendingReferralFromWindow/);
assert.match(provider, /applyPendingReferralAttribution/);
assert.match(hook, /ensureMyReferralCode/);
assert.match(hook, /shareReferralInvite/);
assert.match(hook, /reportError\(error/);
assert.match(hook, /inviteLockRef/);
assert.match(hook, /referral\.shareFailed/);
assert.match(hook, /referral\.preparing/);
assert.match(referrals, /noticeAfterReferralCodeLoad/);
assert.match(referrals, /noticeForInviteFriendsOutcome/);
assert.match(hook, /noticeNonce/);
assert.match(home, /referral\.noticeNonce/);
assert.match(home, /void referral\.inviteFriends\(\)/);
assert.match(home, /referral\.noticeNonce > 0/);
assert.match(referrals, /VITE_PUBLIC_APP_URL/);
assert.match(referrals, /apply_referral_code/);
assert.match(referrals, /AbortError/);
assert.match(referrals, /execCommand/);
assert.match(referrals, /globalThis\.location/);
assert.match(referrals, /canShare/);
assert.doesNotMatch(referrals, /trycloudflare/i);
assert.doesNotMatch(referrals, /SERVICE_ROLE|service_role/i);
assert.doesNotMatch(en, /trycloudflare/i);
assert.match(en, /shareText: "Play LeoDomino with me!"/);
assert.match(en, /inviteFriends: "Invite Friends"/);
assert.match(en, /linkCopied: "Invite link copied."/);
assert.match(en, /shareFailed:/);
assert.match(en, /preparing:/);

console.log("  ✓ referral invite UI contract");
