/**
 * Latest install/commit stamp a 30-second online turn deadline.
 * Concatenates migrations. Does not connect to Supabase.
 * Run: node src/online/sqlOnlineTurnTimeout30.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = "supabase/migrations/20260902130000_online_turn_timeout_30s.sql";
const migration = readFileSync(join(root, rel), "utf8");
const historical = readFileSync(
  join(root, "supabase/migrations/20260828380000_online_turn_timeout.sql"),
  "utf8"
);
const allSql = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(root, "supabase/migrations", name), "utf8"))
  .join("\n\n");

function latestFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  let start = -1;
  let from = 0;
  while (from < allSql.length) {
    const i = allSql.indexOf(needle, from);
    if (i < 0) break;
    start = i;
    from = i + needle.length;
  }
  assert.ok(start >= 0, `latest ${name} exists`);
  const bodyStart = allSql.indexOf("AS $$", start);
  const bodyEnd = bodyStart >= 0 ? allSql.indexOf("$$;", bodyStart + 5) : -1;
  const end = bodyEnd >= 0 ? bodyEnd + 3 : allSql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return end > start ? allSql.slice(start, end) : allSql.slice(start);
}

assert.match(historical, /now\(\) \+ interval '60 seconds'/);
assert.match(migration, /now\(\) \+ interval '30 seconds'/);
assert.doesNotMatch(migration, /now\(\) \+ interval '60 seconds'/);
assert.match(migration, /SET search_path = public/);
assert.doesNotMatch(migration, /DROP FUNCTION IF EXISTS public\.install_online_game/);
assert.doesNotMatch(migration, /DROP FUNCTION IF EXISTS public\.commit_online_game_transition/);
assert.doesNotMatch(migration, /p_turn_deadline|p_timeout_ms/);
assert.doesNotMatch(migration, /JOIN_GRACE|join_deadline|interval '3 minutes'/);
assert.doesNotMatch(migration, /interval '5 minutes'/);

{
  const install = latestFn("install_online_game(");
  assert.match(install, /now\(\) \+ interval '30 seconds'/);
  assert.doesNotMatch(install, /now\(\) \+ interval '60 seconds'/);
  assert.match(install, /ON CONFLICT \(match_id\) DO NOTHING/);
  assert.match(install, /SET search_path = public/);
  assert.match(install, /PERFORM public\.require_service_role\(\)/);
}

{
  const commit = latestFn("commit_online_game_transition(");
  assert.match(commit, /now\(\) \+ interval '30 seconds'/);
  assert.doesNotMatch(commit, /now\(\) \+ interval '60 seconds'/);
  assert.match(commit, /turn_deadline_at > now\(\)/);
  assert.match(commit, /'code', 'TIMEOUT_NOT_DUE'/);
  assert.match(commit, /'code', 'STALE_VERSION'/);
  assert.match(commit, /resetTurnDeadline/);
  assert.match(commit, /SET search_path = public/);
  const timeoutGate = commit.indexOf("p_action_type = 'timeout'");
  const increment = commit.indexOf("new_version := p_expected_version + 1");
  assert.ok(timeoutGate > 0 && timeoutGate < increment, "timeout gate runs before version increment");
}

console.log("  ✓ latest install/commit stamp 30-second online turn deadlines");
