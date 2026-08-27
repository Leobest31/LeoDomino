/**
 * Live Find Match availability for the Home Play Online button.
 * Reads the same public OPEN requests as Find Match and refreshes from
 * match_requests Realtime. Informational only — does not accept a request.
 */
import { useCallback, useEffect, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import {
  loadFindMatchAvailability,
  subscribeMatchRequests,
} from "../online/matchmaking.js";

export function useFindMatchAvailability() {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const onlineReady = isCloudAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!onlineReady || !playerId) {
      setCount(0);
      return Promise.resolve();
    }
    return loadFindMatchAvailability(playerId)
      .then((next) => {
        setCount(next.count);
      })
      .catch(() => {
        setCount(0);
      });
  }, [onlineReady, playerId]);

  useEffect(() => {
    if (!onlineReady || !playerId) {
      setCount(0);
      return undefined;
    }
    refresh();
    let stop = () => {};
    try {
      stop = subscribeMatchRequests(() => {
        refresh();
      });
    } catch {
      // Listing still works without Realtime.
    }
    return () => stop();
  }, [onlineReady, playerId, refresh]);

  return { count, available: count > 0 };
}
