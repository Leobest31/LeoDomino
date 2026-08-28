/**
 * Account deletion client contract. No network.
 * Run: node src/online/accountDeletion.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import { AUTH_ERROR } from "../auth/constants.js";
import { clearAccountLocalData, deleteMyAccount } from "./accountDeletion.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/accountDeletion.js"), "utf8");
const cloudAuth = readFileSync(join(root, "src/auth/cloudAuth.js"), "utf8");
const rankSql = readFileSync(
  join(root, "supabase/migrations/20260828230000_account_deletion.sql"),
  "utf8"
);

assert.doesNotMatch(source, /DELETE_ACCOUNT_CONFIRM_WORD/);
assert.match(source, /functions\.invoke\("delete-account"/);
assert.match(source, /body: \{ password \}/);
assert.match(source, /signInWithPassword/);
assert.match(source, /INVALID_PASSWORD/);
assert.doesNotMatch(source, /user_id|userId|p_user_id/);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role/);
assert.match(source, /AUTH_DELETE_FAILED/);
assert.doesNotMatch(source, /MATCH_ACTIVE/);
assert.match(source, /SERVER_MISCONFIGURED/);
assert.match(source, /payloadFromInvokeError|context\.json/);
assert.match(cloudAuth, /deleteMyAccount\(client\(\), password\)/);
assert.match(cloudAuth, /clearAccountLocalData\(\)/);
assert.match(cloudAuth, /profileRow\?\.deleted_at/, "session restore reads tombstone");
assert.match(cloudAuth, /if \(profileRow\?\.deleted_at\) return profileRow/, "does not restore username");
assert.ok(
  cloudAuth.indexOf("await deleteMyAccount") < cloudAuth.indexOf("clearAccountLocalData()"),
  "local data clears only after Auth deletion succeeds"
);
assert.match(rankSql, /p\.deleted_at IS NULL/);

function authOk() {
  return {
    async getUser() {
      return { data: { user: { id: "u1", email: "player@leodomino.test" } }, error: null };
    },
    async signInWithPassword({ password }) {
      if (password !== "Secret12ab") {
        return { data: { user: null }, error: { message: "Invalid login credentials" } };
      }
      return { data: { user: { id: "u1", email: "player@leodomino.test" } }, error: null };
    },
  };
}

{
  const calls = [];
  const client = {
    auth: authOk(),
    functions: {
      async invoke(name, payload) {
        calls.push({ name, payload });
        return { data: { ok: true }, error: null };
      },
    },
  };
  const result = await deleteMyAccount(client, "Secret12ab");
  assert.equal(result.ok, true);
  assert.equal(calls[0].name, "delete-account");
  assert.deepEqual(calls[0].payload.body, { password: "Secret12ab" });
}

{
  const calls = [];
  const client = {
    auth: authOk(),
    functions: {
      async invoke(name, payload) {
        calls.push({ name, payload });
        return { data: { ok: true }, error: null };
      },
    },
  };
  await assert.rejects(
    () => deleteMyAccount(client, "Wrongpass1"),
    (err) => err.code === AUTH_ERROR.INVALID_PASSWORD
  );
  assert.equal(calls.length, 0, "wrong password never invokes delete-account");
}

{
  const calls = [];
  const client = {
    auth: authOk(),
    functions: {
      async invoke(name, payload) {
        calls.push({ name, payload });
        return { data: { ok: true }, error: null };
      },
    },
  };
  await assert.rejects(
    () => deleteMyAccount(client, ""),
    (err) => err.code === AUTH_ERROR.INVALID_PASSWORD
  );
  assert.equal(calls.length, 0, "empty password never invokes delete-account");
}

{
  const client = {
    auth: authOk(),
    functions: {
      async invoke() {
        return { data: { error: { code: "INVALID_PASSWORD", message: "INVALID_PASSWORD" } }, error: null };
      },
    },
  };
  await assert.rejects(() => deleteMyAccount(client, "Secret12ab"), (err) => err.code === AUTH_ERROR.INVALID_PASSWORD);
}

{
  const client = {
    auth: authOk(),
    functions: {
      async invoke() {
        return { data: { error: { code: "AUTH_DELETE_FAILED" } }, error: null };
      },
    },
  };
  await assert.rejects(() => deleteMyAccount(client, "Secret12ab"), (err) => err.code === AUTH_ERROR.DELETE_PENDING);
}

function non2xx(code) {
  return {
    auth: authOk(),
    functions: {
      async invoke() {
        return {
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: {
              async json() {
                return { error: { code, message: code } };
              },
            },
          },
        };
      },
    },
  };
}

await assert.rejects(
  () => deleteMyAccount(non2xx("INVALID_PASSWORD"), "Secret12ab"),
  (err) => err.code === AUTH_ERROR.INVALID_PASSWORD
);
await assert.rejects(
  () => deleteMyAccount(non2xx("AUTH_DELETE_FAILED"), "Secret12ab"),
  (err) => err.code === AUTH_ERROR.DELETE_PENDING
);
await assert.rejects(
  () => deleteMyAccount(non2xx("SERVER_MISCONFIGURED"), "Secret12ab"),
  (err) => err.code === AUTH_ERROR.DELETE_UNAVAILABLE
);
await assert.rejects(
  () => deleteMyAccount(non2xx("DELETE_FAILED"), "Secret12ab"),
  (err) => err.code === AUTH_ERROR.DELETE_FAILED
);
{
  const client = {
    auth: authOk(),
    functions: {
      async invoke() {
        return {
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: {
              async json() {
                throw new Error("not json");
              },
            },
          },
        };
      },
    },
  };
  await assert.rejects(() => deleteMyAccount(client, "Secret12ab"), (err) => err.code === AUTH_ERROR.DELETE_FAILED);
}

assert.equal(typeof clearAccountLocalData, "function");

console.log("  ✓ account deletion client contract");
