/**
 * Local account foundation tests.
 * Run: node src/auth/auth.test.js
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DEFAULT_AVATAR_ID, LEOBEST_AVATAR_ID, PLAYER_AVATAR_IDS } from "./avatars.js";
import { countryFlag, HAITI_COUNTRY_CODE, isCountryCode } from "./countries.js";
import { ACCOUNTS_STORAGE_KEY, AUTH_ERROR } from "./constants.js";
import { AuthError, authService } from "./service.js";
import { loadAccounts, loadSession } from "./localStore.js";

if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
};

function reset() {
  memory.clear();
}

function storedRaw() {
  return memory.get(ACCOUNTS_STORAGE_KEY) || "";
}

reset();
assert.equal(await authService.getSession(), null, "starts signed out");

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "bad",
        username: "leo",
        password: "secret12",
        confirmPassword: "secret12",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.EMAIL
  );
}

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "player@leodomino.test",
        username: "a",
        password: "secret12",
        confirmPassword: "secret12",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.USERNAME
  );
}

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "player@leodomino.test",
        username: "leonord",
        password: "short",
        confirmPassword: "short",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.PASSWORD_SHORT
  );
}

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "player@leodomino.test",
        username: "leonord",
        password: "password",
        confirmPassword: "password",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.PASSWORD_WEAK
  );
}

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "player@leodomino.test",
        username: "leonord",
        password: "secret12",
        confirmPassword: "secret13",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.PASSWORD_MISMATCH
  );
}

const created = await authService.createAccount({
  email: "Player@LeoDomino.test",
  username: "  Leonard   B   Philostin  ",
  password: "secret12",
  confirmPassword: "secret12",
  countryCode: "HT",
});

assert.equal(created.email, "player@leodomino.test");
assert.equal(created.username, "Leonard B Philostin");
assert.equal(created.displayName, "Leonard B Philostin");
assert.match(created.playerId, /^leo_[a-f0-9]{12}$/);
assert.equal("password" in created, false, "public account has no password field");
assert.notEqual(created.displayName, created.playerId, "visible name is not the unique account id");

const raw = storedRaw();
assert.equal(raw.includes("secret12"), false, "plaintext password is not stored");
assert.equal(JSON.parse(raw)[0].password.hash.length > 20, true);
assert.equal(JSON.parse(raw)[0].password.salt.length > 8, true);
assert.equal(JSON.parse(raw)[0].playerId, created.playerId);

const session = await authService.getSession();
assert.equal(session.playerId, created.playerId);
assert.equal(session.displayName, "Leonard B Philostin");
assert.equal(loadSession().playerId, created.playerId);
assert.equal(typeof loadSession().token, "string");
assert.equal(loadSession().token.includes("secret12"), false);

const duplicateName = await authService.createAccount({
  email: "other@leodomino.test",
  username: "Leonard B Philostin",
  password: "secret12",
  confirmPassword: "secret12",
  countryCode: "US",
});
assert.equal(duplicateName.displayName, "Leonard B Philostin");
assert.notEqual(duplicateName.playerId, created.playerId, "same visible name keeps a distinct playerId");

await assert.rejects(
  () =>
    authService.createAccount({
      email: "player@leodomino.test",
      username: "Other Player",
      password: "secret12",
      confirmPassword: "secret12",
      countryCode: "HT",
    }),
  (error) => error instanceof AuthError && error.code === AUTH_ERROR.EMAIL_TAKEN
);

await authService.logout();
assert.equal(await authService.getSession(), null);
assert.equal(loadSession(), null);
assert.equal(loadAccounts().length, 2, "logout keeps the local account records");

await assert.rejects(
  () => authService.login({ email: "player@leodomino.test", password: "wrongpass1" }),
  (error) => error instanceof AuthError && error.code === AUTH_ERROR.CREDENTIALS
);

const loggedIn = await authService.login({
  email: "player@leodomino.test",
  password: "secret12",
});
assert.equal(loggedIn.playerId, created.playerId);
assert.equal((await authService.getSession()).displayName, "Leonard B Philostin");
assert.equal((await authService.getSession()).playerId, created.playerId);

{
  await assert.rejects(
    () =>
      authService.createAccount({
        email: "unsafe@leodomino.test",
        username: "Leo<script>",
        password: "secret12",
        confirmPassword: "secret12",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.USERNAME
  );
}

assert.equal(created.countryCode, "HT");
assert.equal(created.avatarId, DEFAULT_AVATAR_ID, "Create Account uses a default avatar");
assert.equal((await authService.getSession()).avatarId, DEFAULT_AVATAR_ID);

{
  const ids = PLAYER_AVATAR_IDS;
  assert.ok(ids.length >= 20, "starter collection has at least 20 portraits");
  assert.equal(new Set(ids).size, ids.length, "avatar ids are unique");
  assert.equal(ids.includes(DEFAULT_AVATAR_ID), true);
  assert.equal(ids.includes(LEOBEST_AVATAR_ID), false, "LeoBest lion is not selectable");
  assert.equal(isCountryCode(HAITI_COUNTRY_CODE), true, "Haiti is in the country list");
  assert.equal(countryFlag("HT"), "🇭🇹");
}

{
  const chosen = PLAYER_AVATAR_IDS[4];
  const withAvatar = await authService.createAccount({
    email: "avatar@leodomino.test",
    username: "Amina Player",
    avatarId: chosen,
    password: "secret12",
    confirmPassword: "secret12",
    countryCode: "HT",
  });
  assert.equal(withAvatar.avatarId, chosen);
  assert.equal(withAvatar.playerId.startsWith("leo_"), true);
  await authService.logout();
  const restored = await authService.login({
    email: "avatar@leodomino.test",
    password: "secret12",
  });
  assert.equal(restored.avatarId, chosen, "selected avatar persists after logout/login");
  assert.equal(JSON.parse(storedRaw()).find((row) => row.playerId === restored.playerId).avatarId, chosen);
  const fallback = await authService.createAccount({
    email: "fallback@leodomino.test",
    username: "Fallback Player",
    avatarId: "not-a-real-avatar",
    password: "secret12",
    confirmPassword: "secret12",
    countryCode: "BR",
  });
  assert.equal(fallback.avatarId, DEFAULT_AVATAR_ID, "unknown avatar id falls back to the default");
  assert.equal(fallback.countryCode, "BR");

  const missingCountry = await assert.rejects(
    () =>
      authService.createAccount({
        email: "nocountry@leodomino.test",
        username: "No Country",
        password: "secret12",
        confirmPassword: "secret12",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.COUNTRY
  );
  void missingCountry;

  const renamed = await authService.updateProfile({
    username: "Leonard B Philostin",
    avatarId: PLAYER_AVATAR_IDS[11],
    countryCode: "HT",
  });
  assert.equal(renamed.displayName, "Leonard B Philostin");
  assert.equal(renamed.avatarId, PLAYER_AVATAR_IDS[11]);
  assert.equal(renamed.countryCode, "HT");
  assert.equal(renamed.playerId, fallback.playerId);
}

console.log("  ✓ Local account foundation");
