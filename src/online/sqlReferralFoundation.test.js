/**
 * Invite & Win referral foundation SQL contract.
 * Does not connect to Supabase. Run: node src/online/sqlReferralFoundation.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260827180000_referral_foundation.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.referral_seasons/, "referral_seasons table");
mustInclude(/CREATE TABLE public\.player_referral_codes/, "player_referral_codes table");
mustInclude(/CREATE TABLE public\.referrals/, "referrals table");
mustInclude(/CREATE TABLE public\.referral_qualifying_matches/, "qualifying-match ledger");

mustInclude(/status text NOT NULL DEFAULT 'upcoming'/, "season status default");
mustInclude(
  /status IN \('upcoming', 'active', 'ended', 'under_review', 'finalized'\)/,
  "season statuses"
);
mustInclude(/prize_amount_usd numeric\(10, 2\) NOT NULL DEFAULT 500\.00/, "$500 prize metadata");
mustInclude(/prize_currency text NOT NULL DEFAULT 'USD'/, "USD prize currency");
mustInclude(/winner_player_id uuid REFERENCES public\.profiles/, "winner is optional metadata");
mustInclude(/CREATE UNIQUE INDEX referral_seasons_one_active/, "at most one active season");
mustInclude(/CREATE UNIQUE INDEX referral_seasons_slug_key/, "unique season slug");
assert.doesNotMatch(sql, /INSERT INTO public\.referral_seasons/, "no seeded season");
assert.doesNotMatch(sql, /SET winner_player_id/, "does not auto-assign a winner");
assert.doesNotMatch(sql, /stripe|paypal|payout|transfer/i, "does not pay the prize");

mustInclude(
  /player_id uuid PRIMARY KEY REFERENCES public\.profiles/,
  "one code row per player"
);
mustInclude(/CREATE UNIQUE INDEX player_referral_codes_code_key/, "codes are unique");
mustInclude(/code ~ '\^\[A-HJ-NP-Z2-9\]\{8\}\$'/, "server code alphabet");
mustInclude(/player_referral_codes\.code is immutable/, "codes cannot be rewritten");

mustInclude(/CONSTRAINT referrals_not_self CHECK \(referrer_id <> referred_id\)/, "no self-referral");
mustInclude(/status IN \('pending', 'validated', 'rejected'\)/, "referral states");
mustInclude(/CREATE UNIQUE INDEX referrals_one_per_referred/, "one referrer per new account");
mustInclude(/referrals\.referrer_id is immutable/, "referrer locked after attribution");
mustInclude(/referrals\.referred_id is immutable/, "referred player locked");
mustInclude(/referrals\.season_id is immutable/, "season locked");
mustInclude(/current_setting\('leodomino\.referral_evaluate', true\) IS DISTINCT FROM 'on'/, "status is server-gated");
mustInclude(/referral status is terminal/, "validated/rejected cannot move");
mustInclude(/PRIMARY KEY \(referral_id, match_id\)/, "no double-count of the same match");

mustInclude(/ENABLE ROW LEVEL SECURITY/, "RLS enabled");
mustInclude(/GRANT SELECT ON TABLE public\.referral_seasons TO authenticated/, "seasons readable");
mustInclude(
  /REVOKE ALL ON TABLE public\.referrals FROM PUBLIC, anon, authenticated/,
  "referrals fail closed"
);
assert.doesNotMatch(
  sql,
  /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.referrals/,
  "no client mutation grants on referrals"
);
assert.doesNotMatch(
  sql,
  /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.player_referral_codes/,
  "no client mutation grants on codes"
);
assert.doesNotMatch(sql, /\binet\b|\bcidr\b|ip_address|client_ip/i, "does not reject by IP");
assert.doesNotMatch(sql, /supabase_realtime/, "not added to Realtime");
assert.doesNotMatch(sql, /raw_user_meta_data/, "does not read user metadata blobs");
assert.doesNotMatch(sql, /u\.email[^_]|u\.phone[^_]/, "does not return auth contact values");

{
  const apply = sliceFn("apply_referral_code(p_code text)");
  assert.match(apply, /caller uuid := auth\.uid\(\)/);
  assert.match(apply, /authentication required/);
  assert.match(apply, /cannot refer yourself/);
  assert.match(apply, /interval '7 days'/);
  assert.match(apply, /referrer already locked/);
  assert.match(apply, /status = 'active'/);
  assert.match(apply, /WHEN unique_violation THEN/);
  assert.match(apply, /'pending'/);
  assert.doesNotMatch(apply, /'validated'/);
}

{
  const ensure = sliceFn("ensure_my_referral_code()");
  assert.match(ensure, /caller uuid := auth\.uid\(\)/);
  assert.match(ensure, /_generate_referral_code/);
  assert.doesNotMatch(ensure, /p_code/);
}

{
  const evaluate = sliceFn("_evaluate_referral(p_referral_id uuid)");
  assert.match(evaluate, /qualifying_match_count >= 10/);
  assert.match(evaluate, /player_meets_referral_verification/);
  assert.match(evaluate, /set_config\('leodomino\.referral_evaluate', 'on', true\)/);
  assert.match(evaluate, /status = 'validated'/);
  assert.doesNotMatch(evaluate, /GRANT EXECUTE/);
}

{
  const credit = sliceFn("_credit_referral_qualifying_matches(p_referral_id uuid)");
  assert.match(credit, /m\.status = 'finished'/);
  assert.match(credit, /m\.match_kind = 'public'/);
  assert.match(credit, /m\.finish_reason = 'completed'/);
  assert.match(credit, /m\.finished_at IS NOT NULL/);
  assert.match(credit, /m\.finished_at >= r\.attributed_at/);
  assert.match(credit, /m\.finished_at <= season\.ends_at/);
  assert.match(credit, /ON CONFLICT \(referral_id, match_id\) DO NOTHING/);
  assert.doesNotMatch(credit, /game_sessions/);
  assert.doesNotMatch(credit, /updated_at/);
  assert.doesNotMatch(credit, /p_match_count|client_count/);
}

mustInclude(/ADD COLUMN IF NOT EXISTS finished_at timestamptz/, "matches.finished_at");
mustInclude(/ADD COLUMN IF NOT EXISTS finish_reason text/, "matches.finish_reason");
mustInclude(/ADD COLUMN IF NOT EXISTS match_kind text/, "matches.match_kind");
mustInclude(/matches_match_kind_check/, "public vs friend origin");
mustInclude(/finish_reason IN \('completed', 'forfeit', 'aborted'\)/, "authoritative finish reasons");
mustInclude(/matches\.finished_at is immutable/, "finished_at locked after write");
mustInclude(/matches\.finish_reason is immutable/, "finish_reason locked after write");
mustInclude(/matches\.match_kind is immutable/, "match_kind locked");

{
  const accept = sliceFn("accept_match_request(p_request_id uuid)");
  assert.match(accept, /INSERT INTO public\.matches \(request_id, ruleset_id, player_a, player_b, status, match_kind\)/);
  assert.match(accept, /WHEN COALESCE\(request\.visibility, 'public'\) = 'friend' THEN 'friend'/);
  assert.doesNotMatch(accept, /p_match_kind/);
}

{
  const commit = sliceFn("commit_online_game_transition(");
  assert.match(commit, /PERFORM public\.require_service_role\(\)/);
  assert.match(commit, /finish_reason = COALESCE\(finish_reason, 'completed'\)/);
  assert.match(commit, /finished_at = COALESCE\(finished_at, now\(\)\)/);
  assert.match(commit, /status <> 'aborted'/);
  assert.doesNotMatch(commit, /p_public->>'finishReason'/);
  assert.doesNotMatch(commit, /p_public->>'finishedAt'/);
}

{
  const forfeit = sliceFn("forfeit_online_match(p_match_id uuid)");
  assert.match(forfeit, /finish_reason = COALESCE\(finish_reason, 'forfeit'\)/);
  assert.match(forfeit, /finished_at = COALESCE\(finished_at, now\(\)\)/);
  assert.doesNotMatch(forfeit, /p_finish_reason/);
}

{
  const stamp = sliceFn("matches_stamp_terminal()");
  assert.match(stamp, /NEW\.status = 'aborted'/);
  assert.match(stamp, /finish_reason := COALESCE\(NEW\.finish_reason, 'aborted'\)/);
}

{
  const verify = sliceFn("player_meets_referral_verification(p_player uuid)");
  assert.match(verify, /FROM auth\.users u/);
  assert.match(verify, /email_confirmed_at IS NOT NULL/);
  assert.doesNotMatch(verify, /RETURN u\.email/);
  assert.doesNotMatch(verify, /u\.phone,/);
  assert.doesNotMatch(verify, /u\.email,/);
}

{
  const refresh = sliceFn("refresh_my_referral_progress()");
  assert.match(refresh, /caller uuid := auth\.uid\(\)/);
  assert.match(refresh, /referred_id = caller/);
  assert.match(refresh, /_evaluate_referral/);
  assert.doesNotMatch(refresh, /SET\s+status/);
}

assert.match(sql, /CREATE TRIGGER referrals_after_match_finished/);
assert.doesNotMatch(sql, /referrals_after_session_match_over/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_referral_code\(text\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ensure_my_referral_code\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.refresh_my_referral_progress\(\) TO authenticated/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_my_referral_profile\(\) TO authenticated/);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\._evaluate_referral\(uuid\) FROM PUBLIC, anon, authenticated/
);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.referral_validated_count\(uuid, uuid\) FROM PUBLIC, anon, authenticated/
);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._evaluate_referral/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._credit_referral_qualifying_matches/);
assert.doesNotMatch(sql, /leo_coins|challenge_cp|league_lp/i);

console.log("  ✓ referral foundation SQL contract");
