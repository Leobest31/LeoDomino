import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import Header from "../components/Header";
import GameTable from "../components/GameTable";
import PlayerPanel from "../components/PlayerPanel";
import ReservePicker from "../components/ReservePicker";
import ScoreBoard, { SeatScore } from "../components/ScoreBoard";
import BottomBar from "../components/BottomBar";
import FlyingDomino from "../components/FlyingDomino";
import DragGhost from "../components/DragGhost";
import GameBanner from "../components/GameBanner";
import MatchOverModal from "../components/MatchOverModal";
import AbandonMatchDialog from "../components/AbandonMatchDialog";
import {
  applyGameplayLayoutVars,
  gameplayDensityClass,
  measureSafeGameplayBox,
  resolveGameplayLayout,
} from "../ui/gameplayLayout.js";
import { useMatch } from "../hooks/useMatch";
import { useFlightDirector } from "../hooks/useFlightDirector";
import { usePrefs } from "../hooks/usePrefs.js";
import {
  PHASE,
  ROUND_END_REASON,
  getAvailableActions,
  isAutoPlaceable,
  legalEndsForTile,
  resolvePlayChoice,
  opponentFeltPosition,
  resolveRuleset,
} from "../game/index.js";
import {
  destinationHighlightMap,
  destinationTileId,
  pickTargetDestination,
  resolveDestinationOutward,
  DESTINATION_TAP_SLOP_PX,
} from "../game/destinationTarget.js";
import { MOTION, wait } from "../utils/motion.js";
import {
  hudScoresDuringHold,
  shouldShowPlayScorePopup,
} from "../game/rules/allFivesSpinner.js";
import {
  ROUND_SUMMARY_HOLD_MS,
  ROUND_SUMMARY_TILE_MS,
  hudScoresDuringRoundSummary,
  roundSummaryView,
  usesAllFivesRoundSummary,
} from "../game/rules/allFivesRoundSummary.js";
import { useAuth } from "../auth";
import PlayerAvatar from "../components/PlayerAvatar";
import Avatar from "../components/Avatar";
import OpponentPanel from "../components/OpponentPanel";
import "./GamePage.css";

function seatDisplayName(t) {
  return t("game.leoBest");
}

function collectDestinationTargets(legalEnds, layout) {
  if (!legalEnds?.length) return [];
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
      outward: resolveDestinationOutward(end, travelDir, { spinnerHub }),
    });
  }
  return targets;
}

function allTableTiles(board, north = [], south = []) {
  return [...board, ...north, ...south];
}

