/**
 * Forfeit publishes terminal session before occupancy release; settle is idempotent.
 * Run: node src/online/sqlForfeitRpSync.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260827220000_global_rp.sql"),
  "utf8"
);
const sync = readFileSync(
  join(root, "supabase/migrations/20260828220000_forfeit_terminal_rp_sync.sql"),
  "utf8"
);

function sliceFn(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

{
  const forfeit = sliceFn(sync, "_forfeit_match_player(p_match_id uuid, p_forfeit_player uuid)");
  const sessionIdx = forfeit.indexOf("UPDATE public.game_sessions");
  const matchIdx = forfeit.indexOf("UPDATE public.matches");
  const liveSettleIdx = forfeit.lastIndexOf("PERFORM public.settle_match_global_rp");
  assert.ok(sessionIdx >= 0, "writes game_sessions");
  assert.ok(matchIdx >= 0, "writes matches");
  assert.ok(sessionIdx < matchIdx, "publishes match_over before occupancy-clearing finished");
  assert.ok(matchIdx < liveSettleIdx, "settles after matches.finished");
  assert.match(forfeit, /status = 'match_over'/);
  assert.match(forfeit, /phase = 'matchOver'/);
  assert.match(forfeit, /match_winner_seat = winner_seat/);
  assert.match(forfeit, /reason', 'forfeit'/);
  assert.match(
    forfeit,
    /IF match_row\.status = 'finished' THEN\s*PERFORM public\.settle_match_global_rp/,
    "repeat forfeit on a finished match still settles (idempotent)"
  );
}

{
  const settle = sliceFn(sql, "settle_match_global_rp(p_match_id uuid)");
  assert.match(settle, /FROM public\.match_rp_results/, "ledger lookup");
  assert.match(settle, /idempotent', true/, "second settle no-ops");
  assert.match(settle, /match_row\.rated/, "uses matches.rated");
  assert.match(settle, /winner_delta := 0/, "unrated +0");
  assert.match(settle, /loser_delta := 0/, "unrated -0");
  assert.match(settle, /wins = wins \+ 1/, "rated winner +1");
  assert.match(settle, /losses = losses \+ 1/, "rated loser +1");
  assert.match(settle, /winner_id := match_row\.player_a/, "seat 0 winner is player_a");
  assert.match(settle, /loser_id := match_row\.player_b/);
  assert.match(settle, /winner_id := match_row\.player_b/, "seat 1 winner is player_b");
  assert.match(settle, /INSERT INTO public\.match_rp_results/, "one ledger row for both sides");
  assert.match(settle, /WHERE player_id = winner_id/);
  assert.match(settle, /WHERE player_id = loser_id/);
  assert.match(sql, /1000 beats 1000 => 1016 \/ 984/, "equal-rated forfeit uses the same Elo vector");
}

{
  const resultRpc = sliceFn(sql, "get_match_rp_result(p_match_id uuid)");
  assert.match(resultRpc, /caller = result_row\.winner_id/, "winner sees winner_delta");
  assert.match(resultRpc, /viewer_delta := result_row\.loser_delta/, "loser sees loser_delta");
  assert.match(resultRpc, /STABLE/, "read-only result fetch");
}

{
  const occupancy = readFileSync(
    join(root, "supabase/migrations/20260826120000_one_active_match.sql"),
    "utf8"
  );
  assert.match(
    occupancy,
    /OLD\.status IN \('ready', 'playing'\)[\s\S]*NEW\.status NOT IN \('ready', 'playing'\)[\s\S]*DELETE FROM public\.active_match_players WHERE match_id = NEW\.id/,
    "finished forfeit clears occupancy for both seats"
  );
}

{
  const accept = sliceFn(sql, "accept_match_request(p_request_id uuid)");
  assert.match(accept, /COALESCE\(request\.visibility, 'public'\) IS DISTINCT FROM 'friend'/);
  assert.match(accept, /FROM public\.friendships/, "existing friends stay unrated");
}

assert.match(sync, /REVOKE ALL ON FUNCTION public\._forfeit_match_player\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);

console.log("  ✓ forfeit terminal RP sync SQL contract");
