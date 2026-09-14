/**
 * Local LeoPips ledger arithmetic contracts.
 * Timeout penalties may go negative. Stake debit never may.
 */

import { isAllowedLeoPipsStake, LEOPIPS_TIMEOUT_PENALTY } from "./leopipsEconomy.js";

export function signedLeoPipsBalance(availableBalance) {
  const balance = Number(availableBalance);
  if (!Number.isFinite(balance)) return 0;
  return balance;
}

export function applyLeoPipsTimeoutPenalty(availableBalance) {
  return signedLeoPipsBalance(availableBalance) - LEOPIPS_TIMEOUT_PENALTY;
}

export function applyLeoPipsStakeDebit(availableBalance, stake) {
  const s = Number(stake);
  if (!isAllowedLeoPipsStake(s)) {
    throw new Error("INVALID_LEOPIPS_STAKE");
  }
  const balance = signedLeoPipsBalance(availableBalance);
  if (balance < s) {
    const err = new Error("INSUFFICIENT_LEOPIPS");
    err.code = "INSUFFICIENT_LEOPIPS";
    throw err;
  }
  return balance - s;
}

export function applyLeoPipsIdempotent(store, key, apply) {
  if (store.has(key)) {
    return { applied: false, duplicate: true, nextBalance: store.get(key) };
  }
  const nextBalance = apply();
  store.set(key, nextBalance);
  return { applied: true, duplicate: false, nextBalance };
}
