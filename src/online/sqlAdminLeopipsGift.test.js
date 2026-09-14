/**
 * Admin "Send LeoPips Gift" SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAdminLeopipsGift.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260907020000_admin_leopips_gift.sql"),
  "utf8"
);

function sliceFn(name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

// Additive reason enum: every existing value preserved, 'admin_gift' added.
assert.match(
  sql,
  /CHECK \(reason IN \(\s*'initial_grant',\s*'match_stake',\s*'match_payout',\s*'timeout_penalty',\s*'referral_reward',\s*'admin_adjustment',\s*'admin_gift',\s*'correction'\s*\)\)/
);
assert.match(sql, /leopips_ledger_admin_gift_shape/);
assert.match(sql, /reason <> 'admin_gift' OR \(amount > 0 AND match_id IS NULL AND referral_id IS NULL\)/);

// Never redefines the reused primitives — only calls them.
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._leopips_apply/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\._admin_write_audit/);
assert.doesNotMatch(sql, /CREATE TABLE/);

{
  const fn = sliceFn("admin_gift_leopips(");
  // Authorization gate: authenticated + staff('admin') or higher, before any read/write.
  assert.match(fn, /caller uuid := auth\.uid\(\)/);
  assert.match(fn, /IF caller IS NULL THEN\s*\n\s*RAISE EXCEPTION 'authentication required'/);
  assert.match(fn, /IF NOT public\.is_staff\('admin'\) THEN\s*\n\s*RAISE EXCEPTION 'staff required'/);
  const authAt = fn.indexOf("is_staff('admin')");
  const applyAt = fn.indexOf("public._leopips_apply(");
  assert.ok(authAt > 0 && authAt < applyAt, "staff check happens before any credit is applied");

  // Reject zero / negative amount.
  assert.match(fn, /p_amount IS NULL OR p_amount <= 0/);
  // Reject nonexistent (or soft-deleted) player before crediting.
  const playerCheckAt = fn.indexOf("deleted_at IS NULL");
  assert.ok(playerCheckAt > 0 && playerCheckAt < applyAt, "player existence checked before credit");
  assert.match(fn, /RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002'/);

  // Idempotency key required and namespaced distinctly from other reasons' keys.
  assert.match(fn, /safe_key := NULLIF\(btrim\(COALESCE\(p_idempotency_key, ''\)\), ''\)/);
  assert.match(fn, /IF safe_key IS NULL THEN\s*\n\s*RAISE EXCEPTION 'idempotency key required'/);
  assert.match(fn, /'admin_gift:' \|\| safe_key/);

  // Reuses the single atomic writer verbatim — no bespoke balance math here.
  assert.match(fn, /applied := public\._leopips_apply\(\s*\n\s*p_player_id,\s*\n\s*p_amount,\s*\n\s*'admin_gift',/);

  // Duplicate retry: relies on _leopips_apply's own dedup; never a second credit path.
  assert.match(fn, /COALESCE\(\(applied->>'duplicate'\)::boolean, false\)/);
  assert.doesNotMatch(fn, /UPDATE public\.player_leopips_wallets/);
  assert.doesNotMatch(fn, /INSERT INTO public\.leopips_ledger/);

  // Audit trail: actor identity + note + created_at via the existing writer,
  // only for an actual state change (not replayed on every duplicate retry).
  const auditAt = fn.indexOf("public._admin_write_audit(");
  assert.ok(auditAt > applyAt, "audit write happens after the credit attempt");
  assert.match(fn, /IF COALESCE\(\(applied->>'applied'\)::boolean, false\) THEN\s*\n\s*audit_id := public\._admin_write_audit\(/);
  assert.match(fn, /'leopips_gift',\s*\n\s*'player',\s*\n\s*p_player_id::text,\s*\n\s*safe_reason,/);

  // Response carries the reviewable before/after the UI needs.
  assert.match(fn, /'balance_before', balance_before/);
  assert.match(fn, /'balance_after', \(applied->>'balance'\)::integer/);
}

assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_gift_leopips\(uuid, integer, text, text\) TO authenticated/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.admin_gift_leopips\(uuid, integer, text, text\) FROM PUBLIC, anon/);

console.log("  ✓ admin LeoPips gift SQL contract");
