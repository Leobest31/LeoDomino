/**
 * Password recovery contract — no network.
 * Run: node src/auth/passwordRecovery.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PASSWORD_RECOVERY_EVENT,
  PASSWORD_RESET_SENT_COPY_KEY,
  clearAuthCallbackUrl,
  locationLooksLikeAuthCallback,
  passwordResetRedirectTo,
} from "./passwordRecovery.js";
import { AUTH_ERROR } from "./constants.js";
import { createCloudAuth } from "./cloudAuth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

assert.equal(PASSWORD_RECOVERY_EVENT, "PASSWORD_RECOVERY");
assert.equal(PASSWORD_RESET_SENT_COPY_KEY, "auth.forgotSent");

assert.equal(
  passwordResetRedirectTo({ origin: "https://leodomino-leopips-preview.vercel.app" }),
  "https://leodomino-leopips-preview.vercel.app/"
);
assert.equal(
  passwordResetRedirectTo({ origin: "https://leodomino-testers.vercel.app/" }),
  "https://leodomino-testers.vercel.app/"
);
assert.doesNotMatch(
  passwordResetRedirectTo({ origin: "https://leodomino-leopips-preview.vercel.app" }),
  /testers|play\.leodomino|localhost:5/
);
assert.equal(
  passwordResetRedirectTo({
    origin: "https://leodomino-leopips-preview.vercel.app",
    hostname: "leodomino-leopips-preview.vercel.app",
  }),
  "https://leodomino-leopips-preview.vercel.app/"
);
assert.equal(
  passwordResetRedirectTo({ origin: "http://localhost:3000" }),
  "http://localhost:3000/",
  "local dev may still request localhost when that is the true page origin"
);
assert.doesNotMatch(
  passwordResetRedirectTo({ origin: "https://leodomino-leopips-preview.vercel.app" }),
  /localhost/
);
assert.doesNotMatch(
  read("src/auth/passwordRecovery.js"),
  /site_url|SITE_URL\s*=\s*['\"]http:\/\/localhost:3000/,
  "frontend does not hardcode Auth Site URL localhost"
);

assert.equal(locationLooksLikeAuthCallback({ search: "", hash: "" }), false);
assert.equal(locationLooksLikeAuthCallback({ search: "?code=abc", hash: "" }), true);
assert.equal(
  locationLooksLikeAuthCallback({ search: "", hash: "#access_token=x&refresh_token=y&type=recovery" }),
  true
);
assert.equal(locationLooksLikeAuthCallback({ search: "?type=signup", hash: "" }), false);

{
  let replaced = "";
  const loc = {
    href: "https://leodomino-leopips-preview.vercel.app/?code=abc#access_token=secret&type=recovery",
    pathname: "/",
    search: "?code=abc",
    hash: "#access_token=secret&type=recovery",
  };
  const historyObj = {
    state: {},
    replaceState(_s, _t, next) {
      replaced = next;
    },
  };
  assert.equal(clearAuthCallbackUrl(loc, historyObj), true);
  assert.equal(replaced, "/");
  assert.doesNotMatch(replaced, /secret|access_token|code=/);
}

{
  const calls = [];
  const auth = createCloudAuth(() => ({
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.push({ email, options });
        return { data: {}, error: null };
      },
      async updateUser(payload) {
        calls.push({ updateUser: payload });
        return { data: { user: { id: "u1", email: "a@b.co", created_at: "t" } }, error: null };
      },
      async exchangeCodeForSession(code) {
        calls.push({ exchange: code });
        return {
          data: { session: { user: { id: "u1", email: "a@b.co", created_at: "t" } } },
          error: null,
        };
      },
      async setSession() {
        return { data: { session: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
        update() {
          return this;
        },
      };
    },
    rpc: async () => ({ data: true, error: null }),
  }));

  await auth.requestPasswordReset("Play@LeoDomino.com", {
    redirectTo: "https://leodomino-leopips-preview.vercel.app/",
  });
  assert.equal(calls[0].email, "play@leodomino.com");
  assert.equal(calls[0].options.redirectTo, "https://leodomino-leopips-preview.vercel.app/");

  const recovered = await auth.consumeAuthCallback({
    href: "https://leodomino-leopips-preview.vercel.app/?code=pkce1",
    search: "?code=pkce1",
    hash: "",
  });
  assert.equal(recovered.recovered, true);
  assert.equal(calls.some((c) => c.exchange === "pkce1"), true);

  await assert.rejects(
    () => auth.updatePassword("short", "short"),
    (err) => err.code === AUTH_ERROR.PASSWORD_SHORT
  );
  await assert.rejects(
    () => auth.updatePassword("GoodPass1", "GoodPass2"),
    (err) => err.code === AUTH_ERROR.PASSWORD_MISMATCH
  );
  await auth.updatePassword("GoodPass1", "GoodPass1");
  assert.equal(calls.at(-1).updateUser.password, "GoodPass1");
}

const authPage = read("src/pages/AuthPage.jsx");
assert.match(authPage, /openForgot/, "Forgot password opens the request view");
assert.match(authPage, /requestPasswordReset/, "Forgot password calls the reset request");
assert.match(authPage, /auth\.forgotSent/, "generic success copy key is used");
assert.match(authPage, /authView === "reset"/, "Set New Password uses reset view");
assert.match(authPage, /updatePassword/, "Set New Password saves via updatePassword");
assert.doesNotMatch(authPage, /aria-disabled="true"/, "forgot control is interactive");
assert.doesNotMatch(
  authPage,
  /account exists|no account|email not found/i,
  "UI source does not enumerate accounts"
);

const provider = read("src/auth/AuthProvider.jsx");
assert.match(provider, /PASSWORD_RECOVERY/, "AuthProvider watches recovery events");
assert.match(provider, /passwordRecoveryPending/, "recovery blocks normal signed-in play");
assert.match(provider, /consumeAuthCallback/, "URL recovery is consumed on hydrate");
assert.match(provider, /setAuthView\("reset"\)/, "recovery opens Set New Password");

const app = read("src/App.jsx");
assert.match(app, /passwordRecoveryPending/, "App gates playable on recovery");
assert.match(
  app,
  /signedIn && !passwordRecoveryPending/,
  "recovery keeps Login/reset over Home"
);

const cloud = read("src/auth/cloudAuth.js");
assert.match(cloud, /resetPasswordForEmail/, "uses Supabase resetPasswordForEmail");
assert.match(cloud, /updateUser\(\{\s*password/, "password update uses Auth updateUser");
assert.doesNotMatch(cloud, /console\.(log|info|debug).*(password|Password)/, "no password logging");

const en = read("src/i18n/locales/en.js");
assert.match(en, /forgotSent:.*"If an account exists for this email/);
assert.doesNotMatch(en, /forgotSent:.*no account|not registered/i);

console.log("  ✓ password recovery contract");
