/**
 * Accepted but never-joined matches abort via join_timeout, not forfeit/RP.
 * Run: node src/online/prePlayingAbandonment.test.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JOIN_GRACE_MS,
  JOIN_TIMEOUT_REASON,
  applyJoinTimeoutResolution,
  isGameplayStarted,
  isReservedNotStarted,
  isResumableMatch,
  isTerminalMatch,
  joinDeadlineFromIso,
} from "./joinTimeout.js";
import { canRecoverMatch } from "./matchRecovery.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const allSql = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(root, "supabase/migrations", name), "utf8"))
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

assert.equal(JOIN_GRACE_MS, 3 * 60 * 1000);
assert.equal(JOIN_TIMEOUT_REASON, "join_timeout");

{
  const abort = latestFn("_abort_join_timeout_match(p_match_id uuid)");
  assert.match(abort, /status = 'aborted'/);
  assert.match(abort, /finish_reason = COALESCE\(finish_reason, 'join_timeout'\)/);
  assert.match(abort, /'rpChange', false/);
  assert.match(abort, /'winner', NULL/);
  assert.match(abort, /'loser', NULL/);
  assert.doesNotMatch(abort, /settle_match_global_rp/);
  assert.doesNotMatch(abort, /INSERT INTO public\.match_rp_results/);
  assert.doesNotMatch(abort, /_forfeit_match_player/);
  assert.doesNotMatch(abort, /finish_reason = 'forfeit'/);
  assert.match(abort, /SET search_path = public/);
}

{
  const resolve = latestFn("resolve_join_timeout(p_match_id uuid)");
  assert.match(resolve, /_abort_join_timeout_match/);
  assert.doesNotMatch(resolve, /settle_match_global_rp/);
  assert.doesNotMatch(resolve, /winner_seat/);
}

{
  const reservedAt = "2026-08-30T12:00:00.000Z";
  const deadline = joinDeadlineFromIso(reservedAt);
  const t0 = Date.parse(reservedAt);
  const reserved = {
    id: "m-ready",
    status: "ready",
    hasGameSession: false,
    gameplayStarted: false,
    finishReason: null,
  };
  assert.equal(isReservedNotStarted(reserved), true);
  assert.equal(isGameplayStarted(reserved), false);
  assert.equal(isResumableMatch(reserved), true);

  const aborted = applyJoinTimeoutResolution({
    currentStatus: "ready",
    gameplayStarted: false,
    now: t0 + JOIN_GRACE_MS,
    deadlineAt: deadline,
  });
  assert.equal(aborted.status, "aborted");
  assert.equal(aborted.finishReason, JOIN_TIMEOUT_REASON);
  assert.equal(aborted.winner, null);
  assert.equal(aborted.loser, null);
  assert.equal(aborted.rpChange, false);
  assert.equal(isTerminalMatch(aborted), true);
  assert.equal(isResumableMatch({ id: "m-ready", status: aborted.status, finishReason: aborted.finishReason }), false);
  assert.equal(canRecoverMatch({ id: "m-ready", status: aborted.status, finishReason: aborted.finishReason }), false);
  console.log("  ✓ accepted but never joined becomes join_timeout/aborted; not resumable");
}

{
  const playing = {
    id: "m-play",
    status: "playing",
    hasGameSession: true,
    gameplayStarted: true,
    finishReason: null,
  };
  assert.equal(isGameplayStarted(playing), true);
  assert.equal(isReservedNotStarted(playing), false);
  assert.equal(isResumableMatch(playing), true);
  console.log("  ✓ only after authoritative playing may leave use forfeit rules");
}

console.log("  ✓ pre-playing abandonment");
