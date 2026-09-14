/**
 * Latest commit_online_game_transition: expected CAS is a jsonb return, not RAISE.
 * Concatenates migrations. Does not connect to Supabase.
 * Run: node src/online/sqlCommitTransitionConflict.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = "supabase/migrations/20260901130000_commit_transition_conflict_return.sql";
const migration = readFileSync(join(root, rel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const allSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
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

function casCommit(store, expected) {
  if (store.version !== expected) {
    return { ok: false, code: "STALE_VERSION", version: store.version };
  }
  store.version = expected + 1;
  store.mutated += 1;
  return { ok: true, version: store.version };
}

assert.match(rel, /20260901130000_commit_transition_conflict_return/);
assert.match(migration, /Do NOT apply to hosted Supabase until explicitly approved/);
assert.doesNotMatch(migration, /DROP FUNCTION IF EXISTS public\.commit_online_game_transition/);

{
  const commit = latestFn("commit_online_game_transition(");
  assert.match(
    commit,
    /p_match_id uuid,\s*p_expected_version integer,\s*p_actor uuid,\s*p_seat integer,\s*p_action_type text,\s*p_payload jsonb,\s*p_public jsonb,\s*p_engine_state jsonb,\s*p_match_status text/
  );
  assert.match(commit, /FOR UPDATE/);
  assert.match(commit, /WHERE match_id = p_match_id AND version = p_expected_version/);
  assert.match(commit, /new_version := p_expected_version \+ 1/);
  assert.doesNotMatch(commit, /settle_match_global_rp/, "Global RP has been removed");
  assert.match(commit, /timeout_strikes/);
  assert.match(commit, /now\(\) \+ interval '30 seconds'/);
  assert.match(commit, /PERFORM public\.require_service_role\(\)/);

  assert.match(commit, /'ok', false/);
  assert.match(commit, /'code', 'STALE_VERSION'/);
  assert.match(commit, /'code', 'TIMEOUT_NOT_DUE'/);
  assert.match(commit, /'ok', true/);
  assert.match(commit, /'turn_deadline_at', session_row\.turn_deadline_at/);

  const staleReturn = commit.indexOf("'code', 'STALE_VERSION'");
  const timeoutReturn = commit.indexOf("'code', 'TIMEOUT_NOT_DUE'");
  const mutateSecrets = commit.indexOf("UPDATE public.game_secrets");
  const increment = commit.indexOf("new_version := p_expected_version + 1");
  assert.ok(staleReturn > 0 && staleReturn < increment, "stale return is before any version increment");
  assert.ok(timeoutReturn > 0 && timeoutReturn < increment, "timeout-not-due return is before any version increment");
  assert.ok(staleReturn < mutateSecrets, "stale return does not mutate secrets");
  assert.ok(timeoutReturn < mutateSecrets, "timeout-not-due does not mutate secrets");

  assert.doesNotMatch(commit, /ERRCODE = '40001'/);
  assert.doesNotMatch(commit, /RAISE EXCEPTION 'stale expected_version'/);
  assert.doesNotMatch(commit, /RAISE EXCEPTION 'timeout not due'/);

  assert.match(commit, /RAISE EXCEPTION 'commit arguments required'/);
  assert.match(commit, /RAISE EXCEPTION 'game session not found'/);
  assert.match(commit, /RAISE EXCEPTION 'action payload must not include reserve or draw tile ids'/);
  console.log("  ✓ latest commit returns STALE_VERSION / TIMEOUT_NOT_DUE without RAISE or 40001");
}

{
  const store = { version: 5, mutated: 0 };
  const winner = casCommit(store, 5);
  const loser = casCommit(store, 5);
  assert.equal(winner.ok, true);
  assert.equal(winner.version, 6);
  assert.equal(loser.ok, false);
  assert.equal(loser.code, "STALE_VERSION");
  assert.equal(loser.version, 6);
  assert.equal(store.version, 6);
  assert.equal(store.mutated, 1);
  console.log("  ✓ two commits at version N: one success, one STALE_VERSION, version +1 once");
}

console.log("  ✓ commit transition conflict SQL contract");
