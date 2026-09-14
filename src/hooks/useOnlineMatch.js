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
import { noteTerminalMatch } from "../online/terminalMatchMemory.js";
import {
  asViewerSnapshot,
  clearOnlineSession,
  isMatchOverView,
  isRealtimeSessionEvent,
  isRoundOverView,
  applyForfeitTerminalFields,
  hasCoherentInteraction,
  keepAuthoritativeView,
  lockedRulesetId,
  mergeRealtimeSessionView,
  needsPrivateHydration,
  occupancyTouchMissed,
  ONLINE_ACTION_TIMEOUT_MS,
  onlineErrorKey,
  persistOnlineSession,
  shouldFlushPendingView,
  shouldRefreshViewerAfterRealtime,
  shouldReleaseBusy,
  viewVersion,
} from "../online/onlineTable.js";
import {
  documentIsHidden,
  emptyPrivateHydrationState,
  notePrivateHydrationFailure,
  notePrivateHydrationSuccess,
  planPlayingHydrateTick,
  planPrivateHydration,
  PLAYING_HYDRATE_POLL_MS,
  PRIVATE_HYDRATION_TICK_MS,
} from "../online/playingHydrate.js";
import { onlineActionDiag } from "../online/onlineActionDiag.js";
import { createOnlineMoveTrace, isOnlineMoveTraceEnabled } from "../online/onlineMoveTrace.js";
import { isTurnDeadlineExpired } from "../online/turnTimeout.js";
import {
  isFatalTimeoutError,
  isRetryableTimeoutError,
  nextTimeoutRetryAt,
  planTimeoutTick,
  shouldClearTimeoutPending,
  timeoutResolveKey,
  TIMEOUT_PENDING_RECONCILE_MS,
} from "../online/timeoutFreeze.js";
import {
  emptyServiceHealthState,
  NETWORK_REQUEST_TIMEOUT_MS,
  noteServiceFailure,
  noteServiceSuccess,
  planOutageHealthTick,
  SERVICE_OUTAGE_I18N_KEY,
  shouldDisableGameplayActions,
  shouldSuppressTimeoutResolve,
  stampOutageRetry,
} from "../online/serviceHealth.js";

/**
 * Defense in depth only: every network call reachable from refreshView is
 * already bounded by NETWORK_REQUEST_TIMEOUT_MS, so this guard should never
 * actually fire. If some future call site regresses that (or an unforeseen
 * environment stalls a promise with no rejection at all), one hung refresh
 * must not be able to permanently disable every recovery path that shares
 * this in-flight guard — reconciliation, the outage retry loop, visibility/
 * online resume, and the realtime status handler all funnel through here.
 */
const STALE_REFRESH_GUARD_MS = NETWORK_REQUEST_TIMEOUT_MS * 2 + 5000;
import {
  documentIsVisible,
  isUnhealthyRealtimeStatus,
  shouldBypassDragLock,
  shouldRefreshAuthoritativeViewOnRealtimeStatus,
  shouldRefreshAuthoritativeViewOnResume,
} from "../online/interactionRecovery.js";

