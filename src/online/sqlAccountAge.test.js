/**
 * 13+ account age-gate SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAccountAge.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260828260000_account_age_gate.sql"),
  "utf8"
);

assert.match(sql, /PREPARED — not applied to hosted Postgres/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.assert_new_user_min_account_age\(\)/);
assert.match(sql, /BEFORE INSERT ON auth\.users/);
assert.match(sql, /accountAge/);
assert.match(sql, /ACCOUNT_AGE_UNDER/);
assert.match(sql, /age < 13/);
assert.match(sql, /age > 120/);
assert.match(sql, /raw_user_meta_data :=/);
assert.match(sql, /'accountAge' - 'age'/);
assert.doesNotMatch(sql, /date_of_birth|birthday|birth_year|ssn|government/i);
assert.doesNotMatch(sql, /ALTER TABLE public\.profiles ADD/);
assert.doesNotMatch(sql, /UPDATE public\.profiles SET/);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.assert_new_user_min_account_age/);
assert.match(
  sql,
  /REVOKE ALL ON FUNCTION public\.assert_new_user_min_account_age\(\) FROM PUBLIC, anon, authenticated/
);

console.log("  ✓ account age gate SQL contract");
