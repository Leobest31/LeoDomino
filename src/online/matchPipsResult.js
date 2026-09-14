/**
 * Read-only LeoPips match-result numbers for the live table.
 * SELECT only. Does not debit, credit, or invent a wallet balance.
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient.js";

export const LEOPIPS_RESULT_STAKES = Object.freeze([20, 50, 100, 150]);

const STAKE_SET = new Set(LEOPIPS_RESULT_STAKES);

function clientOf(client) {
  return client ?? getSupabaseClient();
}

export function toStoredLeoPipsStake(value) {
  const n = Number(value);
  return Number.isInteger(n) && STAKE_SET.has(n) ? n : null;
}

export function leoPipsGrossPotFromStake(stake) {
  const stored = toStoredLeoPipsStake(stake);
  return stored == null ? null : stored * 2;
}

/** Forfeit/abandon/timeout-win winner terminal credit = 1.5S (own stake return + half opponent). */
export function leoPipsForfeitWinnerCreditFromStake(stake) {
  const stored = toStoredLeoPipsStake(stake);
  return stored == null ? null : (stored * 3) / 2;
}

/** Game-retained half of loser's stake on non-completed terminals. */
export function leoPipsForfeitRetainedFromStake(stake) {
  const stored = toStoredLeoPipsStake(stake);
  return stored == null ? null : stored / 2;
}

function isPartialPotFinish(finishReason) {
  const reason = String(finishReason || "");
  return (
    reason === "forfeit" ||
    reason === "abandon" ||
    reason === "abandoned" ||
    reason === "timeout"
  );
}

export function displayLeoPipsBalance(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatSignedLeoPips(value) {
  const n = displayLeoPipsBalance(value);
  if (n == null) return null;
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatLeoPipsPayout(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n <= 0) return null;
  return `+${new Intl.NumberFormat("en-US").format(n)}`;
}

/**
 * Winner terminal credit: ledger match_payout first.
 * Fallback by finish reason — completed → 2S; forfeit/abandon/timeout → 1.5S.
 * Never uses a client-typed stake.
 */
export function resolveLeoPipsWinnerPayout({ ledgerPayout, storedStake, finishReason } = {}) {
  const fromLedger = Number(ledgerPayout);
  if (Number.isInteger(fromLedger) && fromLedger > 0) return fromLedger;
  if (isPartialPotFinish(finishReason)) {
    return leoPipsForfeitWinnerCreditFromStake(storedStake);
  }
  return leoPipsGrossPotFromStake(storedStake);
}

export function matchDurationSecondsFromIso(startedAt, endedAt = Date.now()) {
  const start = Date.parse(String(startedAt ?? ""));
  const end = typeof endedAt === "number" ? endedAt : Date.parse(String(endedAt ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 1000);
}

/**
 * @param {string} matchId
 * @param {{ client?: object }} [options]
 */
export async function loadLeoPipsMatchResult(matchId, { client } = {}) {
  if (!matchId) {
    return { kind: "none" };
  }
  if (!isSupabaseConfigured() && !client) {
    return { kind: "unavailable" };
  }

  const db = clientOf(client);
  const { data: authData, error: authError } = await db.auth.getUser();
  const playerId = authData?.user?.id;
  if (authError || !playerId) {
    return { kind: "unavailable" };
  }

  const { data: match, error: matchError } = await db
    .from("matches")
    .select("id, stake_pips, created_at, finished_at, finish_reason, match_kind")
    .eq("id", matchId)
    .maybeSingle();
  if (matchError || !match?.id) {
    return { kind: "unavailable" };
  }

  const stake = toStoredLeoPipsStake(match.stake_pips);
  if (stake == null) {
    return { kind: "unstaked", finishReason: match.finish_reason ?? null, matchKind: match.match_kind ?? null };
  }

  const { data: wallet, error: walletError } = await db
    .from("player_leopips_wallets")
    .select("balance")
    .eq("player_id", playerId)
    .maybeSingle();

  const balance = walletError ? null : displayLeoPipsBalance(wallet?.balance);

  const { data: payoutRow, error: payoutError } = await db
    .from("leopips_ledger")
    .select("amount, reason")
    .eq("player_id", playerId)
    .eq("match_id", matchId)
    .eq("reason", "match_payout")
    .maybeSingle();

  const ledgerPayout = payoutError ? null : payoutRow?.amount;
  const finishReason = match.finish_reason ?? null;
  const payout = resolveLeoPipsWinnerPayout({
    ledgerPayout,
    storedStake: stake,
    finishReason,
  });
  const endedAt = match.finished_at || Date.now();

  return {
    kind: "staked",
    matchId,
    stake,
    payout,
    payoutSource: Number.isInteger(Number(ledgerPayout)) && Number(ledgerPayout) > 0 ? "ledger" : "stored-stake",
    balance,
    finishReason,
    matchKind: match.match_kind ?? "public",
    durationSeconds: matchDurationSecondsFromIso(match.created_at, endedAt),
    forfeitWinnerCredit: isPartialPotFinish(finishReason)
      ? leoPipsForfeitWinnerCreditFromStake(stake)
      : null,
    forfeitRetained: isPartialPotFinish(finishReason)
      ? leoPipsForfeitRetainedFromStake(stake)
      : null,
  };
}
