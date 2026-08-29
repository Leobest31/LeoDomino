/**
 * Single signed-in presence heartbeat for the authenticated app shell.
 * Visible-only. One timer. Missing RPC is a no-op.
 */
import { useEffect, useRef } from "react";
import { isCloudAuth, useAuth } from "../auth";
import { PLAYER_PRESENCE_HEARTBEAT_MS, touchMyPresence } from "../online/playerPresence.js";

export { PLAYER_PRESENCE_HEARTBEAT_MS };

export function usePlayerPresence() {
  const { signedIn, authReady, session } = useAuth();
  const ready = Boolean(
    isCloudAuth() && authReady && signedIn && session?.playerId && !session?.deletionPending
  );
  const inFlightRef = useRef(null);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;

    const beat = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (inFlightRef.current) return;
      const run = touchMyPresence()
        .catch(() => {
          /* heartbeat is best-effort until the presence RPC exists */
        })
        .finally(() => {
          if (inFlightRef.current === run) inFlightRef.current = null;
        });
      inFlightRef.current = run;
    };

    beat();
    const timer = window.setInterval(beat, PLAYER_PRESENCE_HEARTBEAT_MS);
    const onShow = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      beat();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    document.addEventListener("resume", onShow);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("resume", onShow);
    };
  }, [ready]);
}
