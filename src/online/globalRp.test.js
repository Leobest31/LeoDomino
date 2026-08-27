/**
 * Global RP client contract. Run: node src/online/globalRp.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GlobalRpError,
  fetchSettledMatchRpResult,
  getMatchRpResult,
  getMyGlobalRating,
  isOnlineMatchAborted,
  matchRpDisplayFromResult,
  normalizeGlobalRating,
  normalizeMatchRpResult,
  notifyGlobalRatingRefresh,
  signedDeltaLabel,
  subscribeGlobalRatingRefresh,
} from "./globalRp.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/globalRp.js"), "utf8");

assert.match(source, /rpc\("get_my_global_rating"\)/);
assert.match(source, /rpc\("get_match_rp_result"/);
assert.match(source, /p_match_id: matchId/);
assert.doesNotMatch(source, /POWER\(|10\^\(|K\s*=\s*32|expectedScore/);
assert.doesNotMatch(source, /\.from\("player_global_ratings"\)|\.from\("match_rp_results"\)/);
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(/);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role/);

{
  const rating = normalizeGlobalRating({
    rp: 1000,
    matches_played: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    global_rank: 7,
  });
  assert.deepEqual(rating, {
    rp: 1000,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    globalRank: 7,
  });
}

{
  const rating = normalizeGlobalRating({
    rp: 1184,
    matchesPlayed: 10,
    wins: 6,
    losses: 4,
    winRate: 0.6,
    globalRank: 123,
  });
  assert.equal(rating.rp, 1184);
  assert.equal(rating.globalRank, 123);
  assert.equal(rating.winRate, 0.6);
}

assert.equal(normalizeGlobalRating(null), null);
assert.equal(normalizeGlobalRating({ rp: "nope" }), null);

{
  const settled = normalizeMatchRpResult({
    settled: true,
    rated: true,
    old_rp: 1000,
    new_rp: 1016,
    delta: 16,
    finish_reason: "completed",
  });
  assert.deepEqual(settled, {
    settled: true,
    rated: true,
    oldRp: 1000,
    newRp: 1016,
    delta: 16,
    finishReason: "completed",
  });
}

{
  const pending = normalizeMatchRpResult({ settled: false, rated: true, match_id: "m1" });
  assert.deepEqual(pending, { settled: false, rated: true });
}

assert.equal(signedDeltaLabel(16), "+16");
assert.equal(signedDeltaLabel(-16), "-16");
assert.equal(signedDeltaLabel(0), "0");

assert.deepEqual(matchRpDisplayFromResult(null), { kind: "none" });
assert.deepEqual(matchRpDisplayFromResult({ settled: false }), { kind: "none" });
assert.equal(
  matchRpDisplayFromResult({
    settled: true,
    rated: true,
    oldRp: 1000,
    newRp: 1016,
    delta: 16,
    finishReason: "completed",
  }).kind,
  "rated"
);
assert.equal(
  matchRpDisplayFromResult({
    settled: true,
    rated: false,
    oldRp: 1000,
    newRp: 1000,
    delta: 0,
    finishReason: "completed",
  }).kind,
  "unrated"
);

assert.equal(isOnlineMatchAborted({ roundResult: { reason: "abandoned" } }), true);
assert.equal(isOnlineMatchAborted({ roundResult: { reason: "forfeit" } }), false);

{
  const seen = [];
  const off = subscribeGlobalRatingRefresh(() => seen.push(1));
  notifyGlobalRatingRefresh();
  off();
  notifyGlobalRatingRefresh();
  assert.deepEqual(seen, [1]);
}

{
  const client = {
    rpc: async (name) => {
      assert.equal(name, "get_my_global_rating");
      return {
        data: {
          rp: 1000,
          matches_played: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
          global_rank: 1,
        },
        error: null,
      };
    },
  };
  const rating = await getMyGlobalRating(client);
  assert.equal(rating.rp, 1000);
  assert.equal(rating.globalRank, 1);
}

{
  const client = {
    rpc: async () => ({ data: null, error: { message: "authentication required", code: "28000" } }),
  };
  await assert.rejects(() => getMyGlobalRating(client), (err) => {
    assert.equal(err instanceof GlobalRpError, true);
    assert.equal(err.code, "AUTH");
    return true;
  });
}

{
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          settled: true,
          rated: true,
          old_rp: 1000,
          new_rp: 984,
          delta: -16,
          finish_reason: "forfeit",
        },
        error: null,
      };
    },
  };
  const result = await getMatchRpResult("match-1", client);
  assert.deepEqual(calls[0], { name: "get_match_rp_result", args: { p_match_id: "match-1" } });
  assert.equal(result.delta, -16);
  assert.equal(result.finishReason, "forfeit");
}

{
  let n = 0;
  const client = {
    rpc: async () => {
      n += 1;
      if (n < 3) return { data: { settled: false, rated: true }, error: null };
      return {
        data: {
          settled: true,
          rated: true,
          old_rp: 1000,
          new_rp: 1016,
          delta: 16,
          finish_reason: "completed",
        },
        error: null,
      };
    },
  };
  const waits = [];
  const result = await fetchSettledMatchRpResult("m", {
    client,
    delays: [0, 1, 1, 1],
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(n, 3);
  assert.equal(result.settled, true);
  assert.equal(result.delta, 16);
  assert.deepEqual(waits, [1, 1]);
}

console.log("  ✓ Global RP client contract");
