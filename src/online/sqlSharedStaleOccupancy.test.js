/**
 * C2 shared-stale occupancy SQL contract.
 * Concatenates migrations so assertions apply to the latest definition.
 * Does not connect to Supabase.
 * Run: node src/online/sqlSharedStaleOccupancy.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260902220000_shared_stale_occupancy_abort.sql";
const migration = readFileSync(join(root, migrationRel), "utf8");
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

assert.match(migrationRel, /20260902220000_shared_stale_occupancy_abort/);
assert.match(migration, /Do NOT apply to hosted Supabase until explicitly approved/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\._occupancy_presence_action/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cleanup_stale_occupied_matches\(\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.touch_my_match_presence\(p_match_id uuid\)/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\._forfeit_match_player/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\._abort_stale_match/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.commit_online_game_transition/);
assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.cleanup_stale_occupied_matches\(\) TO authenticated/);
assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\._occupancy_presence_action/);

{
  const classifier = latestFn("_occupancy_presence_action(");
  assert.match(classifier, /SET search_path = public/);
  assert.match(classifier, /p_status NOT IN \('ready', 'playing'\)/);
  assert.match(classifier, /p_joined_a IS NULL OR p_joined_b IS NULL/);
  assert.match(classifier, /p_seen_a IS NULL AND p_seen_b IS NULL/);
  assert.match(classifier, /p_seen_a IS NULL OR p_seen_a < p_now - grace/);
  assert.match(classifier, /p_seen_b IS NULL OR p_seen_b < p_now - grace/);
  assert.match(classifier, /interval '5 minutes'/);
  assert.match(classifier, /RETURN 'none'/);
  assert.match(classifier, /RETURN 'abort'/);
  assert.match(classifier, /RETURN 'forfeit_a'/);
  assert.match(classifier, /RETURN 'forfeit_b'/);
  const noneAt = classifier.indexOf("NOT stale_a AND NOT stale_b");
  const abortAt = classifier.indexOf("stale_a AND stale_b");
  const forfeitA = classifier.indexOf("RETURN 'forfeit_a'");
  assert.ok(noneAt >= 0 && noneAt < abortAt, "neither stale before both-stale");
  assert.ok(abortAt < forfeitA, "both-stale abort is classified before one-stale forfeit");
  console.log("  ✓ classifier: neither / one / both stale from a timestamp snapshot");
}

{
  const cleanup = latestFn("cleanup_stale_occupied_matches()");
  const snapshotEnd = cleanup.indexOf("LOOP");
  const snapshot = cleanup.slice(cleanup.indexOf("FOR rec IN"), snapshotEnd);
  assert.doesNotMatch(snapshot, /FOR UPDATE/, "candidate snapshot does not lock rows");
  const sessionLock = cleanup.indexOf("FROM public.game_sessions");
  const sessionSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", sessionLock);
  const matchLock = cleanup.indexOf("FROM public.matches m", sessionSkip);
  const matchSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", matchLock);
  assert.ok(sessionSkip > sessionLock, "cleanup skip-locks game_sessions");
  assert.ok(matchSkip > matchLock && matchLock > sessionSkip, "cleanup skip-locks matches after sessions");

  const classifyAt = cleanup.indexOf("_occupancy_presence_action");
  const filterAt = cleanup.indexOf("MAX(amp.last_seen_at) FILTER");
  assert.ok(filterAt > matchSkip, "both-seat occupancy snapshot is after locks");
  assert.ok(classifyAt > filterAt, "classify uses the occupancy snapshot");
  assert.match(cleanup, /action = 'abort'/);
  assert.match(cleanup, /_abort_stale_match/);
  assert.match(cleanup, /action = 'forfeit_a'/);
  assert.match(cleanup, /_forfeit_match_player\(rec\.id, rec\.player_a\)/);
  assert.match(cleanup, /_forfeit_match_player\(rec\.id, rec\.player_b\)/);
  assert.match(cleanup, /resolve_join_timeout/);
  assert.doesNotMatch(cleanup, /settle_match_global_rp/);
  console.log("  ✓ cleanup classifies one locked snapshot; both-stale aborts without RP");
}

{
  const touch = latestFn("touch_my_match_presence(p_match_id uuid)");
  const snapshotAt = touch.indexOf("MAX(amp.last_seen_at) FILTER");
  const classifyAt = touch.indexOf("_occupancy_presence_action");
  const abortAt = touch.indexOf("_abort_stale_match");
  const forfeitAt = touch.indexOf("_forfeit_match_player");
  const stampAt = touch.indexOf("joined_at = COALESCE(joined_at, now())");
  const cleanupAt = touch.indexOf("cleanup_stale_occupied_matches");
  assert.ok(snapshotAt >= 0, "touch snapshots both last_seen_at");
  assert.ok(snapshotAt < classifyAt, "snapshot before classify");
  assert.ok(classifyAt < abortAt, "classify before abort");
  assert.ok(abortAt < stampAt, "abort before last_seen stamp");
  assert.ok(forfeitAt < stampAt, "forfeit before last_seen stamp");
  assert.ok(stampAt < cleanupAt, "stamp before other-match cleanup");
  assert.match(touch, /joined_at = COALESCE\(joined_at, now\(\)\)/);
  assert.match(touch, /action = 'abort'/);
  assert.match(touch, /action = 'forfeit_a'/);
  assert.match(touch, /action = 'forfeit_b'/);
  assert.doesNotMatch(touch, /FOR UPDATE/);
  assert.doesNotMatch(touch, /settle_match_global_rp/);
  console.log("  ✓ touch classifies pre-mutation snapshot before last_seen stamp");
}

{
  const abort = latestFn("_abort_stale_match(p_match_id uuid)");
  assert.match(abort, /SET status = 'aborted'/);
  assert.match(abort, /match_winner_seat = NULL/);
  assert.match(abort, /reason', 'abandoned'/);
  assert.doesNotMatch(abort, /settle_match_global_rp/);
  assert.doesNotMatch(abort, /match_rp_results/);
  const abortSess = abort.indexOf("FROM public.game_sessions");
  const abortMatch = abort.indexOf("FROM public.matches");
  assert.ok(abortSess < abortMatch, "abort locks game_sessions then matches");
  console.log("  ✓ abort remains no-winner / no RP / sessions-then-matches");
}

{
  const forfeit = latestFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  assert.doesNotMatch(forfeit, /settle_match_global_rp/, "Global RP has been removed");
  assert.match(forfeit, /finish_reason = COALESCE\(finish_reason, 'forfeit'\)/);
  const forfeitSess = forfeit.indexOf("FROM public.game_sessions");
  const forfeitMatch = forfeit.indexOf("FROM public.matches");
  assert.ok(forfeitSess < forfeitMatch, "forfeit locks game_sessions then matches");
  console.log("  ✓ genuine one-stale forfeit still finishes and settles LeoPips");
}

{
  const commit = latestFn("commit_online_game_transition(");
  const commitSess = commit.indexOf("FROM public.game_sessions");
  const commitSessLock = commit.indexOf("FOR UPDATE", commitSess);
  const commitMatchWrite = commit.indexOf("UPDATE public.matches");
  assert.ok(commitSessLock > commitSess, "commit locks game_sessions");
  assert.ok(commitSessLock < commitMatchWrite, "commit writes matches after session lock");
  assert.doesNotMatch(commit, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(commit, /active_match_players/, "commit does not lock occupancy");
  console.log("  ✓ commit vs cleanup: sessions-first, occupancy uninvolved, SKIP LOCKED skip avoids wait");
}

console.log("  ✓ C2 shared-stale occupancy SQL contract");
