/**
 * LeoPips: non-completed partial pot (1.5S) + retained 0.5S (local migration).
 * Covers forfeit / abandon / timeout-win.
 * Run: node src/online/sqlLeopipsNoPotPayoutNonCompleted.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase/migrations");
const rel = "20260905180000_leopips_no_pot_payout_non_completed.sql";
const sql = readFileSync(join(migrationsDir, rel), "utf8");
const allSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n\n");
const progress = readFileSync(join(root, "src/leopips/leopipsProgress.js"), "utf8");
const policy = readFileSync(join(root, "src/leopips/leopipsPolicy.js"), "utf8");
const timeoutSrc = [
  "20260903120000_leopips_wallet_foundation.sql",
  "20260903160000_leopips_activation_settlement.sql",
]
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

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
  assert.ok(start >= 0, `latest ${name}`);
  const bodyStart = allSql.indexOf("AS $$", start);
  const bodyEnd = bodyStart >= 0 ? allSql.indexOf("$$;", bodyStart + 5) : -1;
  return allSql.slice(start, bodyEnd >= 0 ? bodyEnd + 3 : allSql.length);
}

assert.match(sql, /Do NOT apply to hosted/);
assert.match(sql, /leopips_match_retentions/);
assert.match(sql, /1\.5S|stake \* 3\) \/ 2/);
assert.match(sql, /retained := stake \/ 2/);
assert.match(sql, /timeout_half_stake/);
assert.match(sql, /timeout_penalties_untouched/);
assert.doesNotMatch(sql, /stakes_retained|removed from circulation/i);
assert.doesNotMatch(sql, /32e9df21|5cace3cd|369c7279/);
assert.doesNotMatch(sql, /house_wallet|system_wallet/i);

{
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.leopips_match_retentions/);
  assert.match(sql, /forfeit_half_stake/);
  assert.match(sql, /abandon_half_stake/);
  assert.match(sql, /timeout_half_stake/);
  assert.match(sql, /match_retention:half_stake:/);
  assert.match(sql, /amount \* 2 = stake_pips/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.leopips_match_retentions/);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.leopips_match_retentions TO authenticated/);
}

{
  const credit = latestFn("_leopips_credit_match_payout(");
  assert.match(credit, /normal_win/);
  assert.match(credit, /stake \* 2/);
  assert.match(credit, /match_payout:/);
  assert.doesNotMatch(credit, /timeout_win|forfeit_win|abandon_win/);
}

{
  const partial = latestFn("_leopips_credit_forfeit_abandon_partial(");
  assert.match(partial, /\(stake \* 3\) \/ 2/);
  assert.match(partial, /retained := stake \/ 2/);
  assert.match(partial, /'forfeit', 'abandon', 'abandoned', 'timeout'/);
  assert.match(partial, /timeout_half_stake/);
  assert.match(partial, /winner_credit/);
  assert.match(partial, /loser_credit',\s*0|abandoner_credit',\s*0/);
  assert.match(partial, /match_retention:half_stake:/);
  assert.match(partial, /leopips_match_retentions/);
  assert.match(partial, /ON CONFLICT \(match_id\) DO NOTHING/);
  assert.match(partial, /timeout_penalties_untouched/);
  assert.equal((150 * 3) / 2, 225);
  assert.equal(150 / 2, 75);
  assert.equal(225 - 150 + -150 + 75, 0);
  for (const s of [20, 50, 100, 150]) {
    assert.equal((s * 3) % 2, 0);
    assert.equal((s * 3) / 2 + s / 2, s * 2);
  }
}

{
  const settle = latestFn("_leopips_settle_finished_match(p_match_id uuid)");
  assert.match(settle, /finish_reason = 'completed'/);
  assert.match(settle, /normal_win/);
  assert.match(settle, /_leopips_credit_forfeit_abandon_partial/);
  assert.match(settle, /non_completed_partial/);
  assert.match(settle, /'forfeit', 'abandon', 'abandoned', 'timeout'/);
  assert.doesNotMatch(settle, /timeout_win|forfeit_win|abandon_win|timeout_full_pot/);
  assert.match(settle, /_progression_award_finished_match/);
  assert.match(settle, /_leopips_try_credit_referral_after_match/);
  assert.match(settle, /_leopips_refund_both_match_stakes/);
}

assert.match(timeoutSrc, /timeout_penalty/);
assert.match(timeoutSrc, /p_reason = 'timeout_penalty'|timeout_penalty/);
// Pot settlement must not write/adjust timeout_penalty rows (comments may mention them).
assert.doesNotMatch(sql, /_leopips_timeout_penalty|reason\s*=\s*'timeout_penalty'|INSERT INTO public\.leopips_ledger[\s\S]*timeout_penalty/);
assert.match(sql, /timeout_penalties_untouched/);

assert.match(sql, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.player_leopips_wallets/);

assert.match(progress, /leoPipsMayAwardXp/);
assert.match(progress, /return reason === "completed"/);
assert.match(policy, /forfeit_abandon_partial|1\.5S/);

console.log("  ✓ sqlLeopipsNonCompletedPartialPot contract");
