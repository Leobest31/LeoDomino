/**
 * Admin "Send LeoPips Gift" — client wrapper only. Never uses a service-role
 * key. The RPC (admin_gift_leopips) is the sole source of truth: it re-checks
 * staff role, amount, player existence, and applies the credit atomically via
 * the existing public._leopips_apply writer. This module never computes or
 * sends a balance to the server — only playerId/amount/reason/idempotencyKey.
 */
import { getSupabaseClient } from "./supabaseClient.js";
import { isInfrastructureOutageError } from "./serviceHealth.js";
import { ADMIN_ERROR, AdminError } from "./adminDashboard.js";

export const ADMIN_LEOPIPS_GIFT_REASON = "admin_gift";

/** Sane UI ceiling only — the server does not enforce a maximum. */
export const ADMIN_LEOPIPS_GIFT_MAX_AMOUNT = 1_000_000;

/** Quick-pick chips for "choose or type a reason". Free text is also accepted. */
export const ADMIN_LEOPIPS_GIFT_REASON_PRESETS = Object.freeze([
  "Goodwill credit",
  "Bug compensation",
  "Promotion",
  "Support resolution",
]);

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function throwFromError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  const code = String(error?.code || "");
  if (/authentication required/i.test(msg) || code === "28000") {
    throw new AdminError(ADMIN_ERROR.AUTH, msg, error);
  }
  if (/staff required/i.test(msg) || code === "42501") {
    throw new AdminError(ADMIN_ERROR.FORBIDDEN, msg, error);
  }
  if (/player not found/i.test(msg) || code === "P0002") {
    throw new AdminError(ADMIN_ERROR.GENERIC, "PLAYER_NOT_FOUND", error);
  }
  if (/does not exist|42883|PGRST202/i.test(`${msg} ${code}`)) {
    throw new AdminError(ADMIN_ERROR.UNAVAILABLE, msg, error);
  }
  if (isInfrastructureOutageError(error) || code === "PGRST003") {
    throw new AdminError(ADMIN_ERROR.BACKEND, msg, error);
  }
  throw new AdminError(ADMIN_ERROR.GENERIC, msg, error);
}

async function rpc(name, payload, client) {
  const db = clientOf(client);
  const { data, error } = await db.rpc(name, payload);
  if (error) throwFromError(error);
  return data;
}

function asText(value) {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function asInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * @param {unknown} value
 * @returns {"" | "EMPTY" | "NOT_A_NUMBER" | "NOT_INTEGER" | "ZERO_OR_NEGATIVE" | "TOO_LARGE"}
 */
export function validateLeopipsGiftAmount(value) {
  if (value === "" || value == null) return "EMPTY";
  const n = Number(value);
  if (!Number.isFinite(n)) return "NOT_A_NUMBER";
  if (!Number.isInteger(n)) return "NOT_INTEGER";
  if (n <= 0) return "ZERO_OR_NEGATIVE";
  if (n > ADMIN_LEOPIPS_GIFT_MAX_AMOUNT) return "TOO_LARGE";
  return "";
}

export function isValidLeopipsGiftAmount(value) {
  return validateLeopipsGiftAmount(value) === "";
}

/**
 * Pure, unclamped integer addition for the review preview. Never floors at
 * zero — a starting balance below zero (however it arose) plus a gift still
 * adds normally, e.g. -5 + 100 = 95. The server (_leopips_apply) performs
 * the authoritative version of this same plain addition.
 */
export function computeLeopipsBalanceAfter(currentBalance, amount) {
  const current = Number(currentBalance);
  const delta = Number(amount);
  if (!Number.isFinite(current) || !Number.isFinite(delta)) return null;
  return current + delta;
}

/** One id per gift attempt; reused across retries so a resend cannot double-credit. */
export function createAdminLeopipsGiftIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeAdminLeopipsGiftResult(row) {
  const data = row && typeof row === "object" ? row : {};
  return {
    ok: data.ok === true,
    applied: data.applied === true,
    duplicate: data.duplicate === true,
    playerId: asText(data.player_id ?? data.playerId) || "",
    amount: asInt(data.amount),
    reason: asText(data.reason) || ADMIN_LEOPIPS_GIFT_REASON,
    note: asText(data.note),
    balanceBefore: asInt(data.balance_before ?? data.balanceBefore),
    balanceAfter: asInt(data.balance_after ?? data.balanceAfter),
    idempotencyKey: asText(data.idempotency_key ?? data.idempotencyKey) || "",
    auditId: asText(data.audit_id ?? data.auditId),
  };
}

/**
 * @param {{ playerId: string, amount: number, reason?: string, idempotencyKey: string }} input
 */
export async function sendAdminLeopipsGift(input, client) {
  const playerId = asText(input?.playerId);
  if (!playerId) throw new AdminError(ADMIN_ERROR.GENERIC, "player required");
  const amountCheck = validateLeopipsGiftAmount(input?.amount);
  if (amountCheck) throw new AdminError(ADMIN_ERROR.GENERIC, `INVALID_AMOUNT:${amountCheck}`);
  const idempotencyKey = asText(input?.idempotencyKey);
  if (!idempotencyKey) throw new AdminError(ADMIN_ERROR.GENERIC, "idempotency key required");
  const reason = asText(input?.reason);

  const data = await rpc(
    "admin_gift_leopips",
    {
      p_player_id: playerId,
      p_amount: Math.trunc(Number(input.amount)),
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    },
    client
  );
  return normalizeAdminLeopipsGiftResult(data);
}
