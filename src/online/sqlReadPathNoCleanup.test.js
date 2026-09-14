/**
 * D3 status after C2 prerequisite: 20260831120000 is withheld/no-op.
 * Full read-path cleanup removal is NOT applied. Latest get_my must not
 * hide a still-playing match on stale last_seen_at.
 * Concatenates migrations. Run: node src/online/sqlReadPathNoCleanup.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase/migrations");
const phase2Rel = "supabase/migrations/20260831120000_read_path_no_cleanup.sql";
const phase2 = readFileSync(join(root, phase2Rel), "utf8");

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const allSql = migrationFiles
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

assert.match(phase2, /WITHDRAWN \/ NO-OP MARKER/);
assert.doesNotMatch(phase2, /CREATE OR REPLACE FUNCTION/);
assert.doesNotMatch(phase2, /seen_self < now\(\) - interval '5 minutes'/);
assert.doesNotMatch(phase2, /GRANT SELECT ON TABLE public\.active_match_players/);
assert.doesNotMatch(phase2, /cron\.schedule|CREATE EXTENSION[\s\S]*pg_cron/);

{
  const count = latestFn("count_joinable_open_match_requests()");
  assert.doesNotMatch(count, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(count, /FOR UPDATE/);
  assert.doesNotMatch(count, /INSERT INTO|UPDATE public\.|DELETE FROM public\./);
  assert.doesNotMatch(count, /player_in_active_match/);
  assert.match(count, /LANGUAGE plpgsql\s+STABLE/);
  assert.match(count, /COALESCE\(r\.visibility, 'public'\) = 'public'/);
  assert.match(count, /r\.creator_id <> caller/);
  assert.match(count, /r\.status = 'open'/);
  console.log("  ✓ count_joinable_open_match_requests is read-only (no cleanup)");
}

{
  const getMine = latestFn("get_my_active_match()");
  assert.doesNotMatch(getMine, /seen_self < now\(\) - interval '5 minutes'/);
  assert.doesNotMatch(getMine, /Started matches past the 5-minute presence grace return NULL/);
  assert.doesNotMatch(getMine, /FOR UPDATE/);
  assert.doesNotMatch(getMine, /INSERT INTO|UPDATE public\.|_forfeit_match_player|_abort_stale_match/);
  assert.match(getMine, /m\.status IN \('ready', 'playing'\)/);
  assert.match(getMine, /RETURN NULL/);
  assert.match(getMine, /join_deadline_at/);
  assert.doesNotMatch(getMine, /engine_state|hand_counts|game_secrets/);
  console.log("  ✓ get_my_active_match is not stale=>NULL (D3 withheld)");
}

{
  const cleanup = latestFn("cleanup_stale_occupied_matches()");
  const snapshotEnd = cleanup.indexOf("LOOP");
  const snapshot = cleanup.slice(cleanup.indexOf("FOR rec IN"), snapshotEnd);
  assert.doesNotMatch(snapshot, /FOR UPDATE/, "candidate snapshot does not lock rows");
  assert.match(snapshot, /last_seen_at < now\(\) - grace/, "stale one/both-player candidate");
  assert.match(snapshot, /joined_at IS NULL/, "expired join-window candidate");
  assert.match(snapshot, /interval '3 minutes'/);
  assert.match(cleanup, /_abort_stale_match/);
  assert.match(cleanup, /_forfeit_match_player/);
  assert.match(cleanup, /resolve_join_timeout/);
  assert.match(cleanup, /interval '5 minutes'/);
  assert.match(cleanup, /idempotent/);
  const sessionLock = cleanup.indexOf("FROM public.game_sessions");
  const sessionSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", sessionLock);
  const matchLock = cleanup.indexOf("FROM public.matches m", sessionSkip);
  const matchSkip = cleanup.indexOf("FOR UPDATE SKIP LOCKED", matchLock);
  assert.ok(sessionSkip > sessionLock, "cleanup skip-locks game_sessions");
  assert.ok(matchSkip > matchLock && matchLock > sessionSkip, "cleanup skip-locks matches after sessions");
  console.log("  ✓ cleanup candidates filter before locks; SKIP LOCKED sessions then matches");
}

{
  const touch = latestFn("touch_my_match_presence(p_match_id uuid)");
  const classifyAt = touch.indexOf("_occupancy_presence_action");
  const abortAt = touch.indexOf("_abort_stale_match");
  const stampAt = touch.indexOf("joined_at = COALESCE(joined_at, now())");
  assert.ok(classifyAt >= 0 && classifyAt < stampAt, "heartbeat classifies occupancy before last_seen stamp");
  assert.ok(abortAt >= 0 && abortAt < stampAt, "both-stale abort uses the pre-stamp snapshot");
  assert.match(touch, /cleanup_stale_occupied_matches/);
  assert.match(touch, /joined_at = COALESCE\(joined_at, now\(\)\)/);
  console.log("  ✓ heartbeat classifies occupancy snapshot before last_seen stamp, then runs cleanup");
}

{
  const busy = latestFn("player_in_active_match(p_player uuid)");
  assert.match(busy, /cleanup_stale_occupied_matches/);
  assert.match(busy, /FROM public\.active_match_players/);
  console.log("  ✓ matchmaking busy-check still runs cleanup (write path)");
}

{
  const friends = latestFn("list_friends_in_active_match()");
  const count = latestFn("count_joinable_open_match_requests()");
  const getMine = latestFn("get_my_active_match()");
  const touch = latestFn("touch_my_match_presence(p_match_id uuid)");
  const busy = latestFn("player_in_active_match(p_player uuid)");
  const forfeit = latestFn("forfeit_online_match(p_match_id uuid)");
  const accept = latestFn("accept_match_request(p_request_id uuid)");
  assert.match(friends, /cleanup_stale_occupied_matches/, "D3 remaining: friends still janitors");
  assert.doesNotMatch(count, /cleanup_stale_occupied_matches/);
  assert.match(getMine, /cleanup_stale_occupied_matches/, "D3 remaining: hosted get_my still janitors");
  assert.match(touch, /cleanup_stale_occupied_matches/);
  assert.match(busy, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(forfeit, /cleanup_stale_occupied_matches/);
  assert.doesNotMatch(accept, /cleanup_stale_occupied_matches/);
  console.log("  ✓ D3 remaining: friends/get_my still janitor; count/forfeit/accept do not");
}

{
  function firstForUpdateAfter(sql, tableNeedle) {
    const tableAt = sql.indexOf(tableNeedle);
    assert.ok(tableAt >= 0, `${tableNeedle} present`);
    const fu = sql.indexOf("FOR UPDATE", tableAt);
    assert.ok(fu > tableAt, `${tableNeedle} is locked`);
    return fu;
  }

  const commitAlt = latestFn("commit_online_game_transition(");
  const commitSess = firstForUpdateAfter(commitAlt, "FROM public.game_sessions");
  const commitMatchWrite = commitAlt.indexOf("UPDATE public.matches");
  assert.ok(commitSess < commitMatchWrite, "commit locks game_sessions before writing matches");
  assert.doesNotMatch(commitAlt, /cleanup_stale_occupied_matches/);

  const forfeit = latestFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  const forfeitSessLock = firstForUpdateAfter(forfeit, "FROM public.game_sessions");
  const forfeitMatchLock = firstForUpdateAfter(forfeit, "FROM public.matches");
  assert.ok(forfeitSessLock < forfeitMatchLock, "forfeit locks game_sessions then matches");
  const forfeitSessWrite = forfeit.indexOf("UPDATE public.game_sessions");
  const forfeitMatchWrite = forfeit.indexOf("UPDATE public.matches");
  assert.ok(forfeitSessWrite < forfeitMatchWrite, "forfeit still publishes match_over before matches.finished");
  assert.doesNotMatch(forfeit, /settle_match_global_rp/, "Global RP has been removed");

  const abort = latestFn("_abort_stale_match(p_match_id uuid)");
  const abortSessLock = abort.indexOf("FROM public.game_sessions");
  const abortMatchLock = abort.indexOf("FROM public.matches");
  assert.ok(abortSessLock < abortMatchLock, "abort locks game_sessions then matches");
  assert.match(abort, /SET status = 'aborted'/);

  const joinAbort = latestFn("_abort_join_timeout_match(p_match_id uuid)");
  assert.ok(
    joinAbort.indexOf("FROM public.game_sessions") < joinAbort.indexOf("FROM public.matches"),
    "join-timeout abort locks game_sessions then matches"
  );

  const resolve = latestFn("resolve_join_timeout(p_match_id uuid)");
  assert.ok(
    resolve.indexOf("FROM public.game_sessions") < resolve.indexOf("FROM public.matches"),
    "resolve_join_timeout locks game_sessions then matches"
  );

  console.log("  ✓ lock order unified: game_sessions then matches");
}

{
  const view = latestFn("get_game_view(p_match_id uuid)");
  assert.doesNotMatch(view, /FOR UPDATE/);
  assert.doesNotMatch(view, /cleanup_stale_occupied_matches/);
  console.log("  ✓ get_game_view remains a lock-free read");
}

{
  const app = readFileSync(join(root, "src/App.jsx"), "utf8");
  const joinTimeout = readFileSync(join(root, "src/online/joinTimeout.js"), "utf8");
  const findMatch = readFileSync(join(root, "src/pages/FindMatchPage.jsx"), "utf8");
  const busy = latestFn("player_in_active_match(p_player uuid)");
  assert.match(app, /getMyActiveMatch\(\)/);
  assert.match(joinTimeout, /TERMINAL_MATCH_STATUSES/);
  assert.match(joinTimeout, /isTerminalMatch/);
  assert.match(joinTimeout, /ACTIVE_MATCH_STATUSES\.includes\(match\.status\)/);
  assert.match(findMatch, /canRecoverMatch/);
  assert.match(busy, /cleanup_stale_occupied_matches/, "Find Match/create still unsticks occupancy on write");
  console.log("  ✓ recovery helpers still distinguish terminal vs live matches");
}

console.log("  ✓ D3 withheld; C2 lock-order + snapshot cleanup remain");
