/**
 * LeoPips playing-start stake debit invariant (local migrations).
 * Run: node src/online/sqlLeopipsPlayingRequiresStake.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase/migrations");
const rel = "20260905170000_leopips_playing_requires_both_stake_debits.sql";
const sql = readFileSync(join(migrationsDir, rel), "utf8");
const edge = readFileSync(join(root, "supabase/functions/online-game/index.js"), "utf8");
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
  assert.ok(start >= 0, `latest ${name}`);
  const bodyStart = allSql.indexOf("AS $$", start);
  const bodyEnd = bodyStart >= 0 ? allSql.indexOf("$$;", bodyStart + 5) : -1;
  const end = bodyEnd >= 0 ? bodyEnd + 3 : allSql.length;
  return allSql.slice(start, end);
}

assert.match(sql, /Do NOT apply to hosted Supabase/);
assert.match(sql, /\bBEGIN;/);
assert.match(sql, /\bCOMMIT;/);
assert.doesNotMatch(sql, /32e9df21|5cace3cd|369c7279/);
assert.doesNotMatch(sql, /UPDATE public\.player_leopips_wallets|INSERT INTO public\.leopips_ledger/);

{
  const req = latestFn("_leopips_require_both_match_stakes(p_match_id uuid)");
  assert.match(req, /SECURITY DEFINER/);
  assert.match(req, /SET search_path = public/);
  assert.match(req, /friend_or_unstaked/);
  assert.match(req, /_leopips_debit_both_stored_match_stakes/);
  assert.match(req, /LEOPIPS_STAKE_REQUIRED/);
  assert.match(req, /reason = 'match_stake'/);
  assert.match(req, /stake_rows IS DISTINCT FROM 2/);
  assert.doesNotMatch(req, /GRANT EXECUTE/);
}

{
  const start = latestFn("_leopips_on_playing_start(p_match_id uuid)");
  assert.match(start, /require_service_role/);
  assert.match(start, /_leopips_require_both_match_stakes/);
}

{
  const install = latestFn("install_online_game(");
  assert.match(install, /require_service_role/);
  assert.match(install, /_leopips_require_both_match_stakes/);
  const gateAt = install.indexOf("_leopips_require_both_match_stakes");
  const insertAt = install.indexOf("INSERT INTO public.game_sessions");
  const playingAt = install.indexOf("SET status = 'playing'");
  assert.ok(gateAt > 0 && insertAt > gateAt, "stake gate before session insert");
  assert.ok(playingAt > insertAt, "playing after insert");
  assert.match(install, /ON CONFLICT \(match_id\) DO NOTHING/);
  // Idempotent path also re-checks stakes
  const conflictReturn = install.indexOf("'created', false");
  assert.ok(
    install.indexOf("_leopips_require_both_match_stakes", gateAt + 10) > 0,
    "conflict path re-verifies stakes"
  );
  assert.ok(conflictReturn > 0);
}

{
  const debit = latestFn("_leopips_debit_both_match_stakes(");
  assert.match(debit, /INSUFFICIENT_LEOPIPS/);
  assert.match(debit, /first_wallet\.balance < p_stake/);
  assert.match(debit, /second_wallet\.balance < p_stake/);
  assert.match(debit, /_leopips_debit_match_stake\(first_id/);
  assert.match(debit, /_leopips_debit_match_stake\(second_id/);
  const single = latestFn("_leopips_debit_match_stake(");
  assert.match(single, /match_stake:/);
  assert.match(single, /'match_stake'/);
}

assert.match(edge, /_leopips_install_online_game/);
assert.match(edge, /LEOPIPS_INSTALL_REQUIRED/);
assert.match(edge, /stake_pips/);
assert.match(edge, /Fail closed for staked/);
assert.doesNotMatch(
  edge,
  /if \(!isMissingRpcError\(error\)\) throw error;\s*data = await rest\("\/rpc\/install_online_game"/
);

console.log("  ✓ sqlLeopipsPlayingRequiresStake contract");
