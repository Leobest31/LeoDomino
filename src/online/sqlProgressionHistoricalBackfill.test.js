/**
 * One-time historical progression backfill SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlProgressionHistoricalBackfill.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260905140000_progression_historical_backfill.sql"),
  "utf8"
);
const live = readFileSync(
  join(root, "supabase/migrations/20260905120000_player_progression_foundation.sql"),
  "utf8"
);

function sliceFn(source, name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf("CREATE OR REPLACE FUNCTION public.", start + needle.length);
  return next >= 0 ? source.slice(start, next) : source.slice(start);
}

assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);

const fn = sliceFn(sql, "_progression_backfill_all_history(");
assert.match(fn, /p_dry_run boolean DEFAULT true/);
assert.match(fn, /SECURITY DEFINER/);
assert.match(fn, /SET search_path = public/);
assert.match(fn, /pg_advisory_xact_lock/);
assert.match(fn, /finish_reason = 'completed'/);
assert.match(fn, /match_winner_seat IN \(0, 1\)/);
assert.match(fn, /COALESCE\(m\.match_kind, 'public'\)/);
assert.match(fn, /THEN 10 ELSE 25 END/);
assert.match(fn, /THEN 5 ELSE 10 END/);
assert.match(fn, /_progression_award_player_for_match/);
assert.match(fn, /COALESCE\(p_dry_run, true\)/);
assert.match(fn, /SUM\(a\.xp_awarded\)/);
assert.match(fn, /qualifying_win_awarded/);
assert.match(fn, /progression_level_from_wins/);
assert.match(fn, /ON CONFLICT \(player_id\) DO UPDATE/);
assert.match(fn, /player_level_up_events/);
assert.match(fn, /consumed_at/);
assert.match(fn, /player_leopips_wallets/);
assert.match(fn, /wallets_unchanged/);
assert.doesNotMatch(fn, /FROM public\.player_leopips_wallets[\s\S]{0,80}UPDATE/);
assert.doesNotMatch(fn, /UPDATE public\.player_leopips_wallets/);
assert.doesNotMatch(fn, /INSERT INTO public\.leopips_ledger/);
assert.doesNotMatch(fn, /INSERT INTO public\.matches/);
assert.doesNotMatch(fn, /UPDATE public\.matches/);
assert.doesNotMatch(fn, /_leopips_credit|_leopips_debit|_leopips_on_match_finished/);
assert.doesNotMatch(fn, /find_match|submit_game_action|forfeit_online_match/);
assert.doesNotMatch(fn, /GRANT SELECT|GRANT INSERT|GRANT UPDATE/);
assert.doesNotMatch(fn, /activated_at/);

assert.match(sql, /REVOKE ALL ON FUNCTION public\._progression_backfill_all_history\(boolean\)/);
assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\._progression_backfill_all_history/);
assert.doesNotMatch(sql, /TO authenticated;/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._progression_award_finished_match/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._leopips_settle_finished_match/);
assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|ALTER TABLE/);

const liveAward = sliceFn(live, "_progression_award_finished_match(");
assert.match(liveAward, /finished_at < activated_at/);
assert.match(liveAward, /before_activation/);

assert.doesNotMatch(sql, /UPDATE public\.player_leopips_wallets SET balance/);
assert.doesNotMatch(fn, /level\s*=\s*\S*balance/);
assert.doesNotMatch(fn, /lifetime_xp\s*=\s*\S*balance/);

console.log("  ✓ sqlProgressionHistoricalBackfill contract");
