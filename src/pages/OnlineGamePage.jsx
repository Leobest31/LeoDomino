import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import Header from "../components/Header";
import GameTable from "../components/GameTable";
import PlayerPanel from "../components/PlayerPanel";
import ReservePicker from "../components/ReservePicker";
import ScoreBoard, { SeatScore } from "../components/ScoreBoard";
import BottomBar from "../components/BottomBar";
import DragGhost from "../components/DragGhost";
import GameBanner from "../components/GameBanner";
import MatchOverModal from "../components/MatchOverModal";
import AbandonMatchDialog from "../components/AbandonMatchDialog";
import { isForfeitView, isTimeoutView } from "../online/gameAuthority.js";
import {
  fetchSettledMatchRpResult,
  isOnlineMatchAborted,
  matchRpDisplayFromResult,
  notifyGlobalRatingRefresh,
} from "../online/globalRp.js";
import {
  applyGameplayLayoutVars,
  gameplayDensityClass,
  measureSafeGameplayBox,
  resolveGameplayLayout,
} from "../ui/gameplayLayout.js";
import { useOnlineMatch } from "../hooks/useOnlineMatch.js";
import { usePrefs } from "../hooks/usePrefs.js";
import { useAuth } from "../auth";
import { useFriendsBoard } from "../hooks/useFriends.js";
import FriendButton from "../components/FriendButton";
import {
  PHASE,
  isAutoPlaceable,
  legalEndsForTile,
  resolvePlayChoice,
  resolveRuleset,
} from "../game/index.js";
import {
  destinationHighlightMap,
  destinationTileId,
  pickTargetDestination,
  resolveDestinationOutward,
  DESTINATION_TAP_SLOP_PX,
} from "../game/destinationTarget.js";
import { usesAmericanBoardLayout } from "../board/index.js";
import {
  attachCapturedPointerTracking,
  pointerStillDown,
  shouldDeferHandDrag,
  watchHandScrollOrDrag,
} from "../ui/handTilePointer.js";
import { forcedOpeningTileId, openingTurnStatus } from "../ui/openingTurn.js";
import PlayerAvatar from "../components/PlayerAvatar";
import OpponentPanel from "../components/OpponentPanel";
import { addSafeBreadcrumb } from "../monitoring";
import {
  boardTilesFromView,
  equivalentPlayEnd,
  handTilesFromView,
  layoutFromView,
  lockedRulesetId,
  applyOptimisticBoardPreview,
  onlineDragGate,
  opaqueReserveIds,
  optimisticPlayPreview,
  roundIdentityFromView,
  tableEpochFromView,
  isInteractableTurn,
  isViewerTurn,
  hasCoherentInteraction,
} from "../online/onlineTable.js";
import { createOnlineMoveTrace } from "../online/onlineMoveTrace.js";
import {
  endChoiceI18nKey,
  hasUsableDomTargets,
  resolvePlayWithoutDomTargets,
  shouldClearLocalInteraction,
} from "../online/interactionRecovery.js";
import {
  TIMEOUT_STRIKE_LIMIT,
  formatTurnSeconds,
  isTimeoutMatchOver,
  remainingTurnMs,
  turnTimerTone,
} from "../online/turnTimeout.js";
import { gameStyleForRulesetId } from "../data/gameStyles.js";
import "./GamePage.css";

function useTurnCountdown(view) {
  const [remainingMs, setRemainingMs] = useState(() => remainingTurnMs(view));
  useEffect(() => {
    if (view?.phase !== PHASE.PLAYING || !view?.turnDeadlineAt) {
      setRemainingMs(null);
      return undefined;
    }
    const tick = () => setRemainingMs(remainingTurnMs(view));
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
  }, [view]);
  return remainingMs;
}

function useGameplayLayout(layoutOptions = {}) {
  const pageRef = useRef(null);
  const playerCount = Number(layoutOptions.playerCount) || 2;
  const rulesetId = layoutOptions.rulesetId ?? "";

  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return undefined;

    const apply = () => {
      const layout = resolveGameplayLayout(measureSafeGameplayBox(el), {
        playerCount,
        rulesetId,
      });
      applyGameplayLayoutVars(el, layout);
      const stage = el.querySelector(".game-table__felt") || el.querySelector(".game-page__table");
      if (stage) {
        const feltW = Math.max(120, stage.clientWidth || 0);
        const feltH = Math.max(120, stage.clientHeight || 0);
        el.style.setProperty("--felt-width", `${feltW.toFixed(0)}px`);
        el.style.setProperty("--felt-height", `${feltH.toFixed(0)}px`);
      }
      el.dataset.layoutDensity = gameplayDensityClass(layout);
      el.dataset.ruleset = rulesetId;
      el.dataset.orientation = layout.orientation || "";
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const stage = el.querySelector(".game-table__felt") || el.querySelector(".game-page__table");
    if (stage) ro.observe(stage);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, [playerCount, rulesetId]);

  return pageRef;
}

