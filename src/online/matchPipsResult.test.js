/**
 * Authoritative LeoPips match-result numbers for the winner overlay.
 * Run: node src/online/matchPipsResult.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayLeoPipsBalance,
  formatLeoPipsPayout,
  formatSignedLeoPips,
  leoPipsForfeitRetainedFromStake,
  leoPipsForfeitWinnerCreditFromStake,
  leoPipsGrossPotFromStake,
  loadLeoPipsMatchResult,
  resolveLeoPipsWinnerPayout,
  toStoredLeoPipsStake,
} from "./matchPipsResult.js";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "matchPipsResult.js"), "utf8");

assert.deepEqual(
  [20, 50, 100, 150].map((stake) => [stake, leoPipsGrossPotFromStake(stake)]),
  [
    [20, 40],
    [50, 100],
    [100, 200],
    [150, 300],
  ],
);
assert.deepEqual(
  [20, 50, 100, 150].map((stake) => [
    stake,
    leoPipsForfeitWinnerCreditFromStake(stake),
    leoPipsForfeitRetainedFromStake(stake),
  ]),
  [
    [20, 30, 10],
    [50, 75, 25],
    [100, 150, 50],
    [150, 225, 75],
  ],
);
assert.equal(toStoredLeoPipsStake(25), null);
assert.equal(leoPipsGrossPotFromStake(25), null);
assert.equal(leoPipsGrossPotFromStake(null), null);

assert.equal(resolveLeoPipsWinnerPayout({ storedStake: 20 }), 40);
assert.equal(resolveLeoPipsWinnerPayout({ storedStake: 50 }), 100);
assert.equal(resolveLeoPipsWinnerPayout({ storedStake: 100 }), 200);
assert.equal(resolveLeoPipsWinnerPayout({ storedStake: 150 }), 300);
assert.equal(resolveLeoPipsWinnerPayout({ ledgerPayout: 40, storedStake: 20 }), 40);
assert.equal(resolveLeoPipsWinnerPayout({ ledgerPayout: 0, storedStake: 20 }), 40);
assert.equal(resolveLeoPipsWinnerPayout({ ledgerPayout: -5, storedStake: 20 }), 40);
assert.equal(
  resolveLeoPipsWinnerPayout({ storedStake: 150, finishReason: "forfeit" }),
  225
);
assert.equal(
  resolveLeoPipsWinnerPayout({ storedStake: 150, finishReason: "abandoned" }),
  225
);
assert.equal(
  resolveLeoPipsWinnerPayout({ ledgerPayout: 225, storedStake: 150, finishReason: "forfeit" }),
  225
);
assert.equal(
  resolveLeoPipsWinnerPayout({ storedStake: 150, finishReason: "timeout" }),
  225
);
assert.equal(formatLeoPipsPayout(40), "+40");
assert.equal(formatLeoPipsPayout(225), "+225");
assert.equal(formatLeoPipsPayout(100), "+100");
assert.equal(formatLeoPipsPayout(200), "+200");
assert.equal(formatLeoPipsPayout(300), "+300");
assert.equal(formatSignedLeoPips(1020), "1,020");
assert.equal(formatSignedLeoPips(-5), "-5");
assert.equal(displayLeoPipsBalance("1020"), 1020);
assert.equal(displayLeoPipsBalance(undefined), null);
assert.equal(displayLeoPipsBalance("nope"), null);

assert.doesNotMatch(src, /1040|1,040|1250|1,250|5240|5,240/);
assert.doesNotMatch(src, /clampLeoPipsBalance|formatLeoPipsAmount/);
assert.doesNotMatch(src, /insert\(|update\(|upsert\(|\.rpc\(/);
assert.match(src, /player_leopips_wallets/);
assert.match(src, /match_payout/);
assert.match(src, /leoPipsForfeitWinnerCreditFromStake/);

function makeClient({
  userId = "winner-1",
  match = {
    id: "match-20",
    stake_pips: 20,
    created_at: "2026-09-03T16:00:00.000Z",
    finished_at: "2026-09-03T16:08:00.000Z",
    finish_reason: "completed",
    match_kind: "public",
  },
  balance = 1020,
  ledgerPayout = 40,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from(table) {
      if (table === "matches") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: match, error: null }),
            }),
          }),
        };
      }
      if (table === "player_leopips_wallets") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: balance == null ? null : { balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "leopips_ledger") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: ledgerPayout == null ? null : { amount: ledgerPayout, reason: "match_payout" },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

{
  const result = await loadLeoPipsMatchResult("match-20", {
    client: makeClient(),
  });
  assert.equal(result.kind, "staked");
  assert.equal(result.stake, 20);
  assert.equal(result.payout, 40);
  assert.equal(result.payoutSource, "ledger");
  assert.equal(result.balance, 1020);
  assert.equal(result.durationSeconds, 480);
  assert.notEqual(result.balance, 1040);
}

{
  const cases = [
    { stake: 20, ledger: 40, balance: 1020 },
    { stake: 50, ledger: 100, balance: 1050 },
    { stake: 100, ledger: 200, balance: 1100 },
    { stake: 150, ledger: 300, balance: 1150 },
  ];
  for (const row of cases) {
    const result = await loadLeoPipsMatchResult(`match-${row.stake}`, {
      client: makeClient({
        match: {
          id: `match-${row.stake}`,
          stake_pips: row.stake,
          created_at: "2026-09-03T16:00:00.000Z",
          finished_at: "2026-09-03T16:01:00.000Z",
          finish_reason: "completed",
          match_kind: "public",
        },
        balance: row.balance,
        ledgerPayout: row.ledger,
      }),
    });
    assert.equal(result.payout, row.ledger);
    assert.equal(result.balance, row.balance);
    assert.equal(formatLeoPipsPayout(result.payout), `+${row.ledger}`);
  }
}

{
  const result = await loadLeoPipsMatchResult("match-20", {
    client: makeClient({ ledgerPayout: null, balance: 980 }),
  });
  assert.equal(result.payout, 40);
  assert.equal(result.payoutSource, "stored-stake");
  assert.equal(result.balance, 980);
  assert.notEqual(result.payoutSource, "ledger");
}

{
  const result = await loadLeoPipsMatchResult("match-20", {
    client: makeClient({ balance: null, ledgerPayout: 40 }),
  });
  assert.equal(result.payout, 40);
  assert.equal(result.balance, null);
}

{
  const result = await loadLeoPipsMatchResult("friend-1", {
    client: makeClient({
      match: {
        id: "friend-1",
        stake_pips: null,
        created_at: "2026-09-03T16:00:00.000Z",
        finished_at: "2026-09-03T16:05:00.000Z",
        finish_reason: "completed",
        match_kind: "friend",
      },
    }),
  });
  assert.equal(result.kind, "unstaked");
  assert.equal(result.payout, undefined);
  assert.equal(result.balance, undefined);
}

{
  const result = await loadLeoPipsMatchResult("timeout-win", {
    client: makeClient({
      match: {
        id: "timeout-win",
        stake_pips: 20,
        created_at: "2026-09-03T16:00:00.000Z",
        finished_at: "2026-09-03T16:03:00.000Z",
        finish_reason: "timeout",
        match_kind: "public",
      },
      balance: 1020,
      ledgerPayout: 40,
    }),
  });
  assert.equal(result.kind, "staked");
  assert.equal(result.payout, 40);
  assert.equal(result.finishReason, "timeout");
  assert.equal("xp" in result, false);
  assert.equal("level" in result, false);
}

{
  const result = await loadLeoPipsMatchResult("", { client: makeClient() });
  assert.equal(result.kind, "none");
}

console.log("  ✓ LeoPips match-result payout and wallet read");
