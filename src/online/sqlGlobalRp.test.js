/**
 * Global RP SQL contract.
 * Does not connect to Supabase. Run: node src/online/sqlGlobalRp.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationRel = "supabase/migrations/20260827220000_global_rp.sql";
const grantsRel = "supabase/migrations/20260827230000_harden_global_rp_rpc_grants.sql";
const sql = readFileSync(join(root, migrationRel), "utf8");
const grantsSql = readFileSync(join(root, grantsRel), "utf8");

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

function mustInclude(pattern, message) {
  assert.match(sql, pattern, message);
}

mustInclude(/CREATE TABLE public\.player_global_ratings/, "player_global_ratings table");
mustInclude(/CREATE TABLE public\.match_rp_results/, "match_rp_results ledger");
mustInclude(/ADD COLUMN IF NOT EXISTS rated boolean/, "matches.rated column");

mustInclude(
  /player_id uuid PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE/,
  "one rating row per player"
);
mustInclude(/rp integer NOT NULL DEFAULT 1000 CHECK \(rp >= 0\)/, "new player starts at 1000; RP floor 0");
mustInclude(/matches_played integer NOT NULL DEFAULT 0 CHECK \(matches_played >= 0\)/, "matches_played");
mustInclude(/wins integer NOT NULL DEFAULT 0 CHECK \(wins >= 0\)/, "wins");
mustInclude(/losses integer NOT NULL DEFAULT 0 CHECK \(losses >= 0\)/, "losses");

mustInclude(
  /INSERT INTO public\.player_global_ratings \(player_id\)[\s\S]*SELECT id FROM public\.profiles[\s\S]*ON CONFLICT \(player_id\) DO NOTHING/,
  "backfill existing profiles at 1000 without overwriting later RP"
);
mustInclude(/profiles_insert_global_rating/, "new profiles receive a rating row");
mustInclude(/ON CONFLICT \(player_id\) DO NOTHING/, "rating insert is idempotent");

mustInclude(/match_id uuid PRIMARY KEY REFERENCES public\.matches\(id\) ON DELETE CASCADE/, "one ledger row per match");
mustInclude(/rated boolean NOT NULL/, "ledger rated flag");
mustInclude(/winner_expected numeric/, "winner expected score numeric");
mustInclude(/loser_expected numeric/, "loser expected score numeric");
mustInclude(/k integer NOT NULL DEFAULT 32/, "K=32");
mustInclude(/finish_reason text/, "ledger finish_reason");
mustInclude(/settled_at timestamptz NOT NULL DEFAULT now\(\)/, "settled_at");

mustInclude(/1000 beats 1000 => 1016 \/ 984/, "1000 vs 1000 vector");
mustInclude(/1000 beats 1200 => 1024 \/ 1176/, "1000 vs 1200 vector");
mustInclude(/1200 beats 1000 => 1208 \/ 992/, "1200 vs 1000 vector");
mustInclude(/0 beats 1000 => 32 \/ 968/, "0 vs 1000 vector");
mustInclude(/5000 beats 0 => 5000 \/ 0/, "5000 vs 0 vector");
mustInclude(/0 beats 5000 => 32 \/ 4968/, "0 vs 5000 vector");

{
  const expected = sliceFn("_global_rp_expected_score(p_player_rp integer, p_opponent_rp integer)");
  assert.match(expected, /SECURITY DEFINER|LANGUAGE sql/, "expected-score helper");
  assert.match(
    expected,
    /1::numeric \/ \(\s*1::numeric \+ POWER\(\s*10::numeric,\s*\(p_opponent_rp - p_player_rp\)::numeric \/ 400::numeric/,
    "E = 1 / (1 + 10^((opp-player)/400))"
  );
  assert.match(expected, /SET search_path = public/, "trusted search_path");
}

{
  const delta = sliceFn("_global_rp_elo_delta(p_player_rp integer, p_opponent_rp integer, p_scored numeric)");
  assert.match(
    delta,
    /ROUND\(\s*32::numeric \* \(p_scored - public\._global_rp_expected_score/,
    "ROUND(32 * (actual - expected))"
  );
  assert.match(delta, /SET search_path = public/, "trusted search_path");
}

{
  const friends = sliceFn("_players_are_friends(p_a uuid, p_b uuid)");
  assert.match(friends, /FROM public\.friendships/, "authoritative friendship pair");
  assert.match(friends, /uuid_pair_low/, "canonical pair low");
  assert.match(friends, /uuid_pair_high/, "canonical pair high");
  assert.doesNotMatch(friends, /isFriend|p_is_friend/, "does not trust client isFriend");
}

{
  const accept = sliceFn("accept_match_request(p_request_id uuid)");
  assert.match(
    accept,
    /INSERT INTO public\.matches \(request_id, ruleset_id, player_a, player_b, status, match_kind, rated\)/,
    "stamps rated at accept"
  );
  assert.match(
    accept,
    /COALESCE\(request\.visibility, 'public'\) IS DISTINCT FROM 'friend'/,
    "friend invite / Play With a Friend is unrated"
  );
  assert.match(accept, /NOT EXISTS \(/, "non-friend public Find Match can be rated");
  assert.match(accept, /FROM public\.friendships/, "friends meeting via Find Match are unrated");
  assert.match(accept, /uuid_pair_low\(request\.creator_id, caller\)/, "backend friendship pair");
  assert.doesNotMatch(accept, /p_rated|isFriend|p_is_friend/, "does not take client rated/friend flags");
  assert.doesNotMatch(accept, /UPDATE public\.matches[\s\S]*rated/, "does not restamp rated later");
}

{
  const protect = sliceFn("matches_protect_ruleset()");
  assert.match(protect, /matches\.rated is immutable/, "rated cannot change after accept");
  assert.match(protect, /matches\.match_kind is immutable/, "keeps match_kind protection");
}

{
  const settle = sliceFn("settle_match_global_rp(p_match_id uuid)");
  assert.match(settle, /SECURITY DEFINER/, "internal settler");
  assert.match(settle, /SET search_path = public/, "trusted search_path");
  assert.match(settle, /FROM public\.matches[\s\S]*FOR UPDATE/, "locks the match");
  assert.match(settle, /FROM public\.match_rp_results/, "returns safely if already settled");
  assert.match(settle, /idempotent', true/, "repeated settlement no-ops");
  assert.match(settle, /reason', 'aborted'|reason', 'no_winner'/, "aborted / no-winner skips ledger");
  assert.match(settle, /status IS DISTINCT FROM 'finished'/, "requires terminal finished state");
  assert.match(settle, /match_winner_seat/, "winner from authoritative game_sessions");
  assert.match(settle, /winner_id := match_row\.player_a/, "seat 0 = player_a");
  assert.match(settle, /winner_id := match_row\.player_b/, "seat 1 = player_b");
  assert.match(settle, /match_row\.rated/, "uses matches.rated stamped at accept");
  assert.match(settle, /WHERE player_id = first_id FOR UPDATE/, "locks ratings in UUID order");
  assert.match(settle, /WHERE player_id = second_id FOR UPDATE/, "second rating lock");
  assert.match(settle, /_global_rp_elo_delta/, "rated Elo");
  assert.match(settle, /GREATEST\(0, winner_old \+ winner_delta\)/, "RP floor 0");
  assert.match(settle, /GREATEST\(0, loser_old \+ loser_delta\)/, "loser RP floor 0");
  assert.match(settle, /wins = wins \+ 1/, "rated winner +1 win");
  assert.match(settle, /losses = losses \+ 1/, "rated loser +1 loss");
  assert.match(settle, /matches_played = matches_played \+ 1/, "rated matches_played +1");
  assert.match(settle, /winner_delta := 0/, "unrated +0");
  assert.match(settle, /loser_delta := 0/, "unrated -0");
  assert.match(settle, /INSERT INTO public\.match_rp_results/, "writes immutable ledger row");
  assert.match(settle, /rated,[\s\S]*false|match_row\.rated/, "unrated completed matches still get a ledger row");
  assert.doesNotMatch(settle, /p_winner|p_loser|p_old_rp|p_new_rp|p_delta|p_rated|p_k\b/, "no client RP arguments");
  assert.doesNotMatch(settle, /challenge_cp|league_lp|leo_coins|LeoCoins|leo_best/i, "does not mix other currencies");
}

{
  const commit = sliceFn("commit_online_game_transition(");
  assert.match(commit, /finish_reason = COALESCE\(finish_reason, 'completed'\)/, "normal completion reason");
  assert.match(commit, /match_winner_seat = NULLIF\(p_public->>'matchWinnerSeat'/, "writes winner before settle");
  assert.match(
    commit,
    /p_match_status = 'finished'[\s\S]*settle_match_global_rp\(p_match_id\)/,
    "settles after terminal completed write"
  );
  assert.doesNotMatch(commit, /p_public->>'winnerId'|p_public->>'newRp'|p_public->>'rated'/, "client cannot submit RP fields");
}

{
  const forfeit = sliceFn("_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  assert.match(forfeit, /idempotent', true/, "repeat forfeit is idempotent");
  assert.match(forfeit, /match_winner_seat = winner_seat/, "writes session winner");
  assert.match(
    forfeit,
    /match_winner_seat = winner_seat[\s\S]*settle_match_global_rp\(p_match_id\)/,
    "settles after first real forfeit winner write"
  );
  const idempotentBlock = forfeit.slice(
    forfeit.indexOf("IF match_row.status NOT IN"),
    forfeit.indexOf("UPDATE public.matches")
  );
  assert.doesNotMatch(idempotentBlock, /settle_match_global_rp/, "does not settle on idempotent repeats");
}

assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._abort_stale_match/, "does not settle from abort");
assert.doesNotMatch(sql, /_abort_stale_match[\s\S]*settle_match_global_rp/, "abort path not rewritten to settle");

{
  const mine = sliceFn("get_my_global_rating()");
  assert.match(mine, /caller uuid := auth\.uid\(\)/, "authenticated-only");
  assert.match(mine, /authentication required/, "rejects anon");
  assert.match(mine, /'rp'/, "returns rp");
  assert.match(mine, /'matches_played'/, "returns matches_played");
  assert.match(mine, /'wins'/, "returns wins");
  assert.match(mine, /'losses'/, "returns losses");
  assert.match(mine, /'win_rate'/, "returns win_rate");
  assert.match(mine, /'global_rank'/, "returns computed rank");
  assert.match(mine, /1 \+ COUNT\(\*\)/, "rank = 1 + players with strictly greater RP");
  assert.match(mine, /WHERE rp > rating\.rp/, "ties share rank");
  assert.doesNotMatch(mine, /UPDATE public\.player_global_ratings SET rp/, "read RPC does not mutate RP");
}

{
  const result = sliceFn("get_match_rp_result(p_match_id uuid)");
  assert.match(result, /authentication required/, "authenticated-only");
  assert.match(result, /not a seated player/, "participants only");
  assert.match(result, /'rated'/, "returns rated");
  assert.match(result, /'old_rp'/, "viewer old RP");
  assert.match(result, /'new_rp'/, "viewer new RP");
  assert.match(result, /'delta'/, "viewer delta");
  assert.match(result, /'opponent_delta'/, "opponent delta");
  assert.match(result, /'finish_reason'/, "finish_reason");
  assert.doesNotMatch(result, /winner_old_rp, loser_old_rp/, "does not dump both private RP histories raw");
}

mustInclude(
  /REVOKE ALL ON FUNCTION public\.settle_match_global_rp\(uuid\) FROM PUBLIC, anon, authenticated/,
  "settler not callable by clients"
);
mustInclude(
  /REVOKE ALL ON FUNCTION public\._global_rp_elo_delta\(integer, integer, numeric\) FROM PUBLIC, anon, authenticated/,
  "elo helper revoked"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.get_my_global_rating\(\) TO authenticated/,
  "rating read RPC granted"
);
mustInclude(
  /GRANT EXECUTE ON FUNCTION public\.get_match_rp_result\(uuid\) TO authenticated/,
  "match result read RPC granted"
);

mustInclude(/ENABLE ROW LEVEL SECURITY/, "RLS enabled");
mustInclude(/player_global_ratings_select_own/, "own rating readable");
mustInclude(/match_rp_results_select_participants/, "participants can read ledger");
mustInclude(/match_rp_results is immutable/, "ledger rows cannot mutate after insert");
assert.doesNotMatch(
  sql,
  /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.player_global_ratings/,
  "clients cannot mutate ratings"
);
assert.doesNotMatch(
  sql,
  /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.match_rp_results/,
  "clients cannot mutate ledger"
);
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR (INSERT|UPDATE|DELETE)[\s\S]*player_global_ratings/, "no client write policies on ratings");
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*FOR (INSERT|UPDATE|DELETE)[\s\S]*match_rp_results/, "no client write policies on ledger");

assert.doesNotMatch(sql, /challenge_cp|league_lp|leo_coins|LeoCoins/i, "does not touch Challenge CP / League LP / LeoCoins");
assert.doesNotMatch(sql, /leo_best|LeoBest/i, "does not touch LeoBest");
assert.doesNotMatch(sql, /referral_qualifying_matches|ensure_my_referral_code|_generate_referral_code/, "does not touch Invite & Win");
assert.doesNotMatch(sql, /p_winner_id|p_loser_id|p_old_rp|p_new_rp|p_rp_delta/, "no client-submitted settlement args");

assert.match(
  grantsSql,
  /REVOKE ALL ON FUNCTION public\.get_my_global_rating\(\) FROM PUBLIC/,
  "revoke get_my_global_rating from PUBLIC"
);
assert.match(
  grantsSql,
  /REVOKE ALL ON FUNCTION public\.get_my_global_rating\(\) FROM anon/,
  "revoke get_my_global_rating from anon"
);
assert.match(
  grantsSql,
  /GRANT EXECUTE ON FUNCTION public\.get_my_global_rating\(\) TO authenticated/,
  "grant get_my_global_rating to authenticated"
);
assert.match(
  grantsSql,
  /REVOKE ALL ON FUNCTION public\.get_match_rp_result\(uuid\) FROM PUBLIC/,
  "revoke get_match_rp_result from PUBLIC"
);
assert.match(
  grantsSql,
  /REVOKE ALL ON FUNCTION public\.get_match_rp_result\(uuid\) FROM anon/,
  "revoke get_match_rp_result from anon"
);
assert.match(
  grantsSql,
  /GRANT EXECUTE ON FUNCTION public\.get_match_rp_result\(uuid\) TO authenticated/,
  "grant get_match_rp_result to authenticated"
);
assert.doesNotMatch(grantsSql, /CREATE OR REPLACE FUNCTION/, "does not alter function bodies");
assert.doesNotMatch(grantsSql, /ALTER TABLE|CREATE TABLE|CREATE POLICY|UPDATE |INSERT |DELETE /, "does not alter tables, RLS, or data");
assert.doesNotMatch(grantsSql, /settle_match_global_rp/, "does not touch settler grants");

console.log("  ✓ Global RP SQL contract");