function collectDestinationTargets(legalEnds, layout) {
  if (!legalEnds?.length) return [];
  const american = usesAmericanBoardLayout(layout.rulesetId);
  const targets = [];
  for (const end of legalEnds) {
    const tileId = destinationTileId(end, layout);
    if (!tileId) continue;
    const el = document.querySelector(`[data-board-tile="${tileId}"]`);
    if (!el) continue;
    const travelDir = el.getAttribute("data-travel-dir");
    const spinnerHub = Boolean(layout.spinnerId && tileId === layout.spinnerId);
    targets.push({
      end,
      rect: el.getBoundingClientRect(),
      outward: resolveDestinationOutward(end, travelDir, { spinnerHub, american }),
    });
  }
  return targets;
}

function OnlineGamePage({ matchOptions = {}, onMainMenu }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const { vibrate } = usePrefs();
  const { session } = useAuth();
  const friends = useFriendsBoard({ watchOnline: false });
  const matchId = matchOptions.matchId;
  const host = matchOptions.host;
  const opponent = matchOptions.opponent;
  const {
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
    retry,
    leave,
    leaveErrorKey,
  } = useOnlineMatch({
    matchId,
    rulesetId: lockedRulesetId(matchOptions.rulesetId),
  });

  const rulesetId = view?.rulesetId || lockedRulesetId(matchOptions.rulesetId) || "";
  const pageRef = useGameplayLayout({
    playerCount: 2,
    rulesetId,
  });
  const viewerSeat = view?.viewerSeat ?? 0;
  const rivalSeat = viewerSeat === 0 ? 1 : 0;
  const humanName = String(
    (viewerSeat === 0 ? host?.displayName : opponent?.displayName) ||
      session?.displayName ||
      session?.username ||
      ""
  ).trim();
  const rival =
    viewerSeat === 0
      ? opponent
      : host;
  const rivalName = rival?.displayName || t("game.rival");
  const humanAvatarId = (viewerSeat === 0 ? host?.avatarId : opponent?.avatarId) || session?.avatarId;
  const rivalAvatarId = rival?.avatarId;
  const [selectedId, setSelectedId] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hotEnd, setHotEnd] = useState(null);
  const [roundBanner, setRoundBanner] = useState(null);
  const [pendingPlay, setPendingPlay] = useState(null);
  const [abandonIntent, setAbandonIntent] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [matchRp, setMatchRp] = useState(null);
  const leavingRef = useRef(false);
  const dragRef = useRef(null);
  const captureTargetRef = useRef(null);
  const skipClickRef = useRef(false);
  const dragTrackingStopRef = useRef(null);
  const dragFinishFnRef = useRef(null);

  useEffect(() => {
    addSafeBreadcrumb("entered live online table", {
      screen: "onlineTable",
      mode: "online",
      matchId,
    });
  }, [matchId]);

  const legalMoves = useMemo(() => view?.legalMoves ?? [], [view]);
  const isHumanTurn = !serviceOutage && isInteractableTurn(view);
  const mustPlayTileId = forcedOpeningTileId({
    isTurn: isHumanTurn,
    mustPlayTileId: view?.mustPlayTileId,
  });
  const awaitingInteraction = isViewerTurn(view) && !hasCoherentInteraction(view);
  const matchOver = view?.phase === PHASE.MATCH_OVER || view?.status === "match_over";
  const roundOver = view?.phase === PHASE.ROUND_OVER || view?.status === "round_over";
  const matchAborted = isOnlineMatchAborted(view);
  const remainingMs = useTurnCountdown(matchOver || roundOver ? null : view);
  const timerSeconds = formatTurnSeconds(remainingMs);
  const timerTone = turnTimerTone(remainingMs);

  useEffect(() => {
    if (!matchOver || !matchId) {
      setMatchRp(null);
      return undefined;
    }
    if (matchAborted) {
      setMatchRp({ kind: "none" });
      return undefined;
    }
    let cancelled = false;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    setMatchRp(null);
    void (async () => {
      try {
        const result = await fetchSettledMatchRpResult(matchId, { signal: controller?.signal });
        if (cancelled) return;
        const display = matchRpDisplayFromResult(result);
        setMatchRp(display);
        if (display.kind === "rated") notifyGlobalRatingRefresh();
      } catch {
        if (!cancelled) setMatchRp({ kind: "none" });
      }
    })();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [matchOver, matchId, matchAborted]);
  const roundIdentity = roundIdentityFromView(view);
  const tableEpoch = tableEpochFromView(view);
  const boardTiles = useMemo(() => {
    const tiles = boardTilesFromView(view);
    if (!pendingPlay || pendingPlay.roundIdentity !== roundIdentity) return tiles;
    return applyOptimisticBoardPreview(tiles, pendingPlay);
  }, [view, pendingPlay, roundIdentity]);
  const humanHand = useMemo(() => {
    const tiles = handTilesFromView(view);
    if (!pendingPlay?.tileId || pendingPlay.roundIdentity !== roundIdentity) return tiles;
    return tiles.filter((tile) => tile.id !== pendingPlay.tileId);
  }, [view, pendingPlay, roundIdentity]);
  const spinnerId = view?.spinner?.id ?? null;
  const spinnerNorth = view?.spinner?.north;
  const spinnerSouth = view?.spinner?.south;
  const actions = {
    canPlay: isHumanTurn && Boolean(view?.canPlay),
    canDraw: isHumanTurn && Boolean(view?.canDraw),
    canPass: isHumanTurn && Boolean(view?.canPass),
    legalMoves: isHumanTurn ? legalMoves : [],
  };

  const needsEndChoice =
    Boolean(selectedId) &&
    !isAutoPlaceable(legalMoves, selectedId) &&
    legalEndsForTile(legalMoves, selectedId).length > 0;

  const destLayout = useMemo(() => layoutFromView(view), [view]);
  const hiddenIds = useMemo(() => {
    const ids = [];
    if (drag?.tileId) ids.push(drag.tileId);
    if (pendingPlay?.tileId && pendingPlay.roundIdentity === roundIdentity) {
      ids.push(pendingPlay.tileId);
    }
    return ids.length ? new Set(ids) : null;
  }, [drag, pendingPlay, roundIdentity]);
  const dragLegalEnds = drag ? legalEndsForTile(legalMoves, drag.tileId) : [];
  const selectedLegalEnds =
    selectedId && !drag ? legalEndsForTile(legalMoves, selectedId) : [];
  const highlightLegalEnds = dragLegalEnds.length ? dragLegalEnds : selectedLegalEnds;
  const highlightByEnd = destinationHighlightMap(highlightLegalEnds, destLayout);
  const targetTileId = hotEnd ? highlightByEnd[hotEnd] ?? null : null;

  const placeTile = useCallback(
    async (tileId, end) => {
      const trace = createOnlineMoveTrace("play-client");
      trace.mark("pointerRelease");
      const snap = viewRef.current;
      const moves = snap?.legalMoves ?? legalMoves;
      const chosen = resolvePlayChoice(moves, tileId, end);
      if (!chosen) {
        play("error");
        return false;
      }
      trace.mark("actionCreated");
      setSelectedId(null);
      const preview = optimisticPlayPreview(chosen);
      if (preview) {
        setPendingPlay({
          ...preview,
          roundIdentity: roundIdentityFromView(snap),
        });
      }
      play("place");
      vibrate(14);
      trace.mark("optimisticVisible");
      const ok = await playTile(tileId, chosen.end);
      trace.mark("httpSettled");
      if (!ok) {
        setPendingPlay(null);
        play("error");
        trace.finish({ outcome: "rollback" });
        return false;
      }
      trace.finish({ outcome: "ok", tileId });
      return true;
    },
    [legalMoves, play, playTile, vibrate, viewRef]
  );

  const handleTileSelect = (tileId) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    if (!isHumanTurn || busy || drag) return;
    unlock();
    const snap = viewRef.current;
    const moves = snap?.legalMoves ?? legalMoves;
    const layout = layoutFromView(snap);
    const ends = legalEndsForTile(moves, tileId);
    if (!ends.length) {
      play("error");
      return;
    }
    const autoEnd =
      equivalentPlayEnd(moves, tileId, layout) ??
      (isAutoPlaceable(moves, tileId) ? resolvePlayChoice(moves, tileId)?.end : null);
    if (autoEnd) {
      placeTile(tileId, autoEnd);
      return;
    }
    play("pickup");
    setSelectedId(tileId);
  };

  const stopDragTracking = useCallback(() => {
    dragTrackingStopRef.current?.();
    dragTrackingStopRef.current = null;
  }, []);

  const clearDragVisuals = useCallback(() => {
    stopDragTracking();
    const target = captureTargetRef.current;
    const pointerId = dragRef.current?.pointerId;
    dragRef.current = null;
    captureTargetRef.current = null;
    try {
      if (target && pointerId != null) target.releasePointerCapture?.(pointerId);
    } catch {
      /* already released */
    }
    setDrag(null);
    setHotEnd(null);
    setDragLock(false);
  }, [setDragLock, stopDragTracking]);

  const handleEndpointActivate = (end) => {
    if (!isHumanTurn || busy || !end) return;
    const tileId = selectedId || dragRef.current?.tileId;
    if (!tileId) return;
    const snap = viewRef.current;
    const moves = snap?.legalMoves ?? legalMoves;
    const chosen = resolvePlayChoice(moves, tileId, end);
    if (!chosen) {
      play("error");
      return;
    }
    skipClickRef.current = true;
    clearDragVisuals();
    void placeTile(tileId, end);
  };

  const bindDragPointerTracking = useCallback(
    (pointerId) => {
      stopDragTracking();
      const onMove = (event) => {
        if (pointerId != null && event.pointerId !== pointerId) return;
        event.preventDefault();
        setDrag((prev) =>
          prev ? { ...prev, x: event.clientX, y: event.clientY } : null
        );
        const current = dragRef.current;
        const snap = viewRef.current;
        if (!current || !snap) return;
        const layout = layoutFromView(snap);
        setHotEnd(
          pickTargetDestination(
            event.clientX,
            event.clientY,
            collectDestinationTargets(
              legalEndsForTile(snap.legalMoves, current.tileId),
              layout
            )
          )
        );
      };
      const onUp = (event) => {
        if (pointerId != null && event.pointerId !== pointerId) return;
        void dragFinishFnRef.current?.(event.clientX, event.clientY);
      };
      const onCancel = () => {
        skipClickRef.current = true;
        clearDragVisuals();
      };
      dragTrackingStopRef.current = attachCapturedPointerTracking(captureTargetRef.current, {
        onMove,
        onUp,
        onCancel,
      });
    },
    [clearDragVisuals, stopDragTracking, viewRef]
  );

  const handleTilePointerDown = (event, tileId) => {
    if (event.button != null && event.button !== 0) return;
    if (onlineDragGate({ isHumanTurn, busy, legalMoves: viewRef.current?.legalMoves ?? legalMoves, tileId }) !== "ok") {
      return;
    }
    const tile = humanHand.find((entry) => entry.id === tileId);
    if (!tile) return;

    const startDrag = (pointerEvent) => {
      const target = pointerEvent.currentTarget;
      if (!target) return;
      if (!pointerStillDown(pointerEvent) && pointerEvent.pointerType !== "touch") {
        return;
      }
      const rect = target.getBoundingClientRect();
      pointerEvent.preventDefault?.();
      try {
        target.setPointerCapture?.(pointerEvent.pointerId);
      } catch {
        /* some browsers reject capture */
      }
      captureTargetRef.current = target;
      const nextDrag = {
        tileId,
        left: tile.left,
        right: tile.right,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        w: rect.width,
        h: rect.height,
        pointerId: pointerEvent.pointerId,
        originX: pointerEvent.originX ?? pointerEvent.clientX,
        originY: pointerEvent.originY ?? pointerEvent.clientY,
      };
      dragRef.current = nextDrag;
      setDragLock(true);
      setDrag(nextDrag);
      bindDragPointerTracking(pointerEvent.pointerId);
      const buttons = Number(pointerEvent.buttons);
      const alreadyUp = Number.isFinite(buttons) && buttons === 0;
      const captureHeld =
        typeof target.hasPointerCapture !== "function" ||
        target.hasPointerCapture(pointerEvent.pointerId);
      if (!captureHeld && alreadyUp) {
        skipClickRef.current = true;
        clearDragVisuals();
      }
    };

    if (shouldDeferHandDrag(event)) {
      watchHandScrollOrDrag(event, { onDrag: startDrag });
      return;
    }
    startDrag(event);
  };

  const finishDrag = useCallback(
    async (clientX, clientY) => {
      const current = dragRef.current;
      if (!current) {
        clearDragVisuals();
        return;
      }
      const snap = viewRef.current;
      const moves = snap?.legalMoves ?? [];
      const layout = layoutFromView(snap);
      const legalEnds = legalEndsForTile(moves, current.tileId);
      const targets = collectDestinationTargets(legalEnds, layout);
      const end = pickTargetDestination(clientX, clientY, targets);
      const fromTravel = Math.hypot(
        clientX - (Number.isFinite(current.originX) ? current.originX : current.x),
        clientY - (Number.isFinite(current.originY) ? current.originY : current.y)
      );
      skipClickRef.current = true;
      clearDragVisuals();
      if (end) {
        await placeTile(current.tileId, end);
        return;
      }
      const equivalent = equivalentPlayEnd(moves, current.tileId, layout);
      const autoEnd = isAutoPlaceable(moves, current.tileId)
        ? resolvePlayChoice(moves, current.tileId)?.end
        : null;
      if (!hasUsableDomTargets(targets) && legalEnds.length) {
        const resolved = resolvePlayWithoutDomTargets({
          legalEnds,
          equivalent,
          autoEnd,
        });
        if (resolved.action === "place") {
          await placeTile(current.tileId, resolved.end);
          return;
        }
        if (resolved.action === "choose") {
          setSelectedId(current.tileId);
          return;
        }
        return;
      }
      if (
        equivalent &&
        (fromTravel <= DESTINATION_TAP_SLOP_PX ||
          pickTargetDestination(
            clientX,
            clientY,
            collectDestinationTargets([equivalent], layout)
          ))
      ) {
        await placeTile(current.tileId, equivalent);
        return;
      }
      if (fromTravel <= DESTINATION_TAP_SLOP_PX && isAutoPlaceable(moves, current.tileId)) {
        const move = resolvePlayChoice(moves, current.tileId);
        if (move) await placeTile(current.tileId, move.end);
      }
    },
    [clearDragVisuals, placeTile, viewRef]
  );
  dragFinishFnRef.current = finishDrag;

  const dragging = Boolean(drag?.tileId);
  useEffect(() => {
    setDragLock(dragging);
  }, [dragging, setDragLock]);

  useEffect(() => {
    if (!drag) {
      stopDragTracking();
      return undefined;
    }
    if (dragTrackingStopRef.current) return undefined;
    bindDragPointerTracking(drag.pointerId);
    return undefined;
  }, [bindDragPointerTracking, drag, stopDragTracking]);

  const handlePass = () => {
    if (!actions.canPass || busy) {
      play("error");
      return;
    }
    play("button");
    pass();
  };

  const handleDraw = () => {
    if (!actions.canDraw || busy) {
      play("error");
      return;
    }
    play("draw");
    draw();
  };

  const handleAdvance = () => {
    if (busy || !roundOver || matchOver) return;
    play("button");
    advanceRound();
  };

  const requestLeave = (intent = "home") => {
    play("button");
    if (matchOver) {
      void leave().then((ok) => {
        if (ok) onMainMenu?.();
      });
      return;
    }
    setAbandonIntent(intent === "new-match" ? "new-match" : "home");
  };

  const handleAbandonCancel = () => {
    if (leavingRef.current) return;
    play("button");
    setAbandonIntent(null);
  };

  const handleAbandonLeave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      play("button");
    } catch {
      /* audio must not block the authoritative forfeit */
    }
    void leave()
      .then((ok) => {
        if (!ok) return;
        setAbandonIntent(null);
      })
      .finally(() => {
        leavingRef.current = false;
        setLeaving(false);
      });
  };

  const interactionViewRef = useRef(view);
  useEffect(() => {
    const previous = interactionViewRef.current;
    interactionViewRef.current = view;
    if (!shouldClearLocalInteraction(previous, view)) return;
    skipClickRef.current = true;
    clearDragVisuals();
    setSelectedId(null);
  }, [clearDragVisuals, view]);

  const tableEpochRef = useRef(tableEpoch);
  useEffect(() => {
    if (tableEpochRef.current === tableEpoch) return;
    tableEpochRef.current = tableEpoch;
    skipClickRef.current = true;
    clearDragVisuals();
    setSelectedId(null);
    setPendingPlay(null);
  }, [clearDragVisuals, tableEpoch]);

  useEffect(() => {
    setRoundBanner(null);
    skipClickRef.current = true;
    clearDragVisuals();
    setSelectedId(null);
    setPendingPlay(null);
  }, [clearDragVisuals, matchId]);

  useEffect(() => {
    if (!pendingPlay?.tileId) return;
    if (pendingPlay.roundIdentity !== roundIdentity) {
      setPendingPlay(null);
      return;
    }
    if ((view?.board ?? []).some((tile) => tile.id === pendingPlay.tileId)) {
      setPendingPlay(null);
    }
  }, [view, pendingPlay, roundIdentity]);

  useEffect(() => {
    if (!roundOver || !view?.roundResult) return;
    if (isTimeoutView({ roundResult: view.roundResult })) return;
    const identity = `${view.matchId}:${view.round}:${view.version}`;
    setRoundBanner((prev) => {
      if (prev?.identity === identity) return prev;
      const winnerIndex = view.roundResult.winnerIndex;
      const tied = Boolean(view.roundResult.tied) || winnerIndex == null;
      return {
        identity,
        variant: "round",
        title: t("dialog.roundOver"),
        subtitle: tied
          ? t("rules.roundTied")
          : t("rules.roundWon", {
              name: winnerIndex === viewerSeat ? humanName : rivalName,
            }),
      };
    });
  }, [
    humanName,
    rivalName,
    roundOver,
    t,
    view?.matchId,
    view?.round,
    view?.roundResult,
    view?.version,
    viewerSeat,
  ]);

  useEffect(() => {
    const reason = view?.roundResult?.reason;
    if (reason !== "timeout_pass" && reason !== "timeout") return;
    const identity = `${view.matchId}:${view.version}:${reason}:${view.roundResult?.strike ?? ""}`;
    setRoundBanner((prev) => {
      if (prev?.identity === identity) return prev;
      if (reason === "timeout") {
        const humanWon = view.matchWinnerSeat === viewerSeat;
        return {
          identity,
          variant: "match",
          title: humanWon ? t("online.opponentLostTimeout") : t("online.youLostTimeout"),
        };
      }
      const n = Number(view.roundResult?.strike) || 1;
      return {
        identity,
        variant: "round",
        title: t("online.timeoutStrike", { n, limit: TIMEOUT_STRIKE_LIMIT }),
      };
    });
  }, [t, view?.matchId, view?.matchWinnerSeat, view?.roundResult, view?.version, viewerSeat]);

  useEffect(() => {
    if (!roundBanner?.identity) return undefined;
    const timer = window.setTimeout(() => setRoundBanner(null), 2200);
    return () => window.clearTimeout(timer);
  }, [roundBanner?.identity]);

  const ruleset = rulesetId ? resolveRuleset(rulesetId) : null;
  const style = gameStyleForRulesetId(rulesetId);
  const hudScoreFormat = ruleset?.hudScoreFormat ?? "absolute";
  const targetScore = ruleset?.targetScore;
  const americanHud = rulesetId === "american";
  const seatOfTarget = hudScoreFormat === "ofTarget" && !americanHud;
  const scores = view?.scores ?? [0, 0];
  const playerNames = viewerSeat === 0 ? [humanName, rivalName] : [rivalName, humanName];
  const displayNames = [humanName, rivalName];
  const humanScore = scores[viewerSeat] ?? 0;
  const rivalScore = scores[rivalSeat] ?? 0;
  const winnerSeat = view?.matchWinnerSeat;
  const humanWonMatch = winnerSeat === viewerSeat;
  const winnerName =
    winnerSeat == null ? "" : winnerSeat === viewerSeat ? humanName : rivalName;
  const humanStatus = (() => {
    if (matchOver) return t("rules.matchWon", { name: winnerName || t("game.rival") });
    if (roundOver) return t("dialog.roundOver");
    if (drag || needsEndChoice) return t("game.dragToEnd");
    if (isHumanTurn) {
      return (
        openingTurnStatus(t, { isTurn: true, mustPlayTileId }) ?? t("game.yourTurn")
      );
    }
    if (awaitingInteraction) return t("game.waiting");
    return t("online.opponentTurn", { name: rivalName });
  })();
  const tableStatus = (() => {
    if (serviceOutage) return t("online.serviceUnavailable");
    if (matchOver || roundOver || timerSeconds == null) return humanStatus;
    if (timerTone === "pending") return t("online.timeoutPending");
    return `${humanStatus} · ${timerSeconds}`;
  })();
  const rivalTurn = view?.currentSeat === rivalSeat && view?.phase === PHASE.PLAYING;
  const showReservePicker = isHumanTurn && actions.canDraw && !drag && !matchOver && !roundOver;
  const styleLabel = style ? t(style.nameKey) : "";

  if (status === "loading" || !view) {
    return (
      <div ref={pageRef} className="game-page game-page--v1 game-page--players-2" data-online-table="true">
        <div className="game-page__shell">
          <Header onMainMenu={requestLeave} compact showBrand={false} />
          <p className="game-table__status" data-online-status={status || "loading"}>
            {errorKey ? t(errorKey) : t("online.loading")}
          </p>
          {errorKey ? (
            <button type="button" className="btn btn--new" onClick={retry}>
              {t("findMatch.retry")}
            </button>
          ) : null}
        </div>
        <AbandonMatchDialog
          open={Boolean(abandonIntent)}
          intent={abandonIntent}
          busy={leaving}
          errorKey={leaveErrorKey}
          onLeave={handleAbandonLeave}
          onCancel={handleAbandonCancel}
        />
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className={`game-page game-page--v1 game-page--players-2${
        matchOver ? " game-page--match-over" : ""
      }`}
      data-online-table="true"
      data-online-outage={serviceOutage ? "true" : "false"}
      data-online-match-id={view.matchId}
      data-online-ruleset={rulesetId}
      data-online-version={view.version}
      data-opening-must-play={mustPlayTileId || undefined}
    >
      <div className="game-page__shell">
        <div className="game-page__chrome" {...(matchOver ? { inert: true } : {})}>
          <Header
            onMainMenu={requestLeave}
            compact
            showBrand={false}
            startBelow={
              <div
                className="game-page__hud-cluster game-page__hud-cluster--human"
                data-hud-zone="human"
              >
                <div className="game-page__seat-avatar" aria-label={humanName}>
                  <PlayerAvatar avatarId={humanAvatarId} size="lg" alt="" />
                </div>
                <div className="game-page__hud-id">
                  <span className="game-page__hud-name">{humanName}</span>
                  <SeatScore
                    value={humanScore}
                    name={humanName}
                    ofTarget={seatOfTarget}
                    target={targetScore}
                  />
                </div>
              </div>
            }
            centerBelow={
              <div className="game-page__hud-match" data-hud-zone="match-points">
                <ScoreBoard
                  scores={viewerSeat === 0 ? scores : [scores[1], scores[0]]}
                  names={displayNames}
                  humanIndex={0}
                  target={targetScore}
                  round={view.round}
                  hideSeatNames
                  metaOnly
                  hideRound={americanHud}
                  scoreFormat={hudScoreFormat}
                />
                <div className="game-page__hud-match-tags">
                  {styleLabel ? (
                    <p className="game-page__hud-tag" data-online-style={rulesetId}>
                      {styleLabel}
                    </p>
                  ) : null}
                  {rival?.playerId ? (
                    <div data-online-rival-friend={rival.playerId}>
                      <FriendButton
                        compact
                        relation={friends.relationFor(rival.playerId)}
                        busy={Boolean(friends.busy)}
                        onAdd={() => friends.sendTo(rival.playerId)}
                        onAccept={() => friends.accept(friends.incomingRequestId(rival.playerId))}
                        onDecline={() => friends.decline(friends.incomingRequestId(rival.playerId))}
                        onCancel={() => friends.cancel(friends.outgoingRequestId(rival.playerId))}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            }
            endBefore={
              <div
                className="game-page__hud-cluster game-page__hud-cluster--rival"
                data-hud-zone="rival"
              >
                <div className="game-page__hud-id game-page__hud-id--end">
                  <span className="game-page__hud-name">{rivalName}</span>
                  <SeatScore
                    value={rivalScore}
                    name={rivalName}
                    ofTarget={seatOfTarget}
                    target={targetScore}
                  />
                </div>
                <div className="game-page__seat-avatar" aria-label={rivalName}>
                  <PlayerAvatar avatarId={rivalAvatarId} size="lg" alt="" />
                </div>
              </div>
            }
          />
        </div>

        <div
          className="game-page__opponent-rail"
          data-opponent-rail
          {...(matchOver ? { inert: true } : {})}
        >
          <OpponentPanel
            name={rivalName}
            status={rivalTurn ? t("game.thinking") : t("game.waiting")}
            tileCount={view.handCounts?.[rivalSeat] ?? 0}
            thinking={rivalTurn}
            isTurn={rivalTurn}
            position="top"
            seatIndex={rivalSeat}
            avatarTone="rival"
            tilesOnly
            tileSize="md"
          />
        </div>

        {errorKey && !serviceOutage ? (
          <p className="game-table__status" data-online-error={errorKey}>
            {t(errorKey)}
          </p>
        ) : null}

        <div
          className="game-page__table"
          data-online-board-epoch={tableEpoch}
          data-online-round-identity={roundIdentity}
          {...(matchOver ? { inert: true } : {})}
        >
          <GameTable
            key={roundIdentity}
            tiles={boardTiles}
            centerTileId={spinnerId}
            spinnerId={spinnerId}
            spinnerNorth={spinnerNorth ?? []}
            spinnerSouth={spinnerSouth ?? []}
            targetTileId={targetTileId}
            playScore={view.lastPlayPoints > 0 ? view.lastPlayPoints : null}
            scoreHighlights={view.lastPlayScoreTerminals ?? []}
            playerNames={playerNames}
            status={tableStatus}
            statusActive={isHumanTurn}
            statusTone={matchOver || roundOver || serviceOutage ? "" : timerTone}
            openingTileId={mustPlayTileId}
            rulesetId={rulesetId}
            onEndpointActivate={isHumanTurn && !busy ? handleEndpointActivate : undefined}
            endpointHighlightByEnd={highlightLegalEnds.length ? highlightByEnd : null}
            dock={
              <div className="game-page__dock" data-hand-dock>
                <BottomBar
                  canPass={isHumanTurn && actions.canPass && !busy}
                  onPass={handlePass}
                  onNewGame={() => requestLeave("home")}
                >
                  <PlayerPanel
                    name={humanName}
                    status={humanStatus}
                    tiles={humanHand}
                    selectedId={selectedId}
                    onSelectTile={isHumanTurn ? handleTileSelect : undefined}
                    onTilePointerDown={isHumanTurn ? handleTilePointerDown : undefined}
                    draggingId={drag?.tileId ?? null}
                    hiddenIds={hiddenIds}
                    isTurn={isHumanTurn}
                    mustPlayTileId={mustPlayTileId}
                    legalMoves={actions.legalMoves}
                    tilesOnly
                  />
                </BottomBar>
              </div>
            }
          >
            {needsEndChoice && !drag ? (
              <div className="game-page__end-choice" data-end-choice="">
                {selectedLegalEnds.map((end) => (
                  <button
                    type="button"
                    key={end}
                    className="btn btn--new"
                    data-end-choice={end}
                    onClick={() => handleEndpointActivate(end)}
                  >
                    {t(endChoiceI18nKey(end))}
                  </button>
                ))}
              </div>
            ) : null}
            {showReservePicker ? (
              <ReservePicker
                tileIds={opaqueReserveIds(view.reserveCount)}
                onPick={handleDraw}
                disabled={busy}
              />
            ) : null}
            {roundOver && !matchOver ? (
              <button
                type="button"
                className="btn btn--new"
                data-online-advance="true"
                onClick={handleAdvance}
              >
                {t("rules.nextRound")}
              </button>
            ) : null}
          </GameTable>
        </div>
      </div>

      {drag ? (
        <DragGhost
          left={drag.left}
          right={drag.right}
          x={drag.x}
          y={drag.y}
          width={drag.w}
          height={drag.h}
        />
      ) : null}

      <GameBanner
        visible={Boolean(roundBanner)}
        variant={roundBanner?.variant}
        title={roundBanner?.title}
        subtitle={roundBanner?.subtitle}
      />

      <MatchOverModal
        open={matchOver}
        humanWon={humanWonMatch}
        winnerName={winnerName}
        scores={scores}
        roundsPlayed={view.round}
        title={
          isTimeoutMatchOver(view)
            ? humanWonMatch
              ? t("online.matchWonTimeout")
              : t("online.matchLostTimeout")
            : isForfeitView(view)
            ? humanWonMatch
              ? t("online.matchWonForfeit")
              : t("online.matchLostForfeit")
            : t("matchOver.title")
        }
        globalRp={matchRp}
        primaryActionLabel={t("findMatch.backHome")}
        onNewMatch={requestLeave}
        onMainMenu={requestLeave}
      />
      <AbandonMatchDialog
        open={Boolean(abandonIntent)}
        intent={abandonIntent}
        busy={leaving}
        errorKey={leaveErrorKey}
        onLeave={handleAbandonLeave}
        onCancel={handleAbandonCancel}
      />
    </div>
  );
}

export default OnlineGamePage;
