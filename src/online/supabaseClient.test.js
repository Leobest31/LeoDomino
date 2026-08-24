/**
 * Checkpoint 0 config contract — no network calls.
 * Run: node src/online/supabaseClient.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseClient, SUPABASE_ANON_KEY_ENV, SUPABASE_URL_ENV } from "./supabaseClient.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

assert.equal(SUPABASE_URL_ENV, "VITE_SUPABASE_URL");
assert.equal(SUPABASE_ANON_KEY_ENV, "VITE_SUPABASE_ANON_KEY");

const clientSource = read("src/online/supabaseClient.js");
assert.match(clientSource, /VITE_SUPABASE_URL/, "client reads VITE_SUPABASE_URL");
assert.match(clientSource, /VITE_SUPABASE_ANON_KEY/, "client reads VITE_SUPABASE_ANON_KEY");
assert.match(clientSource, /createClient/, "client uses the official Supabase JS SDK");
assert.doesNotMatch(
  clientSource,
  /SERVICE_ROLE|service_role_key|SUPABASE_SERVICE/i,
  "no privileged server key env is referenced"
);

const example = read(".env.example");
assert.match(example, /^VITE_SUPABASE_URL=$/m, ".env.example has an empty URL placeholder");
assert.match(example, /^VITE_SUPABASE_ANON_KEY=$/m, ".env.example has an empty anon key placeholder");
assert.doesNotMatch(example, /eyJ|service_role|sk_live/i, ".env.example contains no credentials");

const ignore = read(".gitignore");
assert.match(ignore, /^\.env$/m, ".env is ignored");
assert.match(ignore, /^\.env\.local$/m, ".env.local is ignored");
assert.match(ignore, /^\.env\.\*\.local$/m, ".env.*.local is ignored");
assert.match(ignore, /^!\.env\.example$/m, ".env.example remains committable");

const liveImports = [
  "src/main.jsx",
  "src/App.jsx",
  "src/pages/HomePage.jsx",
  "src/pages/AuthPage.jsx",
  "src/pages/GamePage.jsx",
  "src/pages/FindMatchPage.jsx",
  "src/hooks/useMatch.js",
];
for (const rel of liveImports) {
  assert.doesNotMatch(
    read(rel),
    /supabaseClient|@supabase\/supabase-js/,
    `${rel} does not import the Supabase client directly`
  );
}

const clientSourceAuth = read("src/online/supabaseClient.js");
assert.match(clientSourceAuth, /detectSessionInUrl: false/, "Capacitor email/password skips URL session parsing");
assert.match(clientSourceAuth, /persistSession: true/, "Supabase session persistence stays enabled");

const home = read("src/pages/HomePage.jsx");
assert.match(home, /handlePlayOnline/, "Find Match handler still exists");
assert.match(
  home.slice(home.indexOf("const handlePlayOnline"), home.indexOf("const goToStore")),
  /onFindMatch/,
  "Find Match opens the matchmaking screen"
);
assert.doesNotMatch(
  home.slice(home.indexOf("const handlePlayOnline"), home.indexOf("const goToStore")),
  /showComingSoon\(\)/,
  "Find Match is no longer Coming Soon"
);

assert.equal(typeof import.meta.env, "undefined");
assert.throws(() => getSupabaseClient(), /VITE_SUPABASE_URL/);

console.log("  ✓ Supabase client foundation config");
