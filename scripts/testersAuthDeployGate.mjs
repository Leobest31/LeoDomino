/**
 * Testers frontend auth deploy gate.
 * Fails closed if hosted Auth target is missing/wrong before a testers deploy.
 * NEVER prints anon keys, JWTs, or other secret values.
 *
 * Usage:
 *   node scripts/testersAuthDeployGate.mjs env
 *   node scripts/testersAuthDeployGate.mjs bundle [distDir]
 *   node scripts/testersAuthDeployGate.mjs all [distDir]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_SUPABASE_PROJECT_REF = "cfgzemstlutsmexqmngg";
export const SUPABASE_URL_ENV = "VITE_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "VITE_SUPABASE_ANON_KEY";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  const error = new Error(message);
  error.code = "TESTERS_AUTH_GATE";
  throw error;
}

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readAuthEnv(env = process.env, root = ROOT) {
  const fileEnv = {
    ...parseDotEnv(join(root, ".env")),
    ...parseDotEnv(join(root, ".env.local")),
  };
  const url = String(env[SUPABASE_URL_ENV] || fileEnv[SUPABASE_URL_ENV] || "").trim();
  const anonKey = String(env[SUPABASE_ANON_KEY_ENV] || fileEnv[SUPABASE_ANON_KEY_ENV] || "").trim();
  return { url, anonKey };
}

export function projectRefFromSupabaseUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
  return match ? match[1].toLowerCase() : null;
}

export function isLocalOrOfflineAuthUrl(url) {
  const raw = String(url || "").trim().toLowerCase();
  if (!raw) return true;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/.test(raw);
  }
}

/**
 * @returns {{ ok: true, projectRef: string, anonKeyPresent: true, anonKeyLength: number }}
 */
export function assertTestersAuthEnv(options = {}) {
  const root = options.root || ROOT;
  const env = options.env || process.env;
  const expectedRef = options.expectedRef || EXPECTED_SUPABASE_PROJECT_REF;
  const { url, anonKey } = readAuthEnv(env, root);

  if (!url) {
    fail(`${SUPABASE_URL_ENV} is MISSING — testers deploy would fall back to local/offline auth`);
  }
  if (!anonKey) {
    fail(`${SUPABASE_ANON_KEY_ENV} is MISSING — testers deploy would fall back to local/offline auth`);
  }
  if (isLocalOrOfflineAuthUrl(url)) {
    fail(`${SUPABASE_URL_ENV} resolves to local/offline auth host — expected hosted Supabase`);
  }

  const projectRef = projectRefFromSupabaseUrl(url);
  if (!projectRef) {
    fail(`${SUPABASE_URL_ENV} is not a valid *.supabase.co URL`);
  }
  if (projectRef !== expectedRef) {
    fail(
      `${SUPABASE_URL_ENV} project ref is WRONG (got ${projectRef}, expected ${expectedRef})`
    );
  }
  if (anonKey.length < 20) {
    fail(`${SUPABASE_ANON_KEY_ENV} looks empty/too short for a hosted anon/publishable key`);
  }

  return {
    ok: true,
    projectRef,
    anonKeyPresent: true,
    anonKeyLength: anonKey.length,
  };
}

function findIndexBundles(distDir) {
  const assetsDir = join(distDir, "assets");
  if (!existsSync(assetsDir)) return [];
  return readdirSync(assetsDir)
    .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))
    .map((name) => join(assetsDir, name));
}

/**
 * Prove a production bundle targets hosted Auth for the expected project.
 * Never prints secret material — only presence / project ref checks.
 */
export function assertTestersAuthBundle(options = {}) {
  const distDir = resolve(options.distDir || join(ROOT, "dist"));
  const expectedRef = options.expectedRef || EXPECTED_SUPABASE_PROJECT_REF;
  const bundles = findIndexBundles(distDir);
  if (bundles.length === 0) {
    fail(`No dist/assets/index-*.js found under ${distDir}`);
  }

  const reports = [];
  for (const filePath of bundles) {
    const text = readFileSync(filePath, "utf8");
    const hasRef = text.includes(expectedRef);
    // Hosted builds must bake the project ref. Missing ref = empty Vite env remote rebuild.
    if (!hasRef) {
      fail(
        `Bundle ${filePath.split(/[/\\]/).pop()} is missing project ref ${expectedRef} — Auth env was not baked (local/offline fallback risk)`
      );
    }
    reports.push({
      file: filePath.split(/[/\\]/).pop(),
      projectRefPresent: true,
      projectRef: expectedRef,
    });
  }

  return { ok: true, expectedRef, bundles: reports };
}

export function runTestersAuthGate(mode = "all", distDir) {
  const result = { mode, env: null, bundle: null };
  if (mode === "env" || mode === "all") {
    result.env = assertTestersAuthEnv();
  }
  if (mode === "bundle" || mode === "all") {
    result.bundle = assertTestersAuthBundle({ distDir });
  }
  return result;
}

function printSafeReport(result) {
  if (result.env) {
    console.log(
      JSON.stringify({
        phase: "env",
        ok: true,
        VITE_SUPABASE_URL: "PRESENT",
        VITE_SUPABASE_ANON_KEY: "PRESENT",
        project_ref: result.env.projectRef,
        anon_key_length: result.env.anonKeyLength,
      })
    );
  }
  if (result.bundle) {
    console.log(
      JSON.stringify({
        phase: "bundle",
        ok: true,
        project_ref: result.bundle.expectedRef,
        bundles: result.bundle.bundles.map((b) => b.file),
      })
    );
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2] || "all";
  const distDir = process.argv[3];
  try {
    if (!["env", "bundle", "all"].includes(mode)) {
      fail(`Unknown mode "${mode}". Use env | bundle | all`);
    }
    const result = runTestersAuthGate(mode, distDir);
    printSafeReport(result);
    console.log("  ✓ testers auth deploy gate");
  } catch (error) {
    console.error(`TESTERS_AUTH_GATE_FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