export function useOnlineMatch({ matchId, rulesetId } = {}) {
  const [view, setView] = useState(null);
  const [status, setStatus] = useState(matchId ? "loading" : "error");
  const [errorKey, setErrorKey] = useState(matchId ? "" : "online.notFound");
  const [leaveErrorKey, setLeaveErrorKey] = useState("");
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
  const refreshInFlightSinceRef = useRef(0);
  const refreshQueuedRef = useRef(false);
  const roundAdvanceAtVersionRef = useRef(-1);
  const timeoutInFlightRef = useRef(false);
  const timeoutRetryAtRef = useRef(0);
  const timeoutAttemptRef = useRef(0);
  const timeoutAttemptedKeyRef = useRef("");
  const timeoutReconcileAtRef = useRef(0);
  const serviceHealthRef = useRef(emptyServiceHealthState());
  const privateHydrationRef = useRef(emptyPrivateHydrationState());

  matchIdRef.current = matchId;

  const applyView = useCallback((next, options = {}) => {
    const kept = keepAuthoritativeView(viewRef.current, next, {
      preferIncoming: Boolean(options.force),
    });
    if (!kept) return null;
    if (
      dragLockRef.current &&
      !options.force &&
      !shouldBypassDragLock(viewRef.current, kept)
    ) {
      if (shouldFlushPendingView(pendingViewRef.current, kept)) {
        pendingViewRef.current = kept;
      }
      return viewRef.current;
    }
    if (options.force || shouldBypassDragLock(viewRef.current, kept)) {
      pendingViewRef.current = null;
    }
    if (shouldReleaseBusy(inFlightBaseVersionRef.current, kept)) {
      busyRef.current = false;
      inFlightBaseVersionRef.current = -1;
      setBusy(false);
    }
    if (kept === viewRef.current) return kept;
    if (shouldClearTimeoutPending(viewRef.current, kept)) {
      timeoutAttemptRef.current = 0;
      timeoutRetryAtRef.current = 0;
      timeoutAttemptedKeyRef.current = "";
      timeoutReconcileAtRef.current = 0;
    }
    viewRef.current = kept;
    setView(kept);
    if (isMatchOverView(kept)) {
      if (kept.matchId) noteTerminalMatch(kept.matchId);
      clearOnlineSession();
    } else {
      persistOnlineSession({
        matchId: kept.matchId,
        rulesetId: kept.rulesetId || lockedRulesetId(rulesetId),
      });
    }
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

  const refreshView = useCallback(async (options = {}) => {
    const id = matchIdRef.current;
    if (!id) return null;
    if (refreshInFlightRef.current) {
      const stuckForMs = Date.now() - refreshInFlightSinceRef.current;
      if (stuckForMs < STALE_REFRESH_GUARD_MS) {
        refreshQueuedRef.current = true;
        return null;
      }
      // The previous attempt's own bounded network timeout should already
      // have released this guard via `finally`. It did not — do not let a
      // single stuck promise disable recovery permanently.
      onlineActionDiag("stale_refresh_guard_reset", {
        matchId: id,
        clientKnownVersion: viewVersion(viewRef.current),
        actionType: "refresh",
        failureStage: "stale_refresh_guard_reset",
      });
      refreshInFlightRef.current = false;
    }
    refreshInFlightRef.current = true;
    refreshInFlightSinceRef.current = Date.now();
    let last = null;
    try {
      do {
        refreshQueuedRef.current = false;
        last = asViewerSnapshot(await getGameView(id));
        markServiceResult(null);
        if (unmountedRef.current) return last;
        applyView(last, {
          force: isMatchOverView(last) || Boolean(options.force),
        });
      } while (refreshQueuedRef.current && !unmountedRef.current);
      return last;
    } catch (error) {
      markServiceResult(error);
      throw error;
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current && !unmountedRef.current) {
        void refreshView(options).catch(() => {
          /* keep last authoritative view */
        });
      }
    }
  }, [applyView, markServiceResult]);

  const hydratePrivateHand = useCallback((options = {}) => {
    const current = viewRef.current;
    if (isMatchOverView(current)) {
      privateHydrationRef.current = notePrivateHydrationSuccess();
      return;
    }
    if (!needsPrivateHydration(current)) {
      if (privateHydrationRef.current.attempt || privateHydrationRef.current.lastFailed) {
        privateHydrationRef.current = notePrivateHydrationSuccess();
      }
      return;
    }
    const planned = planPrivateHydration(current, privateHydrationRef.current, {
      nowMs: Date.now(),
      hidden: documentIsHidden(),
      immediate: Boolean(options.immediate),
      refreshInFlight: refreshInFlightRef.current,
    });
    if (planned.action !== "refresh") return;
    void refreshView({ force: true })
      .then((last) => {
        if (unmountedRef.current) return;
        if (!needsPrivateHydration(viewRef.current)) {
          privateHydrationRef.current = notePrivateHydrationSuccess();
          return;
        }
        if (last == null && refreshInFlightRef.current) return;
        privateHydrationRef.current = notePrivateHydrationFailure(
          privateHydrationRef.current,
          Date.now()
        );
      })
      .catch(() => {
        if (unmountedRef.current) return;
        privateHydrationRef.current = notePrivateHydrationFailure(
          privateHydrationRef.current,
          Date.now()
        );
      });
  }, [refreshView]);

  const boot = useCallback(async () => {
    const id = matchIdRef.current;
    if (!id) {
      setStatus("error");
      setErrorKey("online.notFound");
      return;
    }
    setStatus("loading");
    setErrorKey("");
    setLeaveErrorKey("");
    timeoutAttemptRef.current = 0;
    timeoutRetryAtRef.current = 0;
    timeoutAttemptedKeyRef.current = "";
    timeoutInFlightRef.current = false;
    busyRef.current = false;
    setBusy(false);
    dragLockRef.current = false;
    pendingViewRef.current = null;
    inFlightBaseVersionRef.current = -1;
    refreshInFlightRef.current = false;
    refreshInFlightSinceRef.current = 0;
    refreshQueuedRef.current = false;
    roundAdvanceAtVersionRef.current = -1;
    serviceHealthRef.current = emptyServiceHealthState();
    privateHydrationRef.current = emptyPrivateHydrationState();
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
    const refreshIfPlaying = () => {
      if (!documentIsVisible()) return;
      hydratePrivateHand({ immediate: true });
      if (!shouldRefreshAuthoritativeViewOnResume(viewRef.current)) return;
      onlineActionDiag("resume_reconcile", {
        matchId: matchIdRef.current,
        clientKnownVersion: viewVersion(viewRef.current),
        serverTurn: viewRef.current?.currentSeat,
        turnDeadlineAt: viewRef.current?.turnDeadlineAt,
        connectivity: "resume",
        reconcileTriggered: true,
        actionType: "resume",
        failureStage: "resume_reconcile",
      });
      void refreshView({ force: true }).catch(() => {
        /* keep last authoritative view */
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshIfPlaying();
    };
    const onOnline = () => refreshIfPlaying();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refreshIfPlaying);
    window.addEventListener("pageshow", refreshIfPlaying);
    window.addEventListener("online", onOnline);
    document.addEventListener("resume", refreshIfPlaying);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refreshIfPlaying);
      window.removeEventListener("pageshow", refreshIfPlaying);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("resume", refreshIfPlaying);
    };
  }, [matchId, status, refreshView, hydratePrivateHand]);

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
      hydratePrivateHand();
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
    const onStatus = (channelStatus) => {
      if (cancelled) return;
      if (!shouldRefreshAuthoritativeViewOnRealtimeStatus(channelStatus)) return;
      if (!documentIsVisible()) return;
      hydratePrivateHand({ immediate: true });
      onlineActionDiag("realtime_status_reconcile", {
        matchId: matchIdRef.current,
        clientKnownVersion: viewVersion(viewRef.current),
        connectivity: isUnhealthyRealtimeStatus(channelStatus) ? "realtime_unhealthy" : "realtime_subscribed",
        reconcileTriggered: true,
        actionType: channelStatus,
        failureStage: "realtime_status_reconcile",
      });
      void refreshView({ force: true }).catch(() => {
        /* keep last authoritative view */
      });
    };
    try {
      stop = subscribeGameSession(matchId, onEvent, undefined, onStatus);
    } catch {
      stop = () => {};
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, [matchId, refreshView, status, applyView, hydratePrivateHand]);

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
      addSafeBreadcrumb("online action submit", {
        screen: "onlineTable",
        matchId: current.matchId,
        matchVersion: viewVersion(current),
        actionName: traceKind,
        failureStage: "client_submit",
      });
      onlineActionDiag("client_submit", {
        matchId: current.matchId,
        expectedVersion: viewVersion(current),
        clientKnownVersion: viewVersion(current),
        serverTurn: current.currentSeat,
        actionType: traceKind,
        failureStage: "client_submit",
      });
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
            // Not a successful commit of *this* submit. Callers must roll back any
            // local play affordance and rely on the refreshed authoritative view.
            trace.finish({ outcome: "stale" });
            return false;
          } catch {
            /* fall through */
          }
        }
        markServiceResult(error);
        addSafeBreadcrumb("online action rejected", {
          screen: "onlineTable",
          matchId: matchIdRef.current,
          matchVersion: viewVersion(viewRef.current),
          actionName: traceKind,
          backendErrorCode: error?.code,
          failureStage: "rejected",
        });
        onlineActionDiag("rejected", {
          matchId: matchIdRef.current,
          expectedVersion: viewVersion(current),
          serverVersion: viewVersion(viewRef.current),
          clientKnownVersion: viewVersion(current),
          serverTurn: viewRef.current?.currentSeat,
          actionType: traceKind,
          failureStage: "rejected",
        });
        setErrorKey(
          serviceHealthRef.current.outage ? SERVICE_OUTAGE_I18N_KEY : onlineErrorKey(error)
        );
        try {
          await refreshView({ force: !hasCoherentInteraction(viewRef.current) });
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
          if (
            !unmountedRef.current &&
            viewRef.current &&
            !isMatchOverView(viewRef.current) &&
            !hasCoherentInteraction(viewRef.current)
          ) {
            void refreshView({ force: true }).catch(() => {
              /* keep last authoritative view */
            });
          }
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
    const nowMs = Date.now();
    if (nowMs < timeoutRetryAtRef.current) return false;
    const attemptKey = timeoutResolveKey(current);
    if (
      attemptKey &&
      timeoutAttemptedKeyRef.current === attemptKey &&
      (!timeoutRetryAtRef.current || nowMs < timeoutRetryAtRef.current)
    ) {
      return false;
    }
    timeoutInFlightRef.current = true;
    timeoutAttemptedKeyRef.current = attemptKey;
    const matchIdForRequest = current.matchId;
    const expectedVersion = current.version;
    onlineActionDiag("timeout_resolve", {
      matchId: matchIdForRequest,
      expectedVersion,
      clientKnownVersion: expectedVersion,
      serverTurn: current.currentSeat,
      turnDeadlineAt: current.turnDeadlineAt,
      timeoutDue: true,
      connectivity: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
      actionType: "timeout",
      failureStage: "timeout_resolve",
    });
    let timeoutId = 0;
    try {
      const timed = await Promise.race([
        resolveTurnTimeout(matchIdForRequest, expectedVersion).then((payload) => ({ payload })),
        new Promise((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve({ timeout: true }),
            ONLINE_ACTION_TIMEOUT_MS
          );
        }),
      ]);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (unmountedRef.current) return false;
      if (timed?.timeout) {
        timeoutAttemptRef.current += 1;
        timeoutRetryAtRef.current = nextTimeoutRetryAt(timeoutAttemptRef.current, Date.now());
        markServiceResult({ name: "TimeoutError", timeout: true, message: "timeout" });
        onlineActionDiag("timeout_resolve_hung", {
          matchId: matchIdForRequest,
          expectedVersion,
          clientKnownVersion: viewVersion(viewRef.current),
          turnDeadlineAt: viewRef.current?.turnDeadlineAt,
          timeoutDue: true,
          connectivity: "hung",
          actionType: "timeout",
          failureStage: "timeout_resolve_hung",
        });
        try {
          await refreshView({ force: true });
        } catch {
          /* keep last authoritative view */
        }
        return false;
      }
      const next = asViewerSnapshot(timed.payload);
      applyView(next, { force: true });
      timeoutAttemptRef.current = 0;
      timeoutRetryAtRef.current = 0;
      timeoutAttemptedKeyRef.current = "";
      return true;
    } catch (error) {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutAttemptRef.current += 1;
      timeoutRetryAtRef.current = nextTimeoutRetryAt(timeoutAttemptRef.current, Date.now());
      onlineActionDiag("timeout_resolve_rejected", {
        matchId: matchIdForRequest,
        expectedVersion,
        serverVersion: viewVersion(viewRef.current),
        clientKnownVersion: expectedVersion,
        turnDeadlineAt: viewRef.current?.turnDeadlineAt,
        timeoutDue: true,
        staleRejected: error?.code === "STALE_VERSION",
        casConflict: error?.code === "STALE_VERSION",
        actionType: "timeout",
        failureStage: error?.code || "timeout_resolve_rejected",
      });
      try {
        await refreshView({ force: true });
      } catch {
        /* keep last authoritative view */
      }
      if (error?.code === "STALE_VERSION" || error?.code === "TIMEOUT_NOT_DUE") {
        return Boolean(isMatchOverView(viewRef.current));
      }
      markServiceResult(error);
      if (serviceHealthRef.current.outage) {
        if (!unmountedRef.current) setErrorKey(SERVICE_OUTAGE_I18N_KEY);
        return false;
      }
      if (isRetryableTimeoutError(error) || !isFatalTimeoutError(error)) {
        return Boolean(isMatchOverView(viewRef.current));
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
        retryNotBefore: timeoutRetryAtRef.current,
        attemptedKey: timeoutAttemptedKeyRef.current,
        lastReconcileAt: timeoutReconcileAtRef.current,
        nowMs: Date.now(),
        serviceOutage: shouldSuppressTimeoutResolve(serviceHealthRef.current),
        outageRetryNotBefore: serviceHealthRef.current?.retryNotBefore,
      });
      if (planned.clearPending) {
        timeoutAttemptRef.current = 0;
        timeoutRetryAtRef.current = 0;
        timeoutAttemptedKeyRef.current = "";
        timeoutReconcileAtRef.current = 0;
      }
      if (planned.action === "reconcile") {
        onlineActionDiag("timeout_reconcile", {
          matchId: current?.matchId,
          clientKnownVersion: viewVersion(current),
          serverTurn: current?.currentSeat,
          turnDeadlineAt: current?.turnDeadlineAt,
          timeoutDue: true,
          reconcileTriggered: true,
          connectivity:
            typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online",
          actionType: "reconcile",
          failureStage: "timeout_reconcile",
        });
        void refreshView({ force: true })
          .then(() => {
            timeoutReconcileAtRef.current = Date.now();
          })
          .catch(() => {
            // Failed fetch: allow a sooner retry than the full soft-lock window.
            timeoutReconcileAtRef.current = Date.now() - Math.floor(TIMEOUT_PENDING_RECONCILE_MS / 2);
          });
        return;
      }
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
  }, [status, turnDeadlineAt, roundPhase, roundVersion, resolveTimeout, refreshView]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const tick = () => {
      const planned = planPlayingHydrateTick(viewRef.current, {
        hidden: documentIsHidden(),
        busy: busyRef.current,
        dragLocked: dragLockRef.current,
      });
      if (planned.action !== "refresh") return;
      if (planned.reason === "private_hand_missing") {
        hydratePrivateHand();
        return;
      }
      addSafeBreadcrumb("online hydrate poll", {
        screen: "onlineTable",
        matchId: matchIdRef.current,
        matchVersion: viewVersion(viewRef.current),
        actionName: "hydrate",
        failureStage: "hydrate",
      });
      onlineActionDiag("hydrate", {
        matchId: matchIdRef.current,
        expectedVersion: viewVersion(viewRef.current),
        clientKnownVersion: viewVersion(viewRef.current),
        serverTurn: viewRef.current?.currentSeat,
        actionType: planned.reason,
        failureStage: "hydrate",
      });
      void refreshView({ force: Boolean(planned.force) }).catch(() => {
        /* keep last authoritative view */
      });
    };
    tick();
    const intervalId = window.setInterval(tick, PLAYING_HYDRATE_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [status, refreshView, hydratePrivateHand]);

  const privateHydrationKey = `${view?.version}:${view?.round}:${Array.isArray(view?.handCounts) ? view.handCounts.join(",") : ""}:${Array.isArray(view?.myHand) ? view.myHand.length : "x"}`;
  useEffect(() => {
    if (status !== "ready") return undefined;
    const tick = () => hydratePrivateHand();
    tick();
    const intervalId = window.setInterval(tick, PRIVATE_HYDRATION_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [status, hydratePrivateHand, privateHydrationKey]);

  useEffect(() => {
    if (status !== "ready" || !serviceOutage) return undefined;
    const tick = () => {
      const planned = planOutageHealthTick(serviceHealthRef.current, Date.now());
      if (planned.action !== "refresh") return;
      serviceHealthRef.current = stampOutageRetry(serviceHealthRef.current, Date.now());
      hydratePrivateHand({ immediate: true });
      void refreshView().catch(() => {
        /* keep last authoritative view */
      });
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [status, serviceOutage, refreshView, hydratePrivateHand]);

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
      if (id) noteTerminalMatch(id);
      clearOnlineSession();
      return true;
    }
    let timeoutId = 0;
    try {
      setLeaveErrorKey("");
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
      clearOnlineSession();
      noteTerminalMatch(id);
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
        setLeaveErrorKey(onlineErrorKey(error));
      }
      return false;
    }
  }, [applyView]);

  return {
    status,
    errorKey,
    leaveErrorKey,
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
