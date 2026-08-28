/**
 * Cloud auth adapter tests — mocked Supabase, no network.
 * Run: node src/auth/cloudAuth.test.js
 */
import assert from "node:assert/strict";
import { AUTH_ERROR } from "./constants.js";
import { AuthError } from "./errors.js";
import { accountFromUser, createCloudAuth, isUsernameInvalidError, isUsernameTakenError } from "./cloudAuth.js";
import { DEFAULT_AVATAR_ID } from "./avatars.js";

const UUID = "11111111-2222-4333-8444-555555555555";

function userRecord(overrides = {}) {
  return {
    id: UUID,
    email: "player@leodomino.test",
    created_at: "2026-08-21T12:00:00.000Z",
    user_metadata: {
      username: "leonardb",
      displayName: "Leonard B Philostin",
      avatarId: DEFAULT_AVATAR_ID,
      countryCode: "HT",
    },
    ...overrides,
  };
}

function profileBuilder(result = { data: null, error: null }) {
  const builder = {
    select() {
      return builder;
    },
    update() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
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
    from(_table) {
      if (handlers.from) return handlers.from(_table);
      return profileBuilder({
        data: {
          username: "leonardb",
          display_name: "Leonard B Philostin",
          avatar_id: DEFAULT_AVATAR_ID,
          country_code: "HT",
        },
        error: null,
      });
    },
    rpc(name, args) {
      if (handlers.rpc) return handlers.rpc(name, args);
      return Promise.resolve({ data: true, error: null });
    },
  };
}

{
  const account = accountFromUser(userRecord());
  assert.equal(account.playerId, UUID, "cloud identity is the Auth user UUID");
  assert.doesNotMatch(account.playerId, /^leo_/, "cloud identity is not a client-generated leo_ id");
  assert.equal("password" in account, false);
  assert.equal(account.email, "player@leodomino.test");
  assert.equal(account.username, "leonardb");
  assert.equal(account.displayName, "Leonard B Philostin");
  assert.equal(account.countryCode, "HT");
}

{
  const supabase = mockClient({
    async signUp({ email, password, options }) {
      assert.equal(email, "player@leodomino.test");
      assert.equal(password, "Secret12ab");
      assert.equal(options.data.username, "leonardb");
      assert.equal(options.data.displayName, "Leonard B Philostin");
      assert.equal(options.data.avatarId, DEFAULT_AVATAR_ID);
      assert.equal(options.data.countryCode, "HT");
      assert.equal(options.data.accountAge, "25");
      assert.equal("age" in options.data, false, "signup metadata uses accountAge, not age");
      const user = userRecord();
      return { data: { user, session: { user, access_token: "jwt-access" } }, error: null };
    },
  });
  const auth = createCloudAuth(() => supabase);
  const created = await auth.createAccount({
    email: "Player@LeoDomino.test",
    username: "LeonardB",
    displayName: "  Leonard   B   Philostin  ",
    password: "Secret12ab",
    confirmPassword: "Secret12ab",
    countryCode: "HT",
    age: 25,
  });
  assert.equal(created.playerId, UUID);
  assert.equal(created.displayName, "Leonard B Philostin");
  assert.equal(created.username, "leonardb");
  assert.equal("age" in created, false);
  assert.equal("accountAge" in created, false);
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
        age: 25,
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
        age: 25,
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
  const writes = [];
  let storedUsername = null;
  const user = userRecord({
    user_metadata: {
      username: "lbest",
      displayName: "Lbest",
      avatarId: DEFAULT_AVATAR_ID,
      countryCode: "HT",
    },
  });
  const supabase = mockClient({
    async getSession() {
      return { data: { session: { user } }, error: null };
    },
    rpc(name, args) {
      assert.equal(name, "is_username_available");
      assert.equal(args.p_username, "lbest");
      return Promise.resolve({ data: true, error: null });
    },
    from() {
      const builder = {
        select() {
          return builder;
        },
        update(payload) {
          writes.push(payload);
          if (payload?.username) storedUsername = payload.username;
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              username: storedUsername,
              display_name: "Lbest",
              avatar_id: DEFAULT_AVATAR_ID,
              country_code: "HT",
            },
            error: null,
          });
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  });
  const auth = createCloudAuth(() => supabase);
  const session = await auth.getSession();
  assert.equal(session.username, "lbest");
  assert.equal(writes.some((row) => row?.username === "lbest"), true, "metadata username is claimed onto profiles.username");
}

{
  const tombstoned = accountFromUser(userRecord(), {
    username: null,
    display_name: "Deleted player",
    avatar_id: "marcus",
    country_code: "",
    deleted_at: "2026-08-28T12:00:00.000Z",
  });
  assert.equal(tombstoned.deletionPending, true);
  assert.equal(tombstoned.username, "");
  assert.equal(tombstoned.displayName, "Deleted player");
  assert.equal(tombstoned.countryCode, "");
}

{
  const user = userRecord();
  const tombstoneRow = {
    username: null,
    display_name: "Deleted player",
    avatar_id: "marcus",
    country_code: "",
    deleted_at: "2026-08-28T12:00:00.000Z",
  };
  const supabase = mockClient({
    async getSession() {
      return { data: { session: { user } }, error: null };
    },
    rpc() {
      throw new Error("tombstoned session must not claim a username");
    },
    from() {
      return profileBuilder({ data: tombstoneRow, error: null });
    },
  });
  const auth = createCloudAuth(() => supabase);
  const session = await auth.getSession();
  assert.equal(session.deletionPending, true);
  assert.equal(session.username, "");
  assert.equal(session.displayName, "Deleted player");
  await assert.rejects(
    () => auth.updateProfile({ username: "leonardb", displayName: "Leonard", countryCode: "HT" }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.ACCOUNT_DELETED
  );
}

{
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./cloudAuth.js", import.meta.url), "utf8")
  );
  assert.match(source, /signupMetadata/);
  assert.match(source, /accountAge: String\(accountAge\)/);
  assert.match(source, /updateUser\(\{\s*data: profileMetadata/);
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

{
  assert.equal(isUsernameTakenError({ message: "duplicate key value violates unique constraint profiles_username_unique" }), true);
  assert.equal(isUsernameInvalidError({ message: "username is required" }), true);
  assert.equal(isUsernameInvalidError({ message: "invalid username" }), true);
  assert.equal(isUsernameInvalidError({ message: "username cannot be cleared" }), true);
}

{
  const auth = createCloudAuth(() =>
    mockClient({
      async signUp() {
        return { data: { user: null, session: null }, error: { message: "username is required" } };
      },
    })
  );
  await assert.rejects(
    () =>
      auth.createAccount({
        email: "player@leodomino.test",
        username: "leonard",
        password: "Secret12ab",
        confirmPassword: "Secret12ab",
        countryCode: "HT",
        age: 25,
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.USERNAME
  );
}

{
  let signedUp = false;
  const auth = createCloudAuth(() =>
    mockClient({
      async signUp() {
        signedUp = true;
        return { data: { user: null, session: null }, error: null };
      },
    })
  );
  await assert.rejects(
    () =>
      auth.createAccount({
        email: "player@leodomino.test",
        username: "leonard",
        password: "Secret12ab",
        confirmPassword: "Secret12ab",
        countryCode: "HT",
        age: 12,
      }),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR.AGE_UNDER && error.field === "age"
  );
  assert.equal(signedUp, false, "under-13 registration never reaches Auth signUp");
}

console.log("  ✓ Cloud auth adapter");
