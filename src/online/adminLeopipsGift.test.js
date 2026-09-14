/**
 * Admin "Send LeoPips Gift" client contract. No network.
 * Run: node src/online/adminLeopipsGift.test.js
 */
import assert from "node:assert/strict";
import { ADMIN_ERROR } from "./adminDashboard.js";
import {
  ADMIN_LEOPIPS_GIFT_MAX_AMOUNT,
  ADMIN_LEOPIPS_GIFT_REASON,
  ADMIN_LEOPIPS_GIFT_REASON_PRESETS,
  computeLeopipsBalanceAfter,
  createAdminLeopipsGiftIdempotencyKey,
  isValidLeopipsGiftAmount,
  normalizeAdminLeopipsGiftResult,
  sendAdminLeopipsGift,
  validateLeopipsGiftAmount,
} from "./adminLeopipsGift.js";

// --- balance-after arithmetic: plain, unclamped addition ---
assert.equal(computeLeopipsBalanceAfter(1000, 500), 1500);
assert.equal(computeLeopipsBalanceAfter(-5, 100), 95);
assert.equal(computeLeopipsBalanceAfter(0, 1), 1);
console.log("  ✓ balance-after preview is plain unclamped addition (1000+500=1500, -5+100=95)");

// --- amount validation ---
assert.equal(validateLeopipsGiftAmount(""), "EMPTY");
assert.equal(validateLeopipsGiftAmount(null), "EMPTY");
assert.equal(validateLeopipsGiftAmount(0), "ZERO_OR_NEGATIVE");
assert.equal(validateLeopipsGiftAmount(-1), "ZERO_OR_NEGATIVE");
assert.equal(validateLeopipsGiftAmount(-500), "ZERO_OR_NEGATIVE");
assert.equal(validateLeopipsGiftAmount(1.5), "NOT_INTEGER");
assert.equal(validateLeopipsGiftAmount("abc"), "NOT_A_NUMBER");
assert.equal(validateLeopipsGiftAmount(ADMIN_LEOPIPS_GIFT_MAX_AMOUNT + 1), "TOO_LARGE");
assert.equal(validateLeopipsGiftAmount(500), "");
assert.equal(validateLeopipsGiftAmount(1), "");
assert.equal(isValidLeopipsGiftAmount(500), true);
assert.equal(isValidLeopipsGiftAmount(0), false);
assert.equal(isValidLeopipsGiftAmount(-1), false);
console.log("  ✓ zero and negative amounts are rejected client-side before any request");

// --- reason presets exist for "choose or type" ---
assert.ok(ADMIN_LEOPIPS_GIFT_REASON_PRESETS.length >= 3);
assert.equal(ADMIN_LEOPIPS_GIFT_REASON, "admin_gift");

// --- idempotency key: stable shape, unique per call ---
const keyA = createAdminLeopipsGiftIdempotencyKey();
const keyB = createAdminLeopipsGiftIdempotencyKey();
assert.ok(keyA && keyB && keyA !== keyB);
console.log("  ✓ idempotency key generator produces distinct keys per attempt");

// --- normalize response shape ---
const normalized = normalizeAdminLeopipsGiftResult({
  ok: true,
  applied: true,
  duplicate: false,
  player_id: "p1",
  amount: 500,
  reason: "admin_gift",
  note: "Goodwill credit",
  balance_before: 1000,
  balance_after: 1500,
  idempotency_key: "abc",
  audit_id: "aud-1",
});
assert.deepEqual(normalized, {
  ok: true,
  applied: true,
  duplicate: false,
  playerId: "p1",
  amount: 500,
  reason: "admin_gift",
  note: "Goodwill credit",
  balanceBefore: 1000,
  balanceAfter: 1500,
  idempotencyKey: "abc",
  auditId: "aud-1",
});
console.log("  ✓ RPC response normalizes to a stable ledger-review shape");

