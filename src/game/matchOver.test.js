/**
 * Match-over helpers.
 */
import assert from "node:assert/strict";
import { formatMatchDuration } from "../utils/formatMatchDuration.js";

assert.equal(formatMatchDuration(0), "00:00");
assert.equal(formatMatchDuration(65), "01:05");
assert.equal(formatMatchDuration(600), "10:00");
assert.equal(formatMatchDuration(-3), "00:00");

console.log("Match-over helper tests passed.");
