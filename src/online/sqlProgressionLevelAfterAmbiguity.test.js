/**
 * Progression award SQL must not use ambiguous level_after assignments.
 * Run: node src/online/sqlProgressionLevelAfterAmbiguity.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fix = readFileSync(
  join(root, "supabase/migrations/20260906030000_fix_progression_level_after_ambiguity.sql"),
  "utf8"
);

assert.match(fix, /CREATE OR REPLACE FUNCTION public\._progression_award_player_for_match/);
assert.match(fix, /v_level_after/);
assert.match(fix, /level_after = v_level_after/);
assert.match(fix, /lifetime_xp_after = v_xp_after/);
assert.doesNotMatch(fix, /^\s*level_after = level_after\s*,?\s*$/m);
assert.doesNotMatch(fix, /eyJ|sb_secret/);

console.log("  ✓ progression level_after ambiguity fix SQL contract");
