/**
 * Cross-screen LeoPips wallet refresh signal (DB remains authoritative).
 * Online table notifies; Home / stake screens refetch or apply Realtime.
 */

export const LEOPIPS_WALLET_CHANGED_EVENT = "leodomino:leopips-wallet-changed";

export function notifyLeoPipsWalletChanged(detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(LEOPIPS_WALLET_CHANGED_EVENT, { detail }));
  } catch {
    /* non-DOM test environments */
  }
}
