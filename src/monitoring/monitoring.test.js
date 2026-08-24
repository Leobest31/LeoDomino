import assert from "node:assert/strict";
import { REDACTED, sanitizeEvent, sanitizeValue } from "./sanitize.js";
import { pickSafeMetadata } from "./safeMeta.js";
import { isExpectedError, isReportableError } from "./expectedErrors.js";
import { addSafeBreadcrumb, reportError, setMonitoringClient } from "./client.js";

const captured = [];
setMonitoringClient({
  captureException(error, context) {
    captured.push({ error, context });
  },
  addBreadcrumb(crumb) {
    captured.push({ breadcrumb: crumb });
  },
  setTag() {},
});

const fakeJwt =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFBPJVDuVKc";
const fakeOtp = "123456";
const fakeEmail = "player.one@leodomino.test";
const fakePhone = "15551234567";
const fakeChat = "meet me after the match at the club";
const fakeOpponentHand = ["6-6", "5-5", "4-3"];
const fakeReserveIds = ["0-0", "1-2", "3-6"];
const fakeGameState = {
  engineState: { turn: 1 },
  hands: { 0: ["6-6"], 1: fakeOpponentHand },
  reserve: fakeReserveIds,
  seed: 987654321,
};

const dirty = {
  password: "SuperSecret9x",
  otp: fakeOtp,
  access_token: fakeJwt,
  refresh_token: "refresh-token-value",
  jwt: fakeJwt,
  authorization: `Bearer ${fakeJwt}`,
  cookie: "sb-access-token=abc",
  service_role: "sb_secret_not_a_real_key",
  email: fakeEmail,
  phone: fakePhone,
  chat: fakeChat,
  opponent_hand: fakeOpponentHand,
  reserve: fakeReserveIds,
  seed: 987654321,
  gameState: fakeGameState,
  note: `token ${fakeJwt} email ${fakeEmail} phone ${fakePhone}`,
};

const clean = sanitizeValue(dirty);
assert.equal(clean.password, REDACTED);
assert.equal(clean.otp, REDACTED);
assert.equal(clean.access_token, REDACTED);
assert.equal(clean.refresh_token, REDACTED);
assert.equal(clean.jwt, REDACTED);
assert.equal(clean.authorization, REDACTED);
assert.equal(clean.cookie, REDACTED);
assert.equal(clean.service_role, REDACTED);
assert.equal(clean.email, REDACTED);
assert.equal(clean.phone, REDACTED);
assert.equal(clean.chat, REDACTED);
assert.equal(clean.opponent_hand, REDACTED);
assert.equal(clean.reserve, REDACTED);
assert.equal(clean.seed, REDACTED);
assert.equal(clean.gameState, REDACTED);
assert.equal(String(clean.note).includes(fakeJwt), false);
assert.equal(String(clean.note).includes(fakeEmail), false);
assert.equal(String(clean.note).includes("5551234567"), false);
assert.equal(JSON.stringify(clean).includes("6-6"), false);
assert.equal(JSON.stringify(clean).includes("987654321"), false);

const event = sanitizeEvent({
  extra: dirty,
  contexts: { gameplay: fakeGameState },
  breadcrumbs: {
    values: [
      {
        message: "entered Find Match",
        data: {
          chat: fakeChat,
          authorization: `Bearer ${fakeJwt}`,
          url: `https://x.test/?access_token=${fakeJwt}`,
        },
      },
    ],
  },
  request: {
    url: `https://x.test/auth?email=${encodeURIComponent(fakeEmail)}`,
    headers: { authorization: `Bearer ${fakeJwt}`, cookie: "a=1" },
    data: { otp: fakeOtp, password: "x" },
    query_string: `refresh_token=secret&otp=${fakeOtp}`,
  },
  user: { email: fakeEmail, id: "player-aaaaaaaa" },
});

const blob = JSON.stringify(event);
assert.equal(blob.includes(fakeJwt), false, "JWT must not survive sanitization");
assert.equal(blob.includes(fakeEmail), false, "email must not survive sanitization");
assert.equal(blob.includes(fakeOtp), false, "OTP must not survive sanitization");
assert.equal(blob.includes(fakeChat), false, "chat must not survive sanitization");
assert.equal(blob.includes("6-6"), false, "hidden tile ids must not survive sanitization");
assert.equal(event.request.headers.authorization, REDACTED);
assert.equal(event.request.headers.cookie, REDACTED);
assert.equal(event.user?.email, undefined);

const safe = pickSafeMetadata({
  appVersion: "1.0.0",
  platform: "android",
  mode: "online",
  ruleset: "haitian",
  matchId: "11111111-2222-3333-4444-555555555555",
  matchVersion: 4,
  actionName: "play",
  backendErrorCode: "MALFORMED_PROJECTION",
  opponentHand: fakeOpponentHand,
  gameState: fakeGameState,
  password: "nope",
});
assert.equal(safe.mode, "online");
assert.equal(safe.platform, "android");
assert.equal(safe.ruleset, "haitian");
assert.equal(safe.matchVersion, 4);
assert.equal(safe.actionName, "play");
assert.equal(safe.backendErrorCode, "MALFORMED_PROJECTION");
assert.equal(safe.opponentHand, undefined);
assert.equal(safe.gameState, undefined);
assert.equal(safe.password, undefined);

assert.equal(isExpectedError({ code: "STALE_VERSION" }), true);
assert.equal(isExpectedError({ code: "MATCH_NOT_FOUND" }), true);
assert.equal(isExpectedError({ code: "WRONG_TURN" }), true);
assert.equal(isExpectedError({ code: "ILLEGAL_TILE" }), true);
assert.equal(isExpectedError({ code: "ILLEGAL_PLACEMENT" }), true);
assert.equal(isReportableError({ code: "MALFORMED_PROJECTION" }), true);
assert.equal(isReportableError({ code: "RECONSTRUCT_FAILED" }), true);
assert.equal(isReportableError({ code: "STALE_VERSION" }), false);

captured.length = 0;
assert.equal(reportError({ code: "STALE_VERSION", message: "expected" }), false);
assert.equal(reportError({ code: "MATCH_NOT_FOUND" }), false);
assert.equal(reportError({ code: "ILLEGAL_PLACEMENT" }), false);
assert.equal(captured.length, 0, "expected errors must not be reported");

assert.equal(reportError({ code: "MALFORMED_PROJECTION", message: "bad view" }, { matchId: "abc" }), true);
assert.equal(reportError({ code: "RECONSTRUCT_FAILED" }, { screen: "game" }), true);
assert.equal(captured.length, 2, "reportable errors must reach the monitoring layer");
assert.equal(captured[0].context.extra.opponentHand, undefined);
assert.equal(JSON.stringify(captured).includes("6-6"), false);

captured.length = 0;
addSafeBreadcrumb("entered Find Match", { screen: "findMatch", ruleset: "haitian" });
addSafeBreadcrumb("attempted play", { actionName: "play", opponentHand: fakeOpponentHand });
assert.equal(captured[0].breadcrumb.message, "entered Find Match");
assert.equal(captured[1].breadcrumb.data.opponentHand, undefined);

console.log("monitoring sanitizer and reporting tests passed.");
