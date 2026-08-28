/**
 * Auth metadata non-retention SQL contract. Does not connect to Supabase.
 * Run: node src/online/sqlAccountAgeUpdateStrip.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20260828270000_strip_account_age_on_auth_update.sql"),
  "utf8"
);
const insertSql = readFileSync(
  join(root, "supabase/migrations/20260828260000_account_age_gate.sql"),
  "utf8"
);

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.strip_account_age_from_auth_metadata\(\)/);
assert.match(sql, /BEFORE UPDATE OF raw_user_meta_data ON auth\.users/);
assert.match(sql, /NEW\.raw_user_meta_data :=/);
assert.match(sql, /'accountAge' - 'age'/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.strip_account_age_from_auth_metadata\(\) FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(sql, /GRANT EXECUTE/);
assert.doesNotMatch(sql, /ACCOUNT_AGE_UNDER|age < 13|age > 120/);
assert.doesNotMatch(sql, /RAISE EXCEPTION/);
assert.doesNotMatch(sql, /ALTER TABLE/);
assert.doesNotMatch(sql, /UPDATE auth\.users SET/);
assert.doesNotMatch(sql, /UPDATE public\.profiles/);
assert.doesNotMatch(sql, /INSERT INTO/);
assert.doesNotMatch(sql, /DELETE FROM/);
assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY|CREATE POLICY|GRANT /);
assert.doesNotMatch(sql, /date_of_birth|birthday|birth_year|ssn|government/i);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.assert_new_user_min_account_age/);
assert.doesNotMatch(sql, /DROP TRIGGER IF EXISTS assert_new_user_min_account_age/);
assert.doesNotMatch(sql, /BEFORE INSERT/);

assert.match(insertSql, /BEFORE INSERT ON auth\.users/);
assert.doesNotMatch(insertSql, /BEFORE UPDATE/);
assert.doesNotMatch(insertSql, /strip_account_age_from_auth_metadata/);

console.log("  ✓ account age metadata strip SQL contract");
