/**
 * Invite & Win hook notices and share outcomes.
 * Run: node src/hooks/useReferralInvite.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  noticeAfterReferralCodeLoad,
  noticeForInviteFriendsOutcome,
} from "../online/referrals.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(join(root, "hooks/useReferralInvite.js"), "utf8");
const profile = readFileSync(join(root, "components/ProfilePanel.jsx"), "utf8");

{
  let notice = noticeAfterReferralCodeLoad(false);
  assert.equal(notice, "referral.loadError", "code-load failure still shows load error");
  notice = noticeAfterReferralCodeLoad(true, "");
  assert.equal(notice, "", "successful retry clears the stale load error");
}

{
  const notice = noticeAfterReferralCodeLoad(true, "referral.applied");
  assert.equal(notice, "referral.applied", "attribution notice survives a successful load");
}

{
  assert.equal(
    noticeForInviteFriendsOutcome({ code: "ABCD2345", url: "https://play.leodomino.com/invite?ref=ABCD2345", result: "shared" }),
    "referral.shared"
  );
  assert.equal(
    noticeForInviteFriendsOutcome({
      code: "ABCD2345",
      url: "https://play.leodomino.com/invite?ref=ABCD2345",
      result: "cancelled",
    }),
    "referral.cancelled"
  );
  assert.notEqual(
    noticeForInviteFriendsOutcome({
      code: "ABCD2345",
      url: "https://play.leodomino.com/invite?ref=ABCD2345",
      result: "cancelled",
    }),
    "referral.loadError"
  );
}

{
  assert.equal(
    noticeForInviteFriendsOutcome({ code: "ABCD2345", url: "", result: "failed" }),
    "referral.shareFailed",
    "link construction failure is not a code-load error"
  );
  assert.equal(
    noticeForInviteFriendsOutcome({ code: "", url: "", result: "failed" }),
    "referral.loadError",
    "missing code still uses the load error"
  );
}

assert.match(hook, /noticeAfterReferralCodeLoad\(true/);
assert.match(hook, /noticeAfterReferralCodeLoad\(false\)/);
assert.match(hook, /buildReferralLink\(ready\)/);
assert.match(hook, /shareReferralInvite\(/);
assert.match(hook, /url,/);
assert.doesNotMatch(
  hook,
  /if \(!url\) \{\s*showNotice\("referral\.loadError"\)/,
  "valid code never labels share/link failure as a load error"
);
assert.match(profile, /disabled=\{!referral\.code \|\| referral\.busy\}/, "COPY needs a loaded code");
assert.match(profile, /data-referral-invite="true"/);
assert.match(profile, /disabled=\{referral\.busy\}/, "INVITE FRIENDS stays available once not busy");

console.log("  ✓ referral invite hook notices");