function useGameplayLayout(layoutOptions = {}) {
  const pageRef = useRef(null);
  const playerCount = Number(layoutOptions.playerCount) || 0;
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

/**
 * Match screen — natural auto-place, drag-when-both, sequential draw.
 * @param {{ onMainMenu?: () => void, matchOptions?: object }} props
 */
function GamePage({ onMainMenu, matchOptions = null }) {
  const { t } = useI18n();
  const { play } = useAudio();
  const { vibrate } = usePrefs();
  const { session } = useAuth();
  const humanName = String(session?.displayName || session?.username || "").trim();
  const humanAvatarId = session?.avatarId;
  const {
    state,
    stateRef,
    selectedId,
    actions,
    isHumanTurn,
    boardTiles,
    spinnerId,
    spinnerNorth,
    spinnerSouth,
    lastPlayPoints,
    lastPlayPointsSeat,
    lastPlayScoreTerminals,
    humanHand,
    thinkingSeat,
    matchDurationSeconds,
    selectTile,
    clearSelection,
    commitPlay,
    commitDraw,
    confirmAiDraw,
    clearPendingAiDraw,
    pendingAiDraw,
    pass,
    restart,
    abandonMatch,
    continueRound,
    setMotionLock,
    HUMAN_INDEX,
  } = useMatch(matchOptions ?? {});

  const pageRef = useGameplayLayout({
    playerCount: state.players.length,
    rulesetId: state.rulesetId,
  });
  const { flight, hiddenIds, runFlight, hideTile, showTile } = useFlightDirector();
  const [newestId, setNewestId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [hudScores, setHudScores] = useState(() => state.scores);
  const [tablePlayScore, setTablePlayScore] = useState(null);
  const [scoreHighlights, setScoreHighlights] = useState([]);
  const [playScoreHoldDone, setPlayScoreHoldDone] = useState(true);
  const scoreHoldGenRef = useRef(0);
  const scoreHoldActiveRef = useRef(false);
  const summaryGenRef = useRef(0);
  const summaryDoneRef = useRef("");
  const [summaryElapsedMs, setSummaryElapsedMs] = useState(0);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [hotEnd, setHotEnd] = useState(null);
  const tableStageRef = useRef(null);
  const prevBoardRef = useRef(boardTiles.map((tile) => tile.id));
  const prevPhaseRef = useRef(state.phase);
  const prevHandRef = useRef([]);
  const prevTurnRef = useRef(isHumanTurn);
  const prevHandCountsRef = useRef(state.players.map((player) => player.hand.length));
  const aiDrawKeyRef = useRef("");
  const hiddenIdsRef = useRef(hiddenIds);
  const dragRef = useRef(null);
  const drawingRef = useRef(false);
  const skipClickRef = useRef(false);
  hiddenIdsRef.current = hiddenIds;
  dragRef.current = drag;

  const needsEndChoice =
    Boolean(selectedId) &&
    !isAutoPlaceable(actions.legalMoves, selectedId) &&
    legalEndsForTile(actions.legalMoves, selectedId).length > 0;
  const dragLegalEnds = drag
    ? legalEndsForTile(
        getAvailableActions(stateRef.current).legalMoves,
        drag.tileId
      )
    : [];
  const destLayout = {
    board: boardTiles,
    spinnerId,
    spinnerNorth,
    spinnerSouth,
  };
  const highlightByEnd = destinationHighlightMap(dragLegalEnds, destLayout);
  const targetTileId = hotEnd ? highlightByEnd[hotEnd] ?? null : null;

  const placeTileOnBoard = useCallback(
    async (tileId, end, fromRect = null) => {
      const snap = stateRef.current;
      const handTile = snap.byId[tileId];
      if (!handTile) return false;
      const legalMoves = getAvailableActions(snap).legalMoves;
      const chosen = resolvePlayChoice(legalMoves, tileId, end);
      if (!chosen) {
        play("error");
        return false;
      }

      setMotionLock(true);
      clearSelection();
      const attachId = destinationTileId(chosen.end, {
        board: snap.board,
        spinnerId: snap.spinnerId,
        spinnerNorth: snap.spinnerNorth,
        spinnerSouth: snap.spinnerSouth,
      });
      await runFlight({
        tileId,
        left: handTile.a,
        right: handTile.b,
        faceDown: false,
        fromSelector: `[data-tile-id="${tileId}"]`,
        fromRect: fromRect || undefined,
        toSelector: `[data-board-tile="${tileId}"]`,
        toFallbackSelector: attachId ? `[data-board-tile="${attachId}"]` : undefined,
        startOrientation: "vertical",
        endOrientation: chosen.orientation,
        durationMs: MOTION.tileFlightMs,
        arcLiftPx: MOTION.playArcLiftPx,
        apply: () => {
          commitPlay(tileId, chosen.end);
        },
        onLanded: () => {
          setNewestId(tileId);
          showTile(tileId);
          play("place");
          vibrate(14);
        },
      });
      if (!scoreHoldActiveRef.current) setMotionLock(false);
      return true;
    },
    [clearSelection, commitPlay, play, runFlight, setMotionLock, showTile, stateRef, vibrate]
  );

  const finishDrag = useCallback(
    async (clientX, clientY) => {
      const current = dragRef.current;
      if (!current) return;

      const snap = stateRef.current;
      const legalMoves = getAvailableActions(snap).legalMoves;
      const legalEnds = legalEndsForTile(legalMoves, current.tileId);
      const end = pickTargetDestination(
        clientX,
        clientY,
        collectDestinationTargets(legalEnds, {
          board: snap.board,
          spinnerId: snap.spinnerId,
          spinnerNorth: snap.spinnerNorth,
          spinnerSouth: snap.spinnerSouth,
        })
      );
      const tileId = current.tileId;
      const fromRect = {
        x: current.x - current.w / 2,
        y: current.y - current.h / 2,
        w: current.w,
        h: current.h,
      };
      const originX = Number.isFinite(current.originX) ? current.originX : current.x;
      const originY = Number.isFinite(current.originY) ? current.originY : current.y;
      const travel = Math.hypot(clientX - originX, clientY - originY);

      setDrag(null);
      setHotEnd(null);
      skipClickRef.current = true;

      if (end) {
        hideTile(tileId);
        await placeTileOnBoard(tileId, end, fromRect);
        return;
      }

      // Tiny pointer travel is a tap. Unique legal destination (including a
      // single 0-end) must place the same way tap and drag agree.
      if (travel <= DESTINATION_TAP_SLOP_PX && isAutoPlaceable(legalMoves, tileId)) {
        const move = resolvePlayChoice(legalMoves, tileId);
        if (move) {
          hideTile(tileId);
          await placeTileOnBoard(tileId, move.end, fromRect);
          return;
        }
      }

      // Dropped elsewhere — glide back to the hand.
      play("pickup");
      setMotionLock(true);
      await runFlight({
        tileId,
        left: current.left,
        right: current.right,
        faceDown: false,
        fromSelector: `[data-tile-id="${tileId}"]`,
        fromRect,
        toSelector: `[data-tile-id="${tileId}"]`,
        startOrientation: "vertical",
        endOrientation: "vertical",
        durationMs: MOTION.snapMs,
        arcLiftPx: 4,
        skipHide: true,
        apply: () => {},
      });
      showTile(tileId);
      setMotionLock(false);
    },
    [hideTile, placeTileOnBoard, play, runFlight, setMotionLock, showTile, stateRef]
  );

  useEffect(() => {
    if (!drag) return undefined;

    const onMove = (event) => {
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              x: event.clientX,
              y: event.clientY,
            }
          : null
      );
      const current = dragRef.current;
      if (!current) return;
      const snap = stateRef.current;
      const legalEnds = legalEndsForTile(
        getAvailableActions(snap).legalMoves,
        current.tileId
      );
      setHotEnd(
        pickTargetDestination(
          event.clientX,
          event.clientY,
          collectDestinationTargets(legalEnds, {
            board: snap.board,
            spinnerId: snap.spinnerId,
            spinnerNorth: snap.spinnerNorth,
            spinnerSouth: snap.spinnerSouth,
          })
        )
      );
    };

    const onUp = (event) => {
      void finishDrag(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, finishDrag, stateRef]);

  useEffect(() => {
    const pts = Number(lastPlayPoints) || 0;
    const showPlayScore = shouldShowPlayScorePopup(pts);
    if (!showPlayScore) {
      scoreHoldActiveRef.current = false;
      setPlayScoreHoldDone(true);
      setTablePlayScore(null);
      setScoreHighlights([]);
      if (state.phase !== PHASE.ROUND_OVER || !state.roundResult?.summary) {
        setHudScores(state.scores);
      }
      return undefined;
    }
    const gen = ++scoreHoldGenRef.current;
    scoreHoldActiveRef.current = true;
    setPlayScoreHoldDone(false);
    const roundPts = Number(state.roundResult?.points) || 0;
    const roundWinners = Array.isArray(state.roundResult?.winnerIndices)
      ? state.roundResult.winnerIndices
      : state.roundResult?.winnerIndex != null
        ? [state.roundResult.winnerIndex]
        : [];
    setHudScores(
      hudScoresDuringHold({
        scores: hudScoresDuringRoundSummary({
          scores: state.scores,
          winnerIndex: state.roundResult?.winnerIndex,
          winnerIndices: roundWinners,
          points: roundPts,
          hudLag: Boolean(state.roundResult?.summary),
        }),
        lastPlayPoints: pts,
        lastPlayPointsSeat,
        holdElapsedMs: 0,
        holdMs: MOTION.playScoreHoldMs,
      })
    );
    setTablePlayScore(pts);
    setScoreHighlights(Array.isArray(lastPlayScoreTerminals) ? lastPlayScoreTerminals : []);
    setMotionLock(true);
    const timer = window.setTimeout(() => {
      if (scoreHoldGenRef.current !== gen) return;
      scoreHoldActiveRef.current = false;
      setTablePlayScore(null);
      setScoreHighlights([]);
      setPlayScoreHoldDone(true);
      if (!state.roundResult?.summary) {
        setHudScores(state.scores);
        setMotionLock(false);
      }
    }, MOTION.playScoreHoldMs);
    return () => window.clearTimeout(timer);
  }, [
    lastPlayPoints,
    lastPlayPointsSeat,
    lastPlayScoreTerminals,
    setMotionLock,
    state.scores,
    state.phase,
    state.roundResult,
  ]);

  const summaryActive =
    usesAllFivesRoundSummary(state) &&
    (!shouldShowPlayScorePopup(Number(lastPlayPoints) || 0) || playScoreHoldDone);
  const summaryExplanation = summaryActive
    ? {
        winnerIndex: state.roundResult.winnerIndex,
        winnerIndices: Array.isArray(state.roundResult.winnerIndices)
          ? state.roundResult.winnerIndices
          : state.roundResult.winnerIndex != null
            ? [state.roundResult.winnerIndex]
            : [],
        awarded: Number(state.roundResult.points) || 0,
        rawTotal: Number(state.roundResult.rawPips) || 0,
        hands: Array.isArray(state.roundResult.hands) ? state.roundResult.hands : [],
      }
    : null;
  const summaryView = summaryExplanation
    ? roundSummaryView(summaryExplanation, summaryElapsedMs, {
        tileMs: MOTION.roundSummaryTileMs || ROUND_SUMMARY_TILE_MS,
        holdMs: MOTION.roundSummaryHoldMs || ROUND_SUMMARY_HOLD_MS,
      })
    : null;

  useEffect(() => {
    if (!summaryActive) {
      setSummaryElapsedMs(0);
      return undefined;
    }
    const gen = ++summaryGenRef.current;
    setMotionLock(true);
    setHudScores(
      hudScoresDuringRoundSummary({
        scores: state.scores,
        winnerIndex: state.roundResult.winnerIndex,
        winnerIndices: state.roundResult.winnerIndices,
        points: state.roundResult.points,
        hudLag: true,
      })
    );
    const started = performance.now();
    let raf = 0;
    const tick = (now) => {
      if (summaryGenRef.current !== gen) return;
      setSummaryElapsedMs(now - started);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    summaryActive,
    setMotionLock,
    state.seed,
    state.round,
    state.roundResult?.winnerIndex,
    state.roundResult?.winnerIndices,
    state.roundResult?.points,
    state.scores,
  ]);

  useEffect(() => {
    if (!summaryView?.done || !summaryActive) return undefined;
    const key = `${state.seed}:r${state.round}:${(state.roundResult?.winnerIndices || [state.roundResult?.winnerIndex]).join(",")}:${state.roundResult?.points}`;
    if (summaryDoneRef.current === key) return undefined;
    summaryDoneRef.current = key;
    summaryGenRef.current += 1;
    setHudScores(state.scores);
    setMotionLock(false);
    continueRound();
    return undefined;
  }, [
    summaryView?.done,
    summaryActive,
    continueRound,
    setMotionLock,
    state.scores,
    state.seed,
    state.round,
    state.roundResult,
  ]);

  const handleTileSelect = async (tileId) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    if (!isHumanTurn || drag) return;

    const legalMoves = actions.legalMoves;
    const ends = legalEndsForTile(legalMoves, tileId);

    if (!ends.length) {
      play("error");
      vibrate([8, 40, 8]);
      return;
    }

    play("pickup");

    if (isAutoPlaceable(legalMoves, tileId)) {
      const move = resolvePlayChoice(legalMoves, tileId);
      if (move) await placeTileOnBoard(tileId, move.end);
      return;
    }

    selectTile(tileId);
  };

  const handleTilePointerDown = (event, tileId) => {
    if (!isHumanTurn) return;
    if (event.button != null && event.button !== 0) return;
    const ends = legalEndsForTile(actions.legalMoves, tileId);
    if (!ends.length) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const tile = humanHand.find((entry) => entry.id === tileId);
    if (!tile) return;

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore capture failures on some browsers.
    }

    hideTile(tileId);
    setDrag({
      tileId,
      left: tile.left,
      right: tile.right,
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      w: rect.width,
      h: rect.height,
    });
    const snap = stateRef.current;
    setHotEnd(
      pickTargetDestination(
        event.clientX,
        event.clientY,
        collectDestinationTargets(ends, {
          board: snap.board,
          spinnerId: snap.spinnerId,
          spinnerNorth: snap.spinnerNorth,
          spinnerSouth: snap.spinnerSouth,
        })
      )
    );
  };

  const handleReservePick = useCallback(
    (tileId) => {
      if (!isHumanTurn || drawingRef.current) return;
      const snap = stateRef.current;
      if (!getAvailableActions(snap).canDraw) return;
      if (!snap.reserve.includes(tileId)) return;
      play("draw");
      commitDraw(tileId);
      play("pickup");
    },
    [commitDraw, isHumanTurn, play, stateRef]
  );

  // AI / opponent board additions — fly from that seat's hand area to the
  // exact laid-out destination. Face is revealed only on this played flight;
  // opponent hand tiles stay face-down.
  const boardSignature = allTableTiles(
    state.board,
    spinnerNorth,
    spinnerSouth
  )
    .map((tile) => tile.id)
    .join("|");
  const handCountsSignature = state.players.map((player) => player.hand.length).join("|");

  useLayoutEffect(() => {
    const prev = prevBoardRef.current;
    const prevCounts = prevHandCountsRef.current;
    const nextIds = allTableTiles(state.board, spinnerNorth, spinnerSouth).map(
      (tile) => tile.id
    );
    const nextCounts = state.players.map((player) => player.hand.length);
    const added = nextIds.filter((id) => !prev.includes(id));
    prevBoardRef.current = nextIds;

    if (!added.length) return undefined;

    // Sync hand baselines only when a board tile was added (AI/human play).
    prevHandCountsRef.current = nextCounts;

    const tileId = added[added.length - 1];
    const fromSeat = nextCounts.findIndex(
      (count, index) => index !== HUMAN_INDEX && count < (prevCounts[index] ?? count)
    );
    // Human plays already animate via placeTileOnBoard.
    if (fromSeat < 0) {
      return undefined;
    }

    const placed =
      state.board.find((tile) => tile.id === tileId) ||
      spinnerNorth.find((tile) => tile.id === tileId) ||
      spinnerSouth.find((tile) => tile.id === tileId);
    if (!placed) return undefined;

    const fromSelector = `[data-opponent-origin][data-seat-index="${fromSeat}"]`;
    const attachId =
      destinationTileId(placed.destination || placed.branch, {
        board: state.board,
        spinnerId: state.spinnerId,
        spinnerNorth,
        spinnerSouth,
      }) ||
      (state.board[0]?.id === tileId
        ? state.board[1]?.id
        : state.board[state.board.length - 1]?.id === tileId
          ? state.board[state.board.length - 2]?.id
          : state.spinnerId);

    hideTile(tileId);
    let launched = false;
    const timer = window.setTimeout(() => {
      launched = true;
      setMotionLock(true);
      runFlight({
        tileId,
        left: placed.left,
        right: placed.right,
        faceDown: false,
        fromSelector,
        toSelector: `[data-board-tile="${tileId}"]`,
        toFallbackSelector: attachId ? `[data-board-tile="${attachId}"]` : undefined,
        startOrientation: "vertical",
        endOrientation: placed.orientation || "horizontal",
        durationMs: MOTION.tileFlightMs,
        arcLiftPx: MOTION.playArcLiftPx,
        skipHide: true,
        onLanded: () => {
          setNewestId(tileId);
          play("place");
          showTile(tileId);
        },
      }).finally(() => {
        showTile(tileId);
        if (!scoreHoldActiveRef.current) setMotionLock(false);
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      // React Strict Mode re-runs this effect in DEV. If the flight never
      // launched, the played tile must not stay hidden.
      if (!launched) showTile(tileId);
    };
  }, [boardSignature, handCountsSignature, HUMAN_INDEX, hideTile, play, runFlight, setMotionLock, showTile, spinnerNorth, spinnerSouth, state.board, state.players, state.spinnerId]);

  // Keep an in-flight board tile hidden until the hand-to-slot animation lands.
  useEffect(() => {
    if (!flight?.tileId) return;
    hideTile(flight.tileId);
  }, [boardSignature, flight?.tileId, hideTile]);

  // AI draws: show the real reserve tile face-down, then fly it to LeoBest.
  useEffect(() => {
    if (!pendingAiDraw) {
      aiDrawKeyRef.current = "";
      return undefined;
    }
    const key = `${pendingAiDraw.seat}:${pendingAiDraw.tileId}:${pendingAiDraw.tileIds.length}`;
    if (aiDrawKeyRef.current === key) return undefined;
    aiDrawKeyRef.current = key;

    let cancelled = false;
    let applied = false;
    setMotionLock(true);

    const run = async () => {
      await wait(MOTION.aiDrawRevealMs);
      if (cancelled) return;
      await runFlight({
        tileId: pendingAiDraw.tileId,
        left: 0,
        right: 0,
        faceDown: true,
        fromSelector: `[data-reserve-pick="${pendingAiDraw.tileId}"]`,
        toSelector: `[data-opponent-origin][data-seat-index="${pendingAiDraw.seat}"] [data-opponent-top-tile="true"]`,
        toFallbackSelector: `[data-opponent-origin][data-seat-index="${pendingAiDraw.seat}"]`,
        startOrientation: "vertical",
        endOrientation: "vertical",
        durationMs: MOTION.aiDrawFlightMs,
        arcLiftPx: MOTION.aiDrawArcLiftPx,
        skipHide: true,
        apply: () => {},
        onLanded: () => {
          play("draw");
          if (!applied) {
            applied = true;
            confirmAiDraw(pendingAiDraw.tileId);
          }
        },
      });
      if (cancelled) return;
      if (!applied) {
        applied = true;
        confirmAiDraw(pendingAiDraw.tileId);
      }
      clearPendingAiDraw();
      setMotionLock(false);
    };

    const timer = window.setTimeout(() => {
      run();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (!applied) aiDrawKeyRef.current = "";
    };
  }, [clearPendingAiDraw, confirmAiDraw, pendingAiDraw, play, runFlight, setMotionLock]);

  useLayoutEffect(() => {
    const prev = new Set(prevHandRef.current);
    const nextIds = humanHand.map((tile) => tile.id);
    const fresh = nextIds.filter((id) => !prev.has(id));
    prevHandRef.current = nextIds;

    if (!fresh.length) return undefined;

    setEnteringIds((current) => {
      const next = new Set(current);
      for (const id of fresh) next.add(id);
      return next;
    });

    const timer = window.setTimeout(() => {
      setEnteringIds((current) => {
        const next = new Set(current);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, MOTION.handFlipMs + 80);

    return () => window.clearTimeout(timer);
  }, [humanHand]);

  useEffect(() => {
    const wasHuman = prevTurnRef.current;
    prevTurnRef.current = isHumanTurn;
    if (!wasHuman && isHumanTurn && state.phase === PHASE.PLAYING) {
      play("turn");
    }
  }, [isHumanTurn, play, state.phase]);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (prev === state.phase) return undefined;

    if (state.phase === PHASE.ROUND_OVER && state.roundResult) {
      if (state.roundResult.summary) return undefined;
      const winnerIndex = state.roundResult.winnerIndex;
      const tied = Boolean(state.roundResult.tied) || winnerIndex == null;
      if (tied) {
        play("defeat");
        vibrate(30);
        setBanner({
          variant: "round",
          title: t("dialog.roundOver"),
          subtitle: t("rules.roundTied"),
        });
        const timer = window.setTimeout(() => setBanner(null), MOTION.bannerMs);
        return () => window.clearTimeout(timer);
      }
      const humanWon = winnerIndex === HUMAN_INDEX;
      play(humanWon ? "roundWin" : "defeat");
      if (humanWon) vibrate([12, 30, 12]);
      else vibrate(30);
      const winnerName = humanWon
        ? humanName
        : seatDisplayName(t);
      const pointsLabel =
        state.roundResult.reason === ROUND_END_REASON.DEKABES
          ? t("rules.dekabesAwarded", { points: state.roundResult.points })
          : t("rules.pointsAwarded", { points: state.roundResult.points });
      setBanner({
        variant: "round",
        title:
          state.roundResult.reason === ROUND_END_REASON.DEKABES
            ? t("rules.dekabes")
            : t("dialog.roundOver"),
        subtitle: `${winnerName} · ${pointsLabel}`,
      });
      const timer = window.setTimeout(() => setBanner(null), MOTION.bannerMs);
      return () => window.clearTimeout(timer);
    }

    if (state.phase === PHASE.MATCH_OVER) {
      const humanWon = state.matchWinner === HUMAN_INDEX;
      play(humanWon ? "matchWin" : "defeat");
      if (humanWon) vibrate([16, 40, 16, 40, 24]);
      else vibrate(40);
      // Official Match Over modal owns this moment — no transient banner.
      setBanner(null);
      return undefined;
    }

    return undefined;
  }, [HUMAN_INDEX, humanName, play, state.matchWinner, state.phase, state.players.length, state.roundResult, t, vibrate]);

  const celebrating = Boolean(banner);
  const matchOver = state.phase === PHASE.MATCH_OVER;
  const humanWonMatch = state.matchWinner === HUMAN_INDEX;
  const playerNames = state.players.map((_, index) => {
    if (index === HUMAN_INDEX) return humanName;
    return seatDisplayName(t);
  });
  const displayScores = summaryView
    ? hudScoresDuringRoundSummary({
        scores: state.scores,
        winnerIndex: summaryView.winnerIndex,
        winnerIndices: state.roundResult?.winnerIndices,
        points: summaryView.awarded,
        hudLag: summaryView.hudLag,
      })
    : hudScores;
  const winnerName =
    state.matchWinner == null
      ? ""
      : playerNames[state.matchWinner] ?? t("game.rival");

  const humanStatus = (() => {
    if (matchOver) {
      return t("rules.matchWon", { name: winnerName || t("game.rival") });
    }
    if (state.phase === PHASE.ROUND_OVER) return t("dialog.roundOver");
    if (pendingAiDraw) return t("game.leoBestDrawing");
    if (drag || needsEndChoice) return t("game.dragToEnd");
    if (isHumanTurn) return t("game.yourTurn");
    return t("game.waiting");
  })();

  // Seat layout for every non-human player (2 / 3 / 4 player tables).
  const opponentSeats = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => index !== HUMAN_INDEX)
    .map(({ player, index }) => {
      const position = opponentFeltPosition(index, state.players.length) ?? "top";
      const thinking = thinkingSeat === index;
      const drawing = pendingAiDraw?.seat === index;
      const isTurn = state.currentPlayer === index && state.phase === PHASE.PLAYING;
      return {
        index,
        position,
        name: seatDisplayName(t),
        status: drawing
          ? t("game.leoBestDrawing")
          : thinking || isTurn
            ? t("game.thinking")
            : t("game.waiting"),
        tileCount: player.hand.length,
        thinking: thinking || drawing,
        isTurn,
      };
    });
  const handleNewMatch = () => {
    play("button");
    restart();
  };

  const handleMainMenu = () => {
    play("button");
    onMainMenu?.();
  };

  const handleHomeTap = () => {
    play("button");
    setAbandonOpen(true);
  };

  const handleAbandonCancel = () => {
    play("button");
    setAbandonOpen(false);
  };

  const handleAbandonLeave = () => {
    play("button");
    setAbandonOpen(false);
    abandonMatch();
    onMainMenu?.();
  };

  const hudScoreFormat = resolveRuleset(state.rulesetId).hudScoreFormat ?? "absolute";
  const vsHud = state.players.length === 2;
  const ofTargetHud = hudScoreFormat === "ofTarget";

  const showReservePicker =
    Boolean(pendingAiDraw) ||
    (isHumanTurn && actions.canDraw && !drag && !matchOver && !summaryActive);

  return (
    <div
      ref={pageRef}
      className={`game-page game-page--v1 game-page--players-${state.players.length}${
        celebrating ? " game-page--celebrate" : ""
      }${matchOver ? " game-page--match-over" : ""}${
        summaryActive ? " game-page--round-summary" : ""
      }`}
    >
      <div className="game-page__shell">
        <div className="game-page__chrome" {...(matchOver ? { inert: true } : {})}>
          <Header
            onMainMenu={handleHomeTap}
            compact
            showBrand={false}
            startBelow={
              <div className="game-page__hud-cluster game-page__hud-cluster--human">
                <div className="game-page__seat-avatar" aria-label={humanName}>
                  <PlayerAvatar avatarId={humanAvatarId} size="lg" alt="" />
                </div>
                <div className="game-page__hud-id">
                  <span className="game-page__hud-name">{humanName}</span>
                  {vsHud ? (
                    <SeatScore
                      value={displayScores[HUMAN_INDEX] ?? 0}
                      name={humanName}
                      ofTarget={ofTargetHud}
                      target={state.targetScore}
                    />
                  ) : null}
                </div>
              </div>
            }
            centerBelow={
              <ScoreBoard
                scores={displayScores}
                names={playerNames}
                humanIndex={HUMAN_INDEX}
                target={state.targetScore}
                round={state.round}
                hideSeatNames
                metaOnly={vsHud}
                scoreFormat={hudScoreFormat}
              />
            }
            endBefore={
              <div className="game-page__hud-cluster game-page__hud-cluster--rival">
                <div className="game-page__hud-id game-page__hud-id--end">
                  <span className="game-page__hud-name">{t("game.leoBest")}</span>
                  {vsHud ? (
                    <SeatScore
                      value={displayScores[opponentSeats[0]?.index ?? 1] ?? 0}
                      name={t("game.leoBest")}
                      ofTarget={ofTargetHud}
                      target={state.targetScore}
                    />
                  ) : null}
                </div>
                <div className="game-page__seat-avatar" aria-label={t("game.leoBest")}>
                  <Avatar label={t("game.leoBest")} tone="leoBest" size="lg" />
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
          {opponentSeats[0] ? (
            <OpponentPanel
              name={opponentSeats[0].name}
              status={opponentSeats[0].status}
              tileCount={opponentSeats[0].tileCount}
              thinking={opponentSeats[0].thinking}
              isTurn={opponentSeats[0].isTurn}
              position="top"
              seatIndex={opponentSeats[0].index}
              avatarTone="leoBest"
              tilesOnly
              tileSize="md"
            />
          ) : null}
        </div>

        <div className="game-page__table" ref={tableStageRef} {...(matchOver ? { inert: true } : {})}>
          <GameTable
            tiles={boardTiles}
            newestId={newestId}
            centerTileId={spinnerId}
            spinnerId={spinnerId}
            spinnerNorth={spinnerNorth}
            spinnerSouth={spinnerSouth}
            targetTileId={targetTileId}
            playScore={tablePlayScore}
            scoreHighlights={scoreHighlights}
            roundSummary={summaryView && !summaryView.done ? summaryView : null}
            playerNames={playerNames}
            status={humanStatus}
            statusActive={isHumanTurn}
            hiddenIds={hiddenIds}
            dock={
              <div
                className="game-page__dock"
                data-hand-dock
                {...(matchOver ? { inert: true } : {})}
              >
                <BottomBar
                  canPass={isHumanTurn && actions.canPass}
                  onPass={pass}
                  onNewGame={restart}
                >
                  <PlayerPanel
                    name={humanName}
                    status={humanStatus}
                    tiles={humanHand}
                    selectedId={selectedId}
                    onSelectTile={isHumanTurn ? handleTileSelect : undefined}
                    onTilePointerDown={isHumanTurn ? handleTilePointerDown : undefined}
                    draggingId={drag?.tileId ?? null}
                    isTurn={isHumanTurn}
                    hiddenIds={hiddenIds}
                    enteringIds={enteringIds}
                    tilesOnly
                  />
                </BottomBar>
              </div>
            }
          >
            {showReservePicker ? (
              <ReservePicker
                tileIds={pendingAiDraw?.tileIds ?? state.reserve}
                onPick={handleReservePick}
                disabled={!isHumanTurn || Boolean(pendingAiDraw)}
                watch={Boolean(pendingAiDraw)}
                highlightedId={pendingAiDraw?.tileId ?? null}
                hiddenId={
                  pendingAiDraw && flight?.tileId === pendingAiDraw.tileId
                    ? pendingAiDraw.tileId
                    : null
                }
              />
            ) : null}
          </GameTable>
        </div>
      </div>

      {flight ? (
        <FlyingDomino
          left={flight.left}
          right={flight.right}
          faceDown={flight.faceDown}
          from={flight.from}
          to={flight.to}
          startOrientation={flight.startOrientation}
          endOrientation={flight.endOrientation}
          durationMs={flight.durationMs}
          arcLiftPx={flight.arcLiftPx}
          onComplete={flight.onComplete}
        />
      ) : null}

      {drag ? (
        <DragGhost
          left={drag.left}
          right={drag.right}
          x={drag.x}
          y={drag.y}
        />
      ) : null}

      <GameBanner
        visible={Boolean(banner)}
        variant={banner?.variant}
        title={banner?.title}
        subtitle={banner?.subtitle}
      />

      <AbandonMatchDialog
        open={abandonOpen}
        onLeave={handleAbandonLeave}
        onCancel={handleAbandonCancel}
      />

      <MatchOverModal
        open={matchOver}
        humanWon={humanWonMatch}
        winnerName={winnerName}
        scores={state.scores}
        roundsPlayed={state.round}
        durationSeconds={matchDurationSeconds}
        onNewMatch={handleNewMatch}
        onMainMenu={handleMainMenu}
      />
    </div>
  );
}

export default GamePage;
