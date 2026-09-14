/**
 * Durable unread Admin DMs + Realtime. Presentation-only; never touches gameplay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import {
  isLeoPipsVictoryOverlayOpen,
  listMyUnreadAdminMessages,
  markMyAdminMessageRead,
  mergeAdminMessageQueue,
  subscribeMyAdminPlayerMessages,
} from "../online/adminPlayerMessages.js";

export function useAdminPlayerMessages() {
  const { signedIn, authReady, session } = useAuth();
  const playerId = session?.playerId || "";
  const enabled = Boolean(
    isCloudAuth() && authReady && signedIn && playerId && !session?.deletionPending
  );

  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState(null);
  const [victoryBlocking, setVictoryBlocking] = useState(false);
  const acknowledgedRef = useRef(new Set());
  const busyRef = useRef(false);

  const enqueue = useCallback((rows) => {
    setQueue((prev) => {
      const filtered = (Array.isArray(rows) ? rows : [rows]).filter(
        (row) => row?.id && !acknowledgedRef.current.has(row.id)
      );
      if (!filtered.length) return prev;
      return mergeAdminMessageQueue(prev, filtered);
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setQueue([]);
      setActive(null);
      return undefined;
    }
    let cancelled = false;
    void listMyUnreadAdminMessages()
      .then((rows) => {
        if (!cancelled) enqueue(rows);
      })
      .catch(() => {
        /* missing RPC / offline: no-op until Realtime or retry */
      });
    const unsubscribe = subscribeMyAdminPlayerMessages(playerId, (row) => {
      if (!cancelled) enqueue(row);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, playerId, enqueue]);

  useEffect(() => {
    if (!enabled || (!active && !queue.length)) {
      setVictoryBlocking(false);
      return undefined;
    }
    const tick = () => setVictoryBlocking(isLeoPipsVictoryOverlayOpen());
    tick();
    const timer = window.setInterval(tick, 400);
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(tick)
        : null;
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [enabled, active, queue.length]);

  useEffect(() => {
    if (!enabled || active || victoryBlocking) return;
    const next = queue[0];
    if (!next?.id || acknowledgedRef.current.has(next.id)) return;
    setActive(next);
    setQueue((prev) => prev.filter((row) => row.id !== next.id));
  }, [enabled, active, queue, victoryBlocking]);

  const acknowledge = useCallback(async () => {
    const current = active;
    if (!current?.id || busyRef.current) return;
    busyRef.current = true;
    acknowledgedRef.current.add(current.id);
    try {
      await markMyAdminMessageRead(current.id);
    } catch {
      /* keep local ack so refresh path still requires server unread; retry load later */
    } finally {
      busyRef.current = false;
      setActive(null);
    }
  }, [active]);

  const visible = enabled && active && !victoryBlocking ? active : null;

  return {
    message: visible,
    acknowledge,
  };
}