// --- sendAdminLeopipsGift: request shape and client-side gating ---
{
  const calls = [];
  const fakeClient = {
    rpc: (name, payload) => {
      calls.push({ name, payload });
      return Promise.resolve({
        data: {
          ok: true,
          applied: true,
          duplicate: false,
          player_id: payload.p_player_id,
          amount: payload.p_amount,
          reason: "admin_gift",
          note: payload.p_reason,
          balance_before: 1000,
          balance_after: 1000 + payload.p_amount,
          idempotency_key: payload.p_idempotency_key,
          audit_id: "aud-2",
        },
        error: null,
      });
    },
  };
  const key = createAdminLeopipsGiftIdempotencyKey();
  const result = await sendAdminLeopipsGift(
    { playerId: "player-1", amount: 500, reason: "Goodwill credit", idempotencyKey: key },
    fakeClient
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "admin_gift_leopips");
  assert.deepEqual(calls[0].payload, {
    p_player_id: "player-1",
    p_amount: 500,
    p_reason: "Goodwill credit",
    p_idempotency_key: key,
  });
  assert.equal(result.balanceAfter, 1500);
  console.log("  ✓ sendAdminLeopipsGift calls admin_gift_leopips with the exact expected payload");

  // Never sends a client-computed balance to the server.
  assert.ok(!("balance" in calls[0].payload));
  assert.ok(!("p_balance" in calls[0].payload));
  console.log("  ✓ client never sends a balance value — server is the sole source of truth");
}

// --- duplicate/retried submission must not double-credit ---
// Fake server mirrors _leopips_apply's real contract: same (player,
// idempotency_key) is applied at most once; a retry returns the same
// balance_after without crediting again.
{
  const ledger = new Map(); // idempotencyKey -> { amount, balanceAfter }
  let balance = 1000;
  const fakeClient = {
    rpc: (name, payload) => {
      assert.equal(name, "admin_gift_leopips");
      const existing = ledger.get(payload.p_idempotency_key);
      if (existing) {
        return Promise.resolve({
          data: {
            ok: true,
            applied: false,
            duplicate: true,
            player_id: payload.p_player_id,
            amount: payload.p_amount,
            balance_before: existing.balanceAfter - existing.amount,
            balance_after: existing.balanceAfter,
            idempotency_key: payload.p_idempotency_key,
          },
          error: null,
        });
      }
      const balanceBefore = balance;
      balance += payload.p_amount;
      ledger.set(payload.p_idempotency_key, { amount: payload.p_amount, balanceAfter: balance });
      return Promise.resolve({
        data: {
          ok: true,
          applied: true,
          duplicate: false,
          player_id: payload.p_player_id,
          amount: payload.p_amount,
          balance_before: balanceBefore,
          balance_after: balance,
          idempotency_key: payload.p_idempotency_key,
        },
        error: null,
      });
    },
  };
  const key = createAdminLeopipsGiftIdempotencyKey();
  const gift = { playerId: "player-1", amount: 500, reason: "Goodwill credit", idempotencyKey: key };
  const first = await sendAdminLeopipsGift(gift, fakeClient);
  const retry1 = await sendAdminLeopipsGift(gift, fakeClient);
  const retry2 = await sendAdminLeopipsGift(gift, fakeClient);
  assert.equal(first.applied, true);
  assert.equal(first.balanceAfter, 1500);
  assert.equal(retry1.applied, false);
  assert.equal(retry1.duplicate, true);
  assert.equal(retry1.balanceAfter, 1500);
  assert.equal(retry2.balanceAfter, 1500);
  assert.equal(balance, 1500, "three submissions with the same key credit exactly once");
  console.log("  ✓ duplicate/retried submission (same idempotency key) does not double-credit");
}

// --- zero/negative amounts never reach the network ---
{
  let called = false;
  const fakeClient = { rpc: () => { called = true; return Promise.resolve({ data: {}, error: null }); } };
  for (const bad of [0, -1, -500]) {
    await assert.rejects(() =>
      sendAdminLeopipsGift({ playerId: "p1", amount: bad, idempotencyKey: "k" }, fakeClient)
    );
  }
  assert.equal(called, false, "invalid amounts must be rejected before any RPC call");
  console.log("  ✓ zero/negative amounts never reach the network");
}

// --- server-side rejection surfaces map to admin error codes ---
{
  const fakeClient = {
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "staff required", code: "42501" } }),
  };
  await assert.rejects(
    () =>
      sendAdminLeopipsGift(
        { playerId: "p1", amount: 100, idempotencyKey: "k" },
        fakeClient
      ),
    (err) => err.code === ADMIN_ERROR.FORBIDDEN
  );
  console.log("  ✓ non-admin caller rejection (42501 staff required) maps to FORBIDDEN");
}
{
  const fakeClient = {
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "player not found", code: "P0002" } }),
  };
  await assert.rejects(() =>
    sendAdminLeopipsGift({ playerId: "missing", amount: 100, idempotencyKey: "k" }, fakeClient)
  );
  console.log("  ✓ nonexistent player rejection (P0002 player not found) surfaces as an error");
}

console.log("  ✓ adminLeopipsGift");
