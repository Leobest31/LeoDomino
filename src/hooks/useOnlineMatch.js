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
  resolveTurnTimeout,
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
  applyForfeitTerminalFields,
  keepAuthoritativeView,
  lockedRulesetId,
  mergeRealtimeSessionView,
  occupancyTouchMissed,
  ONLINE_ACTION_TIMEOUT_MS,
  onlineErrorKey,
  persistOnlineSession,
  shouldFlushPendingView,
  shouldRefreshViewerAfterRealtime,
  shouldReleaseBusy,
  viewVersion,
} from "../online/onlineTable.js";
import { createOnlineMoveTrace, isOnlineMoveTraceEnabled } from "../online/onlineMoveTrace.js";
import { isTurnDeadlineExpired } from "../online/turnTimeout.js";
import { planTimeoutTick } from "../online/timeoutFreeze.js";
import {
  emptyServiceHealthState,
  noteServiceFailure,
  noteServiceSuccess,
  planOutageHealthTick,
  SERVICE_OUTAGE_I18N_KEY,
  shouldDisableGameplayActions,
  shouldSuppressTimeoutResolve,
  stampOutageRetry,
} from "../online/serviceHealth.js";

export function useOnlineMatch({ matchId, rulesetId } = {}) {
  const [view, setView] = useState(null);
  const [status, setStatus] = useState(matchId ? "loading" : "error");
  const [errorKey, setErrorKey] = useState(matchId ? "" : "online.notFound");
  const [busy, setBusy] = useState(false);
  const [serviceOutage, setServiceOutage] = useState(false);
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
  const timeoutInFlightRef = useRef(false);
  const serviceHealthRef = useRef(emptyServiceHealthState());

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

  const markServiceResult = useCallback((error) => {
    const current = serviceHealthRef.current;
    const next = error ? noteServiceFailure(current, error) : noteServiceSuccess(current);
    serviceHealthRef.current = next;
    if (next.outage !== current.outage) setServiceOutage(next.outage);
    if (next.outage && !unmountedRef.current) setErrorKey(SERVICE_OUTAGE_I18N_KEY);
    if (!next.outage && !error && !unmountedRef.current) {
      setErrorKey((key) => (key === SERVICE_OUTAGE_I18N_KEY ? "" : key));
    }
    return next;
  }, []);

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
        markServiceResult(null);
        if (unmountedRef.current) return last;
        applyView(last, { force: isMatchOverView(last) });
      } while (refreshQueuedRef.current && !unmountedRef.current);
      return last;
    } catch (error) {
      markServiceResult(error);
      throw error;
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current && !unmountedRef.current) {
        void refreshView().catch(() => {
          /* keep last authoritative view */
        });
      }
    }
  }, [applyView, markServiceResult]);

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
    serviceHealthRef.current = emptyServiceHealthState();
    setServiceOutage(false);
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
      applyView(next, { force: isMatchOverView(next) });
      markServiceResult(null);
      setStatus("ready");
    } catch (error) {
      if (unmountedRef.current) return;
      markServiceResult(error);
      setStatus(viewRef.current ? "ready" : "error");
      setErrorKey(
        serviceHealthRef.current.outage ? SERVICE_OUTAGE_I18N_KEY : onlineErrorKey(error)
      );
    }
  }, [applyView, markServiceResult]);

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
      if (shouldDisableGameplayActions(serviceHealthRef.current)) return;
      touchMyMatchPresence(matchId)
        .then((result) => {
          if (cancelled || isMatchOverView(viewRef.current)) return;
          if (occupancyTouchMissed(result)) {
            void refreshView().catch(() => {
              /* keep last authoritative view */
            });
          }
        })
        .catch((error) => {
          markServiceResult(error);
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
  }, [matchId, refreshView, status, markServiceResult]);

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
        applyView(merged, { force: isMatchOverView(merged) });
      } catch {
        /* still consider refresh */
      }
      if (
        serviceHealthRef.current.outage ||
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
      const health = serviceHealthRef.current;
      if (!current?.matchId || busyRef.current) return false;
      if (shouldDisableGameplayActions(health)) return false;
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
          markServiceResult({ name: "TimeoutError", timeout: true, message: "timeout" });
          setErrorKey(
            serviceHealthRef.current.outage ? SERVICE_OUTAGE_I18N_KEY : "online.error"
          );
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
        markServiceResult(null);
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
        if (error?.code === "STALE_VERSION" || error?.code === "TIMEOUT_NOT_DUE") {
          try {
            await refreshView();
            trace.mark("staleRefreshed");
            trace.finish({ outcome: "stale" });
            return true;
          } catch {
            /* fall through */
          }
        }
        markServiceResult(error);
        setErrorKey(
          serviceHealthRef.current.outage ? SERVICE_OUTAGE_I18N_KEY : onlineErrorKey(error)
        );
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
    [applyView, refreshView, markServiceResult]
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

  const resolveTimeout = useCallback(async () => {
    const current = viewRef.current;
    if (!current || timeoutInFlightRef.current) return false;
    if (shouldSuppressTimeoutResolve(serviceHealthRef.current)) return false;
    if (isMatchOverView(current) || current.phase !== "playing") return false;
    if (!isTurnDeadlineExpired(current)) return false;
    timeoutInFlightRef.current = true;
    try {
      const next = asViewerSnapshot(
        await resolveTurnTimeout(current.matchId, current.version)
      );
      if (unmountedRef.current) return true;
      applyView(next, { force: true });
      return true;
    } catch (error) {
      if (
        error?.code === "STALE_VERSION" ||
        error?.code === "TIMEOUT_NOT_DUE" ||
        error?.code === "MATCH_NOT_ELIGIBLE"
      ) {
        try {
          await refreshView();
        } catch {
          /* keep last authoritative view */
        }
        return true;
      }
      markServiceResult(error);
      if (serviceHealthRef.current.outage) {
        if (!unmountedRef.current) setErrorKey(SERVICE_OUTAGE_I18N_KEY);
        return false;
      }
      if (!unmountedRef.current) setErrorKey(onlineErrorKey(error));
      return false;
    } finally {
      timeoutInFlightRef.current = false;
    }
  }, [applyView, refreshView, markServiceResult]);

  const roundPhase = view?.phase;
  const roundStatus = view?.status;
  const roundVersion = view?.version;
  const turnDeadlineAt = view?.turnDeadlineAt;
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

  useEffect(() => {
    if (status !== "ready") return undefined;
    if (!turnDeadlineAt || roundPhase !== "playing") return undefined;
    const tick = () => {
      const current = viewRef.current;
      const planned = planTimeoutTick(current, {
        inFlight: timeoutInFlightRef.current,
        nowMs: Date.now(),
        serviceOutage: shouldSuppressTimeoutResolve(serviceHealthRef.current),
      });
      if (planned.action === "resolve") void resolveTimeout();
    };
    tick();
    const intervalId = window.setInterval(tick, 250);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [status, turnDeadlineAt, roundPhase, roundVersion, resolveTimeout]);

  useEffect(() => {
    if (status !== "ready" || !serviceOutage) return undefined;
    const tick = () => {
      const planned = planOutageHealthTick(serviceHealthRef.current, Date.now());
      if (planned.action !== "refresh") return;
      serviceHealthRef.current = stampOutageRetry(serviceHealthRef.current, Date.now());
      void refreshView().catch(() => {
        /* keep last authoritative view */
      });
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [status, serviceOutage, refreshView]);

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
      try {
        const next = asViewerSnapshot(await getGameView(id));
        if (!unmountedRef.current) applyView(next, { force: true });
      } catch {
        if (!unmountedRef.current) {
          applyView(applyForfeitTerminalFields(viewRef.current, settled.value), {
            force: true,
          });
        }
      }
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
  }, [applyView]);

  return {
    status,
    errorKey,
    view,
    viewRef,
    busy,
    serviceOutage,
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
