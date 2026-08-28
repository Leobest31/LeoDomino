/**
 * Player feedback SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlFeedback.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260828250000_player_feedback.sql"),
  "utf8"
);

function sliceFn(name) {
  const needle = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.indexOf(needle);
  assert.ok(start >= 0, `${name} exists`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION public.", start + 10);
  return next >= 0 ? sql.slice(start, next) : sql.slice(start);
}

assert.match(sql, /CREATE TABLE public\.player_feedback/);
assert.match(sql, /player_id uuid NOT NULL REFERENCES public\.profiles/);
assert.match(sql, /category IN \('general', 'bug', 'feature'\)/);
assert.match(sql, /status IN \('new', 'reviewed', 'resolved'\)/);
assert.match(sql, /status text NOT NULL DEFAULT 'new'/);
assert.match(sql, /char_length\(body\) BETWEEN 20 AND 2000/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /REVOKE ALL ON TABLE public\.player_feedback FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(sql, /GRANT SELECT ON TABLE public\.player_feedback/);
assert.doesNotMatch(sql, /GRANT INSERT ON TABLE public\.player_feedback/);
assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.player_feedback/);
assert.doesNotMatch(sql, /GRANT DELETE ON TABLE public\.player_feedback/);
assert.doesNotMatch(sql, /CREATE POLICY/, "no player table policies");
assert.doesNotMatch(sql, /email|display_name|gps|location|device_id/i);

{
  const submit = sliceFn("submit_my_feedback");
  assert.match(submit, /caller uuid := auth\.uid\(\)/, "authenticated player_id");
  assert.match(submit, /VALUES \(\s*caller/, "player_id is auth.uid()");
  assert.doesNotMatch(submit, /p_player_id|p_status/, "client cannot supply player_id or status");
  assert.match(submit, /'new'/, "status stamped new");
  assert.match(submit, /FEEDBACK_CATEGORY/);
  assert.match(submit, /FEEDBACK_BODY_SHORT/);
  assert.match(submit, /FEEDBACK_BODY_LONG/);
  assert.match(submit, /FEEDBACK_RATE_LIMIT/);
  assert.match(submit, /interval '1 hour'/);
  assert.match(submit, /\) >= 5 THEN/, "max 5 per rolling hour");
  assert.match(submit, /char_length\(cleaned\) < 20/);
  assert.match(submit, /char_length\(cleaned\) > 2000/);
  assert.match(submit, /authentication required/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_my_feedback\(text, text, text, text, text\) TO authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_my_feedback\(text, text, text, text, text\) FROM PUBLIC, anon/);
}

assert.doesNotMatch(sql, /delete-account|prepare_my_account_deletion/);
assert.doesNotMatch(sql, /settle_match_global_rp|friend_messages|player_global_ratings/);

console.log("  ✓ player feedback SQL contract");
