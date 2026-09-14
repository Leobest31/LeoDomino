/**
 * LeoPips terminal settlement: forfeit / abandon / timeout / completed / refund.
 * Reads concatenated migrations (latest function wins). Does not connect to Supabase.
 * Run: node src/online/sqlLeopipsTerminalSettlement.test.js
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const liveRel = "supabase/migrations/20260903180000_leopips_terminal_settlement.sql";
const sql = readFileSync(join(root, liveRel), "utf8");
const migrationsDir = join(root, "supabase/migrations");
const prior = [
  "20260903120000_leopips_wallet_foundation.sql",
  "20260903140000_leopips_stake_matchmaking_buckets.sql",
  "20260903150000_leopips_wallet_settlement_hardening.sql",
  "20260903160000_leopips_activation_settlement.sql",
  "20260903170000_admin_leopips_read_operations.sql",
];
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const allSql = migrationFiles.map((name) => readFileSync(join(migrationsDir, name), "utf8")).join("\n\n");
const edge = readFileSync(join(root, "supabase/functions/online-game/index.js"), "utf8");
const activation = readFileSync(
  join(root, "supabase/migrations/20260903160000_leopips_activation_settlement.sql"),
  "utf8"
);

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

assert.equal(existsSync(join(root, liveRel)), true, "canonical terminal settlement migration exists");
assert.ok("20260903180000" > "20260903170000", "timestamp after admin read RPCs");
assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /ALTER TABLE public\.(match_requests|matches)\b/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.accept_match_request/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.install_online_game\(/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.commit_online_game_transition\(/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.settle_match_global_rp/);
assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|player_xp|player_levels/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_settle_finished_match/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._leopips_credit_match_payout\([^)]+\) TO authenticated/);

for (const name of prior) {
  assert.equal(existsSync(join(migrationsDir, name)), true, `${name} still present`);
  const priorSql = readFileSync(join(migrationsDir, name), "utf8");
  assert.doesNotMatch(priorSql, /_leopips_settle_finished_match/, `${name} was not edited with the new helper`);
}

{
  const settle = latestFn("_leopips_settle_finished_match(p_match_id uuid)");
  assert.match(settle, /SECURITY DEFINER/);
  assert.match(settle, /SET search_path = public/);
  assert.doesNotMatch(settle, /require_service_role/);
  assert.match(settle, /friend_or_unstaked/);
  assert.match(settle, /stake_not_debited/);
  assert.match(settle, /match_winner_seat/);
  assert.match(settle, /_leopips_refund_both_match_stakes/);
  assert.match(settle, /_leopips_credit_match_payout/);
  assert.match(settle, /normal_win/);
  assert.match(settle, /_leopips_credit_forfeit_abandon_partial/);
  assert.match(settle, /non_completed_partial/);
  assert.match(settle, /'forfeit', 'abandon', 'abandoned', 'timeout'/);
  assert.doesNotMatch(settle, /forfeit_win|abandon_win|timeout_win|no_pot_payout/);
  assert.match(settle, /_leopips_try_credit_referral_after_match/);
  const tryAt = settle.indexOf("_leopips_try_credit_referral_after_match");
  const unstakedAt = settle.indexOf("friend_or_unstaked");
  assert.ok(tryAt > 0 && unstakedAt > tryAt, "referral try must run before unstaked pot skip");
  assert.match(settle, /_progression_award_finished_match/);
  assert.doesNotMatch(settle, /p_amount|p_payout|p_stake_pips/);
  assert.doesNotMatch(settle, /player_xp|player_levels|award_xp/);
  assert.match(
    allSql,
    /REVOKE ALL ON FUNCTION public\._leopips_settle_finished_match\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/
  );
}

{
  const finished = latestFn("_leopips_on_match_finished(p_match_id uuid)");
  assert.match(finished, /require_service_role/);
  assert.match(finished, /_leopips_settle_finished_match/);
  assert.doesNotMatch(finished, /_leopips_credit_match_payout/);
  assert.match(
    allSql,
    /GRANT EXECUTE ON FUNCTION public\._leopips_on_match_finished\(uuid\) TO service_role/
  );
  assert.match(
    allSql,
    /REVOKE ALL ON FUNCTION public\._leopips_on_match_finished\(uuid\) FROM PUBLIC, anon, authenticated/
  );
}

{
  const payout = latestFn("_leopips_credit_match_payout(");
  assert.doesNotMatch(payout, /require_service_role/);
  assert.match(payout, /normal_win/);
  assert.match(payout, /payout outcome not finalized/);
  assert.doesNotMatch(payout, /forfeit_win|abandon_win|timeout_win/);
  assert.match(payout, /reason = 'match_stake'/);
  assert.match(payout, /stake \* 2/);
  assert.match(payout, /'match_payout:' \|\| p_match_id::text/);
  assert.doesNotMatch(payout, /p_amount/);
  assert.match(payout, /_leopips_is_allowed_stake\(stake\)/);
  assert.match(payout, /INVALID_LEOPIPS_STAKE/);
}

{
  const refund = latestFn("_leopips_refund_both_match_stakes(p_match_id uuid)");
  assert.match(refund, /join_timeout/);
  assert.match(refund, /abandoned/);
  assert.match(refund, /refund_stake:/);
  assert.match(refund, /correction/);
  assert.match(refund, /authoritative_loss/);
  assert.match(refund, /finish_reason IN \('completed', 'forfeit', 'timeout'\)/);
  assert.doesNotMatch(refund, /gameplay_started/);
  assert.doesNotMatch(refund, /abandon_opponent/);
}

{
  const forfeit = latestFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  const sess = forfeit.indexOf("FROM public.game_sessions");
  const match = forfeit.indexOf("FROM public.matches");
  const sessWrite = forfeit.indexOf("UPDATE public.game_sessions");
  const matchWrite = forfeit.indexOf("UPDATE public.matches");
  const pips = forfeit.lastIndexOf("PERFORM public._leopips_settle_finished_match");
  assert.ok(sess < match, "forfeit locks game_sessions before matches");
  assert.ok(sessWrite < matchWrite, "forfeit publishes match_over before matches.finished");
  assert.ok(matchWrite < pips, "LeoPips settle after matches.finished");
  assert.doesNotMatch(forfeit, /settle_match_global_rp/, "Global RP has been removed");
  assert.match(forfeit, /finish_reason = COALESCE\(finish_reason, 'forfeit'\)/);
  assert.match(forfeit, /match_winner_seat = winner_seat/);
  assert.match(
    forfeit,
    /IF match_row\.status = 'finished' THEN[\s\S]*_leopips_settle_finished_match/,
    "retry forfeit on a finished match still settles LeoPips (idempotent)"
  );
  assert.doesNotMatch(forfeit, /stake \* 2|_leopips_apply\(/);
  assert.doesNotMatch(forfeit, /player_xp|award_xp/);
}

{
  const abort = latestFn("_abort_stale_match(p_match_id uuid)");
  assert.match(abort, /SET status = 'aborted'/);
  assert.match(abort, /match_winner_seat = NULL/);
  assert.match(abort, /reason', 'abandoned'/);
  assert.match(abort, /_leopips_settle_finished_match/);
  assert.doesNotMatch(abort, /settle_match_global_rp/);
  assert.doesNotMatch(abort, /finish_reason = 'forfeit'/);
  assert.doesNotMatch(abort, /finish_reason = 'completed'/);
  assert.ok(
    abort.indexOf("FROM public.game_sessions") < abort.indexOf("FROM public.matches"),
    "abort locks game_sessions then matches"
  );
}

{
  const joinAbort = latestFn("_abort_join_timeout_match(p_match_id uuid)");
  assert.match(joinAbort, /finish_reason = COALESCE\(finish_reason, 'join_timeout'\)/);
  assert.match(joinAbort, /match_winner_seat = NULL/);
  assert.match(joinAbort, /_leopips_settle_finished_match/);
  assert.doesNotMatch(joinAbort, /settle_match_global_rp/);
  assert.doesNotMatch(joinAbort, /_forfeit_match_player/);
  assert.doesNotMatch(joinAbort, /match_payout/);
}

{
  const commit = latestFn("_leopips_commit_online_game_transition(");
  assert.match(commit, /require_service_role/);
  assert.match(commit, /commit_online_game_transition/);
  assert.match(commit, /_leopips_on_timeout_strike/);
  assert.match(commit, /IF p_match_status = 'finished' THEN[\s\S]*_leopips_on_match_finished/);
  const timeoutAt = commit.indexOf("_leopips_on_timeout_strike");
  const finishedAt = commit.indexOf("_leopips_on_match_finished");
  assert.ok(timeoutAt > 0 && finishedAt > timeoutAt, "timeout strike hook runs before terminal pot");
}

{
  const timeout = latestFn("_leopips_on_timeout_strike(");
  assert.match(timeout, /p_strike IS DISTINCT FROM 1 AND p_strike IS DISTINCT FROM 2/);
  assert.match(timeout, /no_third_penalty/);
  assert.doesNotMatch(timeout, /timeout_penalty:' \|\| p_match_id::text \|\| ':3/);
}

{
  const trigger = latestFn("matches_leopips_prestart_abort()");
  assert.match(trigger, /join_timeout/);
  assert.match(trigger, /abandoned/);
  assert.match(trigger, /_leopips_on_prestart_abort/);
}

assert.match(edge, /_leopips_commit_online_game_transition/);
assert.match(edge, /_leopips_install_online_game/);
assert.doesNotMatch(edge, /_forfeit_match_player|_leopips_settle_finished_match/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._leopips_commit_online_game_transition/);

assert.match(activation, /CREATE OR REPLACE FUNCTION public\._leopips_on_match_finished/);
assert.doesNotMatch(activation, /_leopips_settle_finished_match/);

assert.doesNotMatch(sql, /exact style|FIND_MATCH_STAKE|pair_limit|ranked_find_match_pair/);

const bytes = statSync(join(root, liveRel)).size;
const sha = createHash("sha256").update(readFileSync(join(root, liveRel))).digest("hex");
assert.ok(bytes > 1000, "migration is non-empty");
assert.equal(sha.length, 64);

console.log("  ✓ LeoPips terminal settlement SQL contract");
console.log(`  ✓ ${liveRel} ${bytes} bytes sha256=${sha}`);
