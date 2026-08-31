/**
 * Authoritative reserved/active online match for the signed-in player.
 * Recovers from matches RLS / get_my_active_match — not from a Realtime edge.
 * Informational: does not accept requests or enter the table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import { createGuardedRefresh } from "../online/guardedRefresh.js";
import { getMyActiveMatch, subscribeMatchRequests } from "../online/matchmaking.js";
import {
  canRecoverMatch,
  shouldDropLastKnownOnOccupancyFailure,
} from "../online/matchRecovery.js";
import { clearOnlineSession } from "../online/onlineTable.js";

export function useActiveOnlineMatch({ enabled = true } = {}) {
  const { session } = useAuth();
  const onlineReady = Boolean(enabled && isCloudAuth() && session?.playerId && !session?.deletionPending);
  const [match, setMatch] = useState(null);
  const matchRef = useRef(null);
  matchRef.current = match;

  const optionsRef = useRef({});
  optionsRef.current = {
    onlineReady,
    load: () =>
      getMyActiveMatch().then((next) => {
        const live = canRecoverMatch(next) ? next : null;
        return live;
      }),
  };

  const guard = useMemo(
    () =>
      createGuardedRefresh({
        load: () => optionsRef.current.load(),
        isReady: () => Boolean(optionsRef.current.onlineReady),
        onSuccess: (live) => {
          setMatch(live);
          matchRef.current = live;
        },
        onFailure: () => {
          // Outage: keep last known occupancy unless it is already terminal.
          // Do not invent a cancellation of a live match.
          const last = matchRef.current;
          if (shouldDropLastKnownOnOccupancyFailure(last)) {
            if (last?.id) clearOnlineSession();
            setMatch(null);
            matchRef.current = null;
          }
        },
      }),
    []
  );

  const refresh = useCallback(() => {
    if (!onlineReady) {
      setMatch(null);
      matchRef.current = null;
      return Promise.resolve(null);
    }
    return guard.run().then(() => matchRef.current);
  }, [guard, onlineReady]);

  useEffect(() => {
    if (!onlineReady) {
      setMatch(null);
      matchRef.current = null;
      return undefined;
    }
    void refresh();
    let stop = () => {};
    try {
      stop = subscribeMatchRequests(() => {
        guard.schedule();
      });
    } catch {
      // Recovery still works by querying matches on lifecycle events.
    }
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [guard, onlineReady, refresh]);

  useEffect(() => () => guard.dispose(), [guard]);

  return { match, refresh };
}
