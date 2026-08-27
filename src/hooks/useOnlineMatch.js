/**
 * Authoritative online 1v1 match controller.
 * Source of truth is enterOnlineMatch / getGameView / submitGameAction.
 * Does not import the offline match hook or apply local engine transitions.
 *
 * Realtime patches PUBLIC fields only. Private interaction comes from Edge
 * viewer snapshots. A Realtime echo of our own in-flight action must not
 * trigger a second getGameView — the HTTP result is that viewer snapshot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  enterOnlineMatch,
  getGameView,
  submitGameAction,
  advanceOnlineRound,
  subscribeGameSession,
} from "../online/gameplay.js";
import {
  forfeitOnlineMatch,
  MATCH_PRESENCE_HEARTBEAT_MS,
  MatchmakingError,
  touchMyMatchPresence,
} from "../online/matchmaking.js";
import { addSafeBreadcrumb, reportError } from "../monitoring";
import {
  asViewerSnapshot,
  clearOnlineSession,
  isMatchOverView,
  isRealtimeSessionEvent,
  isRoundOverView,
  keepAuthoritativeView,
  lockedRulesetId,
  mergeRealtimeSessionView,
  ONLINE_ACTION_TIMEOUT_MS,
  onlineErrorKey,
  persistOnlineSession,
  shouldFlushPendingView,
  shouldRefreshViewerAfterRealtime,
  shouldReleaseBusy,
  viewVersion,
} from "../online/onlineTable.js";
import { createOnlineMoveTrace, isOnlineMoveTraceEnabled } from "../online/onlineMoveTrace.js";

export function useOnlineMatch({ matchId, rulesetId } = {}) {
  const [view, setView] = useState(null);
  const [status, setStatus] = useState(matchId ? "loading" : "error");
  const [errorKey, setErrorKey] = useState(matchId ? "" : "online.notFound");
  const [busy, setBusy] = useState(false);
  const viewRef = useRef(null);
  const matchIdRef = useRef(matchId);
  const inflightRef = useRef(0);
  const unmountedRef = useRef(false);
  const dragLockRef = useRef(false);
  const pendingViewRef = useRef(null);
  const busyRef = useRef(false);
  const inFlightBaseVersionRef = useRef(-1);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const roundAdvanceAtVersionRef = useRef(-1);

  matchIdRef.current = matchId;

  const applyView = useCallback((next, options = {}) => {
    const kept = keepAuthoritativeView(viewRef.current, next, {
      preferIncoming: Boolean(options.force),
    });
    if (!kept) return null;
    if (dragLockRef.current && !options.force) {
      if (shouldFlushPendingView(pendingViewRef.current, kept)) {
        pendingViewRef.current = kept;
      }
      return viewRef.current;
    }
    if (options.force) pendingViewRef.current = null;
    if (shouldReleaseBusy(inFlightBaseVersionRef.current, kept)) {
      busyRef.current = false;
      inFlightBaseVersionRef.current = -1;
      setBusy(false);
    }
    if (kept === viewRef.current) return kept;
    viewRef.current = kept;
    setView(kept);
    persistOnlineSession({
      matchId: kept.matchId,
      rulesetId: kept.rulesetId || lockedRulesetId(rulesetId),
    });
    return kept;
  }, [rulesetId]);

  const refreshView = useCallback(async () => {
    const id = matchIdRef.current;
    if (!id) return null;
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return null;
    }
    refreshInFlightRef.current = true;
    let last = null;
    try {
      do {
        refreshQueuedRef.current = false;
        last = asViewerSnapshot(await getGameView(id));
        if (unmountedRef.current) return last;
        applyView(last);
      } while (refreshQueuedRef.current && !unmountedRef.current);
      return last;
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current && !unmountedRef.current) {
        void refreshView().catch(() => {
          /* keep last authoritative view */
        });
      }
    }
  }, [applyView]);

  const boot = useCallback(async () => {
    const id = matchIdRef.current;
    if (!id) {
      setStatus("error");
      setErrorKey("online.notFound");
      return;
    }
    setStatus("loading");
    setErrorKey("");
    busyRef.current = false;
    setBusy(false);
    dragLockRef.current = false;
    pendingViewRef.current = null;
    inFlightBaseVersionRef.current = -1;
    refreshInFlightRef.current = false;
    refreshQueuedRef.current = false;
    roundAdvanceAtVersionRef.current = -1;
    try {
      let next;
      try {
        await touchMyMatchPresence(id);
        next = asViewerSnapshot(await enterOnlineMatch(id));
      } catch (error) {
        if (
          error?.code === "MATCH_NOT_ELIGIBLE" ||
          error?.code === "NO_SESSION"
        ) {
          next = asViewerSnapshot(await getGameView(id));
        } else {
          throw error;
        }
      }
      if (unmountedRef.current) return;
      applyView(next);
      setStatus("ready");
    } catch (error) {
      if (unmountedRef.current) return;
      setStatus("error");
      setErrorKey(onlineErrorKey(error));
    }
  }, [applyView]);

  useEffect(() => {
    unmountedRef.current = false;
    boot();
    return () => {
      unmountedRef.current = true;
    };
  }, [boot, matchId]);

  useEffect(() => {
    if (!matchId || status !== "ready") return undefined;
    if (isMatchOverView(viewRef.current)) return undefined;
    let cancelled = false;
    const beat = () => {
      if (cancelled || isMatchOverView(viewRef.current)) return;
      touchMyMatchPresence(matchId).catch(() => {
        /* presence is best-effort until the stale-occupancy RPC exists */
      });
    };
    beat();
    const intervalId = window.setInterval(beat, MATCH_PRESENCE_HEARTBEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [matchId, status]);

  useEffect(() => {
    if (!matchId || status !== "ready") return undefined;
    let cancelled = false;
    let stop = () => {};
    const onEvent = (payload) => {
      if (cancelled || !isRealtimeSessionEvent(payload)) return;
      const previous = viewRef.current;
      let merged = previous;
      try {
        merged = mergeRealtimeSessionView(previous, payload);
        applyView(merged);
      } catch {
        /* still consider refresh */
      }
      if (
        !shouldRefreshViewerAfterRealtime(previous, merged, {
          busy: busyRef.current,
          inFlightBaseVersion: inFlightBaseVersionRef.current,
        })
      ) {
        return;
      }
      refreshView().catch(() => {
        /* keep last authoritative view */
      });
    };
    try {
      stop = subscribeGameSession(matchId, onEvent);
    } catch {
      stop = () => {};
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, [matchId, refreshView, status, applyView]);

  const runAction = useCallback(
    async (submit, traceKind = "action") => {
      const current = viewRef.current;
      if (!current?.matchId || busyRef.current) return false;
      const token = ++inflightRef.current;
      busyRef.current = true;
      inFlightBaseVersionRef.current = viewVersion(current);
      setBusy(true);
      setErrorKey("");
      const trace = createOnlineMoveTrace(traceKind);
      trace.mark("submitStarted");
      let timeoutId = 0;
      try {
        const timed = await Promise.race([
          submit(current).then((payload) => ({ payload })),
          new Promise((resolve) => {
            timeoutId = window.setTimeout(
              () => resolve({ timeout: true }),
              ONLINE_ACTION_TIMEOUT_MS
            );
          }),
        ]);
        if (timeoutId) window.clearTimeout(timeoutId);
        if (unmountedRef.current || token !== inflightRef.current) return false;
        if (timed?.timeout) {
          trace.mark("timeout");
          setErrorKey("online.error");
          try {
            await refreshView();
          } catch {
            /* keep previous view */
          }
          trace.finish({ outcome: "timeout" });
          return false;
        }
        const next = asViewerSnapshot(timed.payload);
        trace.mark("httpReceived");
        if (isOnlineMoveTraceEnabled() && timed.payload?._timings) {
          Object.assign(trace.marks, timed.payload._timings);
        }
        applyView(next, { force: true });
        trace.mark("viewApplied");
        trace.finish({
          outcome: "ok",
          version: viewVersion(next),
          duplicateGetGameView: false,
        });
        return true;
      } catch (error) {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (unmountedRef.current || token !== inflightRef.current) return false;
        if (error?.code === "STALE_VERSION") {
          try {
            await refreshView();
            trace.mark("staleRefreshed");
            trace.finish({ outcome: "stale" });
            return true;
          } catch {
            /* fall through */
          }
        }
        setErrorKey(onlineErrorKey(error));
        try {
          await refreshView();
        } catch {
          /* keep previous view */
        }
        trace.finish({ outcome: "rejected", code: error?.code });
        return false;
      } finally {
        if (token === inflightRef.current) {
          busyRef.current = false;
          inFlightBaseVersionRef.current = -1;
          setBusy(false);
        }
      }
    },
    [applyView, refreshView]
  );

  const playTile = useCallback(
    (tileId, end) =>
      runAction(
        (current) =>
          submitGameAction(current.matchId, current.version, {
            type: "play",
            tileId,
            end,
          }),
        "play"
      ),
    [runAction]
  );

  const draw = useCallback(
    () =>
      runAction(
        (current) =>
          submitGameAction(current.matchId, current.version, { type: "draw" }),
        "draw"
      ),
    [runAction]
  );

  const pass = useCallback(
    () =>
      runAction(
        (current) =>
          submitGameAction(current.matchId, current.version, { type: "pass" }),
        "pass"
      ),
    [runAction]
  );

  const advanceRound = useCallback(
    () =>
      runAction((current) => {
        if (!isRoundOverView(current)) {
          return getGameView(current.matchId);
        }
        return advanceOnlineRound(current.matchId, current.version);
      }, "advance"),
    [runAction]
  );

  const roundPhase = view?.phase;
  const roundStatus = view?.status;
  const roundVersion = view?.version;
  useEffect(() => {
    if (status !== "ready") return;
    const snap = { phase: roundPhase, status: roundStatus, version: roundVersion };
    if (isMatchOverView(snap) || !isRoundOverView(snap)) return;
    const version = viewVersion(snap);
    if (version < 0) return;
    if (roundAdvanceAtVersionRef.current === version) return;
    if (busy) return;
    roundAdvanceAtVersionRef.current = version;
    advanceRound();
  }, [advanceRound, busy, status, roundPhase, roundStatus, roundVersion]);

  const setDragLock = useCallback(
    (locked) => {
      dragLockRef.current = Boolean(locked);
      if (locked) return;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (shouldFlushPendingView(viewRef.current, pending)) applyView(pending);
    },
    [applyView]
  );

  const leave = useCallback(async () => {
    const id = matchIdRef.current;
    const over = isMatchOverView(viewRef.current);
    if (over || !id) {
      clearOnlineSession();
      return true;
    }
    let timeoutId = 0;
    try {
      addSafeBreadcrumb("online forfeit requested", {
        screen: "onlineTable",
        actionName: "forfeit",
      });
      const settled = await Promise.race([
        forfeitOnlineMatch(id).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error })
        ),
        new Promise((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve({ timeout: true }),
            ONLINE_ACTION_TIMEOUT_MS
          );
        }),
      ]);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (settled?.timeout) {
        throw new MatchmakingError("FORFEIT_FAILED", "forfeit timed out");
      }
      if (!settled?.ok) {
        throw settled.error || new MatchmakingError("FORFEIT_FAILED", "forfeit failed");
      }
      clearOnlineSession();
      return true;
    } catch (error) {
      if (timeoutId) window.clearTimeout(timeoutId);
      addSafeBreadcrumb("online forfeit failed", {
        screen: "onlineTable",
        actionName: "forfeit",
        code: error?.code || "FORFEIT_FAILED",
      });
      reportError(error, {
        screen: "onlineTable",
        actionName: "forfeit",
        code: error?.code || "FORFEIT_FAILED",
      });
      if (!unmountedRef.current) {
        setErrorKey(onlineErrorKey(error));
      }
      return false;
    }
  }, []);

  return {
    status,
    errorKey,
    view,
    viewRef,
    busy,
    playTile,
    draw,
    pass,
    advanceRound,
    setDragLock,
    retry: boot,
    refreshView,
    leave,
  };
}
