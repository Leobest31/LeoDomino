/**
 * C2 lock-order prerequisite: sessions then matches, without the D3
 * get_my_active_match stale=>NULL footgun.
 * Concatenates migrations. Does not connect to Supabase.
 * Run: node src/online/sqlC2LockOrderPrerequisite.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const markerRel = "supabase/migrations/20260831120000_read_path_no_cleanup.sql";
const prereqRel = "supabase/migrations/20260902210000_sessions_then_matches_lock_order.sql";
const c2Rel = "supabase/migrations/20260902220000_shared_stale_occupancy_abort.sql";
const heldRel = "supabase/held/20260831120000_read_path_no_cleanup.WITHHELD.sql";
const joinTimeoutRel = "supabase/migrations/20260830120000_join_timeout.sql";

const marker = readFileSync(join(root, markerRel), "utf8");
const prereq = readFileSync(join(root, prereqRel), "utf8");
const c2 = readFileSync(join(root, c2Rel), "utf8");
const held = readFileSync(join(root, heldRel), "utf8");
const hostedGetMine = readFileSync(join(root, joinTimeoutRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const allSql = migrationFiles.map((name) => readFileSync(join(migrationsDir, name), "utf8")).join("\n\n");

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

function firstForUpdateAfter(sql, tableNeedle) {
  const tableAt = sql.indexOf(tableNeedle);
  assert.ok(tableAt >= 0, `${tableNeedle} present`);
  const fu = sql.indexOf("FOR UPDATE", tableAt);
  assert.ok(fu > tableAt, `${tableNeedle} is locked`);
  return fu;
}

assert.ok(migrationFiles.includes("20260831120000_read_path_no_cleanup.sql"));
assert.ok(migrationFiles.includes("20260902210000_sessions_then_matches_lock_order.sql"));
assert.ok(migrationFiles.includes("20260902220000_shared_stale_occupancy_abort.sql"));
const markerIdx = migrationFiles.indexOf("20260831120000_read_path_no_cleanup.sql");
const prereqIdx = migrationFiles.indexOf("20260902210000_sessions_then_matches_lock_order.sql");
const c2Idx = migrationFiles.indexOf("20260902220000_shared_stale_occupancy_abort.sql");
assert.ok(markerIdx >= 0 && markerIdx < prereqIdx);
assert.ok(prereqIdx < c2Idx);
assert.ok(!migrationFiles.includes("20260831120000_read_path_no_cleanup.WITHHELD.sql"));

{
  assert.match(marker, /WITHDRAWN \/ NO-OP MARKER/);
  assert.match(marker, /DO \$\$/);
  assert.doesNotMatch(marker, /CREATE OR REPLACE FUNCTION/);
  assert.doesNotMatch(marker, /seen_self < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(marker, /CREATE OR REPLACE FUNCTION public\.get_my_active_match/);
  assert.doesNotMatch(marker, /REVOKE ALL ON FUNCTION public\.cleanup_stale_occupied_matches/);
  console.log("  ✓ 20260831120000 is a no-op marker (cannot apply stale=>NULL get_my)");
}

{
  assert.match(held, /WITHHELD/);
  assert.match(held, /seen_self < now\(\) - interval '5 minutes'/);
  assert.match(held, /Started matches past the 5-minute presence grace return NULL/);
  assert.match(held, /DO NOT MOVE THIS FILE INTO supabase\/migrations/);
  console.log("  ✓ withheld D3 body stays outside migrations/");
}

{
  assert.match(prereq, /Do NOT apply to hosted Supabase until explicitly approved/);
  assert.match(prereq, /CREATE OR REPLACE FUNCTION public\._forfeit_match_player/);
  assert.match(prereq, /CREATE OR REPLACE FUNCTION public\._abort_stale_match/);
  assert.match(prereq, /CREATE OR REPLACE FUNCTION public\._abort_join_timeout_match/);
  assert.match(prereq, /CREATE OR REPLACE FUNCTION public\.resolve_join_timeout/);
  assert.doesNotMatch(prereq, /CREATE OR REPLACE FUNCTION public\.get_my_active_match/);
  assert.doesNotMatch(prereq, /CREATE OR REPLACE FUNCTION public\.list_friends_in_active_match/);
  assert.doesNotMatch(prereq, /CREATE OR REPLACE FUNCTION public\.cleanup_stale_occupied_matches/);
  assert.doesNotMatch(prereq, /seen_self < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(prereq, /GRANT EXECUTE ON FUNCTION public\.cleanup_stale_occupied_matches/);
  assert.doesNotMatch(prereq, /REVOKE ALL ON FUNCTION public\.cleanup_stale_occupied_matches/);
  console.log("  ✓ prerequisite is lock-order only; no get_my / no cleanup grant change");
}

{
  const forfeit = latestFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  const sess = firstForUpdateAfter(forfeit, "FROM public.game_sessions");
  const match = firstForUpdateAfter(forfeit, "FROM public.matches");
  assert.ok(sess < match, "_forfeit_match_player locks game_sessions before matches");
  assert.doesNotMatch(forfeit, /settle_match_global_rp/, "Global RP has been removed");
  const sessWrite = forfeit.indexOf("UPDATE public.game_sessions");
  const matchWrite = forfeit.indexOf("UPDATE public.matches");
  assert.ok(sessWrite < matchWrite, "forfeit still publishes match_over before matches.finished");
  console.log("  ✓ latest _forfeit_match_player: sessions then matches; Global RP removed");
}

{
  const abort = latestFn("_abort_stale_match(p_match_id uuid)");
  const sess = abort.indexOf("FROM public.game_sessions");
  const match = abort.indexOf("FROM public.matches");
  assert.ok(sess < match, "_abort_stale_match locks game_sessions then matches");
  assert.doesNotMatch(abort, /settle_match_global_rp/);
  console.log("  ✓ latest _abort_stale_match: compatible lock order, no RP");
}

{
  const joinAbort = latestFn("_abort_join_timeout_match(p_match_id uuid)");
  const resolve = latestFn("resolve_join_timeout(p_match_id uuid)");
  assert.ok(
    joinAbort.indexOf("FROM public.game_sessions") < joinAbort.indexOf("FROM public.matches"),
    "join-timeout abort locks sessions then matches"
  );
  assert.ok(
    resolve.indexOf("FROM public.game_sessions") < resolve.indexOf("FROM public.matches"),
    "resolve_join_timeout locks game_sessions then matches"
  );
  console.log("  ✓ join-timeout abort/resolve use the same lock order");
}

{
  const commit = latestFn("commit_online_game_transition(");
  const cleanup = latestFn("cleanup_stale_occupied_matches()");
  const commitSess = firstForUpdateAfter(commit, "FROM public.game_sessions");
  const commitMatchWrite = commit.indexOf("UPDATE public.matches");
  assert.ok(commitSess < commitMatchWrite, "commit locks game_sessions before writing matches");
  assert.doesNotMatch(commit, /cleanup_stale_occupied_matches/);

  const sessionLock = cleanup.indexOf("FROM public.game_sessions");
  const sessionSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", sessionLock);
  const matchLock = cleanup.indexOf("FROM public.matches m", sessionSkip);
  const matchSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", matchLock);
  assert.ok(sessionSkip > sessionLock, "cleanup skip-locks game_sessions");
  assert.ok(matchSkip > matchLock && matchLock > sessionSkip, "cleanup skip-locks matches after sessions");
  console.log("  ✓ commit and C2 cleanup ordering are compatible (sessions first; SKIP LOCKED)");
}

{
  const getMine = latestFn("get_my_active_match()");
  assert.doesNotMatch(
    getMine,
    /seen_self < now\(\) - interval '5 minutes'/,
    "latest get_my must not hide a live match on stale presence"
  );
  assert.doesNotMatch(getMine, /Started matches past the 5-minute presence grace return NULL/);
  assert.match(hostedGetMine, /CREATE OR REPLACE FUNCTION public\.get_my_active_match\(\)/);
  const hostedFnStart = hostedGetMine.indexOf("CREATE OR REPLACE FUNCTION public.get_my_active_match()");
  const hostedFn = hostedGetMine.slice(hostedFnStart);
  assert.doesNotMatch(hostedFn, /seen_self < now\(\) - interval '5 minutes'/);
  assert.match(getMine, /m\.status IN \('ready', 'playing'\)/);
  assert.match(getMine, /RETURN NULL/, "not-found still returns NULL");
  console.log("  ✓ get_my_active_match is not given the stale=>NULL footgun");
}

{
  assert.doesNotMatch(c2, /CREATE OR REPLACE FUNCTION public\.get_my_active_match/);
  assert.doesNotMatch(c2, /CREATE OR REPLACE FUNCTION public\._forfeit_match_player/);
  assert.doesNotMatch(c2, /CREATE OR REPLACE FUNCTION public\._abort_stale_match/);
  console.log("  ✓ C2 no longer depends on applying withheld 20260831120000 wholesale");
}

console.log("  ✓ C2 lock-order prerequisite SQL contract");
