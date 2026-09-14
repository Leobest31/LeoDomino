/**
 * Live per-stake joinable counts for the authenticated LeoPips Choose Stake
 * screen. Reuses list_joinable_open_match_requests + match_requests Realtime,
 * with a lightweight visible-only poll fallback so counts do not stick at 0
 * when Realtime lags. Informational only — does not create or accept requests.
 */
import { useEffect, useRef, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import {
  emptyLeoPipsStakeCounts,
  loadLeoPipsStakeRequestCounts,
} from "../leopips/leopipsStakeRequestCounts.js";
import { reportError } from "../monitoring";
import { subscribeMatchRequests } from "../online/matchmaking.js";

/** Visible-only Choose Stake count refresh. Keep Realtime; do not poll while hidden. */
export const LEOPIPS_STAKE_COUNT_POLL_MS = 5_000;

function stakeCountsDocumentIsHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * @param {string} styleId
 * @param {{ enabled?: boolean }} [options]
 */
export function useLeoPipsStakeRequestCounts(styleId, { enabled = true } = {}) {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const onlineReady = enabled && isCloudAuth() && !session?.deletionPending;
  const [counts, setCounts] = useState(emptyLeoPipsStakeCounts);
  const [status, setStatus] = useState("idle");
  const confirmedByStyleRef = useRef(Object.create(null));
  const refreshInFlightRef = useRef(null);

  useEffect(() => {
    if (!onlineReady || !playerId) {
      setCounts(emptyLeoPipsStakeCounts());
      setStatus("idle");
      return undefined;
    }

    const cached = confirmedByStyleRef.current[styleId];
    if (cached) {
      setCounts(cached);
      setStatus("ready");
    } else {
      setCounts(emptyLeoPipsStakeCounts());
      setStatus("loading");
    }

    let cancelled = false;
    const refresh = () => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      const pending = loadLeoPipsStakeRequestCounts(styleId)
        .then((next) => {
          if (cancelled) return;
          confirmedByStyleRef.current[styleId] = next;
          setCounts(next);
          setStatus("ready");
        })
        .catch((error) => {
          if (cancelled) return;
          reportError(error, {
            screen: "leopipsStake",
            ruleset: String(styleId || ""),
          });
          const last = confirmedByStyleRef.current[styleId];
          if (last) {
            setCounts(last);
            setStatus("ready");
            return;
          }
          setStatus("error");
        })
        .finally(() => {
          if (refreshInFlightRef.current === pending) {
            refreshInFlightRef.current = null;
          }
        });
      refreshInFlightRef.current = pending;
      return pending;
    };

    refresh();

    let stopRealtime = () => {};
    try {
      stopRealtime = subscribeMatchRequests(() => {
        refresh();
      });
    } catch {
      // Listing still works without Realtime.
    }

    const poll = window.setInterval(() => {
      if (stakeCountsDocumentIsHidden()) return;
      refresh();
    }, LEOPIPS_STAKE_COUNT_POLL_MS);

    const onForeground = () => {
      if (stakeCountsDocumentIsHidden()) return;
      refresh();
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        onForeground();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onForeground);

    return () => {
      cancelled = true;
      stopRealtime();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onForeground);
    };
  }, [onlineReady, playerId, styleId]);

  return { counts, status };
}
