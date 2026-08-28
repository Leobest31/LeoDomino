/**
 * 13+ account age-gate parsing. Does not collect date of birth.
 * Run: node src/auth/accountAge.test.js
 */
import assert from "node:assert/strict";
import { ACCOUNT_MAX_AGE, ACCOUNT_MIN_AGE, AUTH_ERROR } from "./constants.js";
import { parseAccountAge, publicAccount, validateAccountAge } from "./validation.js";

assert.equal(ACCOUNT_MIN_AGE, 13);
assert.equal(ACCOUNT_MAX_AGE, 120);

assert.equal(validateAccountAge(""), AUTH_ERROR.REQUIRED);
assert.equal(validateAccountAge("   "), AUTH_ERROR.REQUIRED);
assert.equal(validateAccountAge("12"), AUTH_ERROR.AGE_UNDER);
assert.equal(validateAccountAge("13"), null);
assert.equal(validateAccountAge("17"), null);
assert.equal(validateAccountAge("18"), null);
assert.equal(validateAccountAge("25"), null);
assert.equal(validateAccountAge("13.5"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("13.0"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("abc"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("1e2"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("-1"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("0"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("013"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("121"), AUTH_ERROR.AGE);
assert.equal(validateAccountAge("12a"), AUTH_ERROR.AGE);

assert.deepEqual(parseAccountAge("13"), { age: 13 });
assert.deepEqual(parseAccountAge("120"), { age: 120 });

const published = publicAccount({
  playerId: "leo_test",
  email: "player@leodomino.test",
  username: "leonardb",
  displayName: "Leonard",
  avatarId: "marcus",
  countryCode: "HT",
  createdAt: "2026-08-28T00:00:00.000Z",
  age: 25,
});
assert.equal("age" in published, false, "public session does not retain numeric age");

console.log("  ✓ account age gate parsing");
