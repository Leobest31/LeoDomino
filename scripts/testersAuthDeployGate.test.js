/**
 * Testers auth deploy gate — no secrets printed.
 * Run: node scripts/testersAuthDeployGate.test.js
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPECTED_SUPABASE_PROJECT_REF,
  assertTestersAuthEnv,
  assertTestersAuthBundle,
  projectRefFromSupabaseUrl,
  isLocalOrOfflineAuthUrl,
} from "./testersAuthDeployGate.mjs";

assert.equal(EXPECTED_SUPABASE_PROJECT_REF, "cfgzemstlutsmexqmngg");
assert.equal(
  projectRefFromSupabaseUrl("https://cfgzemstlutsmexqmngg.supabase.co"),
  "cfgzemstlutsmexqmngg"
);
assert.equal(projectRefFromSupabaseUrl("https://other.supabase.co"), "other");
assert.equal(projectRefFromSupabaseUrl(""), null);
assert.equal(isLocalOrOfflineAuthUrl(""), true);
assert.equal(isLocalOrOfflineAuthUrl("http://localhost:54321"), true);
assert.equal(isLocalOrOfflineAuthUrl("https://cfgzemstlutsmexqmngg.supabase.co"), false);

assert.throws(
  () => assertTestersAuthEnv({ env: {}, root: join(tmpdir(), "missing-leodomino-auth-root") }),
  /VITE_SUPABASE_URL is MISSING/
);

assert.throws(
  () =>
    assertTestersAuthEnv({
      env: {
        VITE_SUPABASE_URL: "https://cfgzemstlutsmexqmngg.supabase.co",
        VITE_SUPABASE_ANON_KEY: "",
      },
      root: join(tmpdir(), "missing-leodomino-auth-root"),
    }),
  /VITE_SUPABASE_ANON_KEY is MISSING/
);

assert.throws(
  () =>
    assertTestersAuthEnv({
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
        VITE_SUPABASE_ANON_KEY: "x".repeat(40),
      },
      root: join(tmpdir(), "missing-leodomino-auth-root"),
    }),
  /local\/offline auth/
);

assert.throws(
  () =>
    assertTestersAuthEnv({
      env: {
        VITE_SUPABASE_URL: "https://wrongproject.supabase.co",
        VITE_SUPABASE_ANON_KEY: "x".repeat(40),
      },
      root: join(tmpdir(), "missing-leodomino-auth-root"),
    }),
  /project ref is WRONG/
);

const ok = assertTestersAuthEnv({
  env: {
    VITE_SUPABASE_URL: "https://cfgzemstlutsmexqmngg.supabase.co",
    VITE_SUPABASE_ANON_KEY: "x".repeat(40),
  },
  root: join(tmpdir(), "missing-leodomino-auth-root"),
});
assert.equal(ok.projectRef, "cfgzemstlutsmexqmngg");
assert.equal(ok.anonKeyPresent, true);

const distRoot = mkdtempSync(join(tmpdir(), "testers-auth-gate-"));
try {
  const assets = join(distRoot, "assets");
  mkdirSync(assets);
  writeFileSync(join(assets, "index-bad.js"), "console.log('no project')", "utf8");
  assert.throws(() => assertTestersAuthBundle({ distDir: distRoot }), /missing project ref/);

  writeFileSync(
    join(assets, "index-bad.js"),
    `const ref='${EXPECTED_SUPABASE_PROJECT_REF}'; createClient('https://${EXPECTED_SUPABASE_PROJECT_REF}.supabase.co','anon')`,
    "utf8"
  );
  const bundle = assertTestersAuthBundle({ distDir: distRoot });
  assert.equal(bundle.ok, true);
  assert.equal(bundle.bundles[0].projectRefPresent, true);
} finally {
  rmSync(distRoot, { recursive: true, force: true });
}

console.log("  ✓ testers auth deploy gate");
