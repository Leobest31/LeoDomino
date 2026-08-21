/**
 * Cloud auth adapter tests — mocked Supabase, no network.
 * Run: node src/auth/cloudAuth.test.js
 */
import assert from "node:assert/strict";
import { AUTH_ERROR } from "./constants.js";
import { AuthError } from "./errors.js";
import { accountFromUser, createCloudAuth } from "./cloudAuth.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";

const UUID = "11111111-2222-4333-8444-555555555555";

function userRecord(overrides = {}) {
  return {
    id: UUID,
    email: "player@leodomino.test",
    created_at: "2026-08-21T12:00:00.000Z",
    user_metadata: {
      username: "Leonard B Philostin",
      displayName: "Leonard B Philostin",
      avatarId: DEFAULT_AVATAR_ID,
      countryCode: "HT",
    },
    ...overrides,
  };
}

function mockClient(handlers) {
  const listeners = [];
  return {
    listeners,
    auth: {
      async getSession() {
        return handlers.getSession();
      },
      async signUp(payload) {
        return handlers.signUp(payload);
      },
      async signInWithPassword(payload) {
        return handlers.signInWithPassword(payload);
      },
      async signOut() {
        return handlers.signOut();
      },
      async updateUser(payload) {
        return handlers.updateUser(payload);
      },
      onAuthStateChange(cb) {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  };
}

{
  const account = accountFromUser(userRecord());
  assert.equal(account.playerId, UUID, "cloud identity is the Auth user UUID");
  assert.doesNotMatch(account.playerId, /^leo_/, "cloud identity is not a client-generated leo_ id");
  assert.equal("password" in account, false);
  assert.equal(account.email, "player@leodomino.test");
  assert.equal(account.countryCode, "HT");
}

{
  const supabase = mockClient({
    async signUp({ email, password, options }) {
      assert.equal(email, "player@leodomino.test");
      assert.equal(password, "Secret12ab");
      assert.equal(options.data.username, "Leonard B Philostin");
      assert.equal(options.data.avatarId, DEFAULT_AVATAR_ID);
      assert.equal(options.data.countryCode, "HT");
      const user = userRecord();
      return { data: { user, session: { user, access_token: "jwt-access" } }, error: null };
    },
  });
  const auth = createCloudAuth(() => supabase);
  const created = await auth.createAccount({
    email: "Player@LeoDomino.test",
    username: "  Leonard   B   Philostin  ",
    password: "Secret12ab",
    confirmPassword: "Secret12ab",
    countryCode: "HT",
  });
  assert.equal(created.playerId, UUID);
  assert.equal(created.displayName, "Leonard B Philostin");
  assert.equal(JSON.stringify(created).includes("Secret12ab"), false, "password is not stored on the public account");
}

{
  const auth = createCloudAuth(() =>
    mockClient({
      async signUp() {
        return { data: { user: userRecord(), session: null }, error: null };
      },
    })
  );
  await assert.rejects(
    () =>
      auth.createAccount({
        email: "player@leodomino.test",
        username: "Leonard",
        password: "Secret12ab",
        confirmPassword: "Secret12ab",
        countryCode: "HT",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.GENERIC
  );
}

{
  const auth = createCloudAuth(() =>
    mockClient({
      async signUp() {
        return { data: { user: null, session: null }, error: { message: "User already registered" } };
      },
    })
  );
  await assert.rejects(
    () =>
      auth.createAccount({
        email: "player@leodomino.test",
        username: "Leonard",
        password: "Secret12ab",
        confirmPassword: "Secret12ab",
        countryCode: "HT",
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.EMAIL_TAKEN
  );
}

{
  const auth = createCloudAuth(() =>
    mockClient({
      async signInWithPassword({ email, password }) {
        assert.equal(email, "player@leodomino.test");
        assert.equal(password, "Secret12ab");
        const user = userRecord();
        return { data: { user, session: { user } }, error: null };
      },
    })
  );
  const loggedIn = await auth.login({ email: "player@leodomino.test", password: "Secret12ab" });
  assert.equal(loggedIn.playerId, UUID);
}

{
  const auth = createCloudAuth(() =>
    mockClient({
      async signInWithPassword() {
        return { data: { session: null }, error: { message: "Invalid login credentials", code: "invalid_credentials" } };
      },
    })
  );
  await assert.rejects(
    () => auth.login({ email: "player@leodomino.test", password: "Wrongpass1" }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.CREDENTIALS
  );
}

{
  let signedOut = false;
  const supabase = mockClient({
    async getSession() {
      return { data: { session: signedOut ? null : { user: userRecord() } }, error: null };
    },
    async signOut() {
      signedOut = true;
      return { error: null };
    },
  });
  const auth = createCloudAuth(() => supabase);
  assert.equal((await auth.getSession()).playerId, UUID, "session restore maps the Auth user");
  await auth.logout();
  assert.equal(await auth.getSession(), null, "logout clears the cloud session");
}

{
  const supabase = mockClient({
    async getSession() {
      return { data: { session: { user: userRecord() } }, error: null };
    },
  });
  const auth = createCloudAuth(() => supabase);
  const seen = [];
  const stop = auth.onAuthStateChange((next) => seen.push(next));
  supabase.listeners[0]("SIGNED_IN", { user: userRecord() });
  supabase.listeners[0]("SIGNED_OUT", null);
  assert.equal(seen[0].playerId, UUID);
  assert.equal(seen[1], null);
  stop();
}

{
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./cloudAuth.js", import.meta.url), "utf8")
  );
  assert.match(source, /signUp/);
  assert.match(source, /signInWithPassword/);
  assert.match(source, /signOut/);
  assert.match(source, /getSession/);
  assert.match(source, /onAuthStateChange/);
  assert.doesNotMatch(source, /createPlayerId/);
  assert.doesNotMatch(source, /hashPassword|PBKDF2/);
  assert.doesNotMatch(source, /saveSession/);
}

{
  const useMatch = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../hooks/useMatch.js", import.meta.url), "utf8")
  );
  const gamePage = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../pages/GamePage.jsx", import.meta.url), "utf8")
  );
  assert.doesNotMatch(useMatch, /cloudAuth|supabase/);
  assert.doesNotMatch(gamePage, /cloudAuth|supabaseClient/);
}

console.log("  ✓ Cloud auth adapter");
