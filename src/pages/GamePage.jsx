import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import Header from "../components/Header";
import OpponentPanel from "../components/OpponentPanel";
import GameTable from "../components/GameTable";
import PlayerPanel from "../components/PlayerPanel";
import Reserve from "../components/Reserve";
import ScoreBoard from "../components/ScoreBoard";
import BottomBar from "../components/BottomBar";
import FlyingDomino from "../components/FlyingDomino";
import DragGhost from "../components/DragGhost";
import GameBanner from "../components/GameBanner";
import { useMatch } from "../hooks/useMatch";
import { useFlightDirector } from "../hooks/useFlightDirector";
import { usePrefs } from "../hooks/usePrefs.js";
import {
  PHASE,
  getAvailableActions,
  isAmbiguousPlacement,
  isAutoPlaceable,
  legalEndsForTile,
  resolvePlayChoice,
} from "../game/index.js";
import { MOTION, wait } from "../utils/motion.js";
import "./GamePage.css";

function hitDropEnd(clientX, clientY) {
  const zones = document.querySelectorAll("[data-drop-end]");
  for (const el of zones) {
    const rect = el.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return el.getAttribute("data-drop-end");
    }
  }
  return null;
}

/**
 * Match screen — natural auto-place, drag-when-both, sequential draw.
 */
function GamePage() {
  const { t } = useI18n();
  const { play } = useAudio();
  const { vibrate } = usePrefs();
  const {
    state,
    stateRef,
    selectedId,
    actions,
    isHumanTurn,
    aiThinking,
    difficulty,
    setDifficulty,
    boardTiles,
    humanHand,
    opponentCount,
    selectTile,
    clearSelection,
    commitPlay,
    commitDraw,
    pass,
    restart,
    setMotionLock,
    HUMAN_INDEX,
    OPPONENT_INDEX,
  } = useMatch();

  const { flight, hiddenIds, runFlight, hideTile, showTile } = useFlightDirector();
  const [newestId, setNewestId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [hotEnd, setHotEnd] = useState(null);
  const prevBoardRef = useRef(boardTiles.map((tile) => tile.id));
  const prevPhaseRef = useRef(state.phase);
  const prevHandRef = useRef([]);
  const prevTurnRef = useRef(isHumanTurn);
  const prevReserveRef = useRef(state.reserve.length);
  const prevOppCountRef = useRef(opponentCount);
  const hiddenIdsRef = useRef(hiddenIds);
  const dragRef = useRef(null);
  const drawingRef = useRef(false);
  const skipClickRef = useRef(false);
  const autoDrawKeyRef = useRef("");
  hiddenIdsRef.current = hiddenIds;
  dragRef.current = drag;

  const ambiguousSelected =
    Boolean(selectedId) && isAmbiguousPlacement(actions.legalMoves, selectedId);
  const dragValidEnds = drag
    ? legalEndsForTile(
        getAvailableActions(stateRef.current).legalMoves,
        drag.tileId
      )
    : ambiguousSelected
      ? legalEndsForTile(actions.legalMoves, selectedId)
      : null;

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
      await runFlight({
        tileId,
        left: handTile.a,
        right: handTile.b,
        faceDown: false,
        fromSelector: `[data-tile-id="${tileId}"]`,
        fromRect: fromRect || undefined,
        toSelector: `[data-board-tile="${tileId}"]`,
        startOrientation: "vertical",
        endOrientation: chosen.orientation,
        durationMs: MOTION.tileFlightMs,
        arcLiftPx: MOTION.playArcLiftPx,
        skipHide: Boolean(fromRect),
        apply: () => {
          commitPlay(tileId, chosen.end);
        },
        onLanded: () => {
          setNewestId(tileId);
          play("place");
          vibrate(14);
        },
      });
      setMotionLock(false);
      return true;
    },
    [clearSelection, commitPlay, play, runFlight, setMotionLock, stateRef, vibrate]
  );

  const finishDrag = useCallback(
    async (clientX, clientY) => {
      const current = dragRef.current;
      if (!current) return;

      const end = hitDropEnd(clientX, clientY);
      const tileId = current.tileId;
      const fromRect = {
        x: current.x - current.w / 2,
        y: current.y - current.h / 2,
        w: current.w,
        h: current.h,
      };

      setDrag(null);
      setHotEnd(null);
      skipClickRef.current = true;

      if (end === "left" || end === "right") {
        hideTile(tileId);
        await placeTileOnBoard(tileId, end, fromRect);
        return;
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
    [hideTile, placeTileOnBoard, play, runFlight, setMotionLock, showTile]
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
      setHotEnd(hitDropEnd(event.clientX, event.clientY));
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
  }, [drag, finishDrag]);

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
    if (!isHumanTurn || !selectedId || selectedId !== tileId) return;
    if (!isAmbiguousPlacement(actions.legalMoves, tileId)) return;
    if (event.button != null && event.button !== 0) return;

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
      w: rect.width,
      h: rect.height,
    });
    setHotEnd(hitDropEnd(event.clientX, event.clientY));
  };

  const runDrawSequence = useCallback(async () => {
    if (drawingRef.current) return;
    drawingRef.current = true;
    setMotionLock(true);

    try {
      while (getAvailableActions(stateRef.current).canDraw) {
        const snap = stateRef.current;
        const drawnId = snap.reserve[0];
        if (!drawnId) break;
        const tile = snap.byId[drawnId];

        play("draw");
        await runFlight({
          tileId: drawnId,
          left: tile.a,
          right: tile.b,
          faceDown: true,
          fromSelector: '[data-reserve-top="true"]',
          toSelector: `[data-tile-id="${drawnId}"]`,
          startOrientation: "vertical",
          endOrientation: "vertical",
          durationMs: MOTION.drawFlightMs,
          arcLiftPx: MOTION.drawArcLiftPx,
          apply: () => {
            commitDraw();
          },
        });

        await wait(40);

        const after = stateRef.current;
        const legalMoves = getAvailableActions(after).legalMoves;
        const ends = legalEndsForTile(legalMoves, drawnId);

        if (ends.length === 1) {
          const move = resolvePlayChoice(legalMoves, drawnId);
          if (move) await placeTileOnBoard(drawnId, move.end);
          break;
        }

        if (ends.length > 1) {
          selectTile(drawnId);
          play("pickup");
          break;
        }
      }
    } finally {
      drawingRef.current = false;
      setMotionLock(false);
    }
  }, [
    commitDraw,
    placeTileOnBoard,
    play,
    runFlight,
    selectTile,
    setMotionLock,
    stateRef,
  ]);

  const handleDraw = async () => {
    if (!getAvailableActions(stateRef.current).canDraw) {
      play("error");
      return;
    }
    await runDrawSequence();
  };

  const handlePlay = async () => {
    if (!selectedId || !isAutoPlaceable(actions.legalMoves, selectedId)) {
      play("error");
      return;
    }
    const move = resolvePlayChoice(actions.legalMoves, selectedId);
    if (!move) {
      play("error");
      return;
    }
    await placeTileOnBoard(selectedId, move.end);
  };

  // Auto-start sequential draw when the human begins a turn with no legal play.
  useEffect(() => {
    if (!isHumanTurn || !actions.canDraw || drag) return;
    const key = `${state.round}:${state.board.map((tile) => tile.id).join(",")}:${state.reserve.length}`;
    if (autoDrawKeyRef.current === key) return;
    autoDrawKeyRef.current = key;
    void runDrawSequence();
  }, [
    actions.canDraw,
    drag,
    isHumanTurn,
    runDrawSequence,
    state.board,
    state.round,
    state.reserve.length,
  ]);

  useLayoutEffect(() => {
    const prev = prevBoardRef.current;
    const nextIds = boardTiles.map((tile) => tile.id);
    const added = nextIds.filter((id) => !prev.includes(id));
    prevBoardRef.current = nextIds;

    if (!added.length) return undefined;

    const tileId = added[added.length - 1];
    if (hiddenIdsRef.current.has(tileId)) return undefined;

    const placed = boardTiles.find((tile) => tile.id === tileId);
    if (!placed) return undefined;

    hideTile(tileId);

    const timer = window.setTimeout(() => {
      setMotionLock(true);
      runFlight({
        tileId,
        left: placed.left,
        right: placed.right,
        faceDown: false,
        fromSelector: "[data-opponent-origin]",
        toSelector: `[data-board-tile="${tileId}"]`,
        startOrientation: "vertical",
        endOrientation: placed.orientation || "horizontal",
        durationMs: MOTION.tileFlightMs,
        arcLiftPx: MOTION.playArcLiftPx,
        skipHide: true,
        onLanded: () => {
          setNewestId(tileId);
          play("aiMove");
        },
      }).finally(() => {
        setMotionLock(false);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [boardTiles, hideTile, play, runFlight, setMotionLock]);

  // AI draws one face-down tile at a time from the reserve.
  useLayoutEffect(() => {
    const prevReserve = prevReserveRef.current;
    const prevOpp = prevOppCountRef.current;
    const reserveNow = state.reserve.length;
    const oppNow = opponentCount;
    prevReserveRef.current = reserveNow;
    prevOppCountRef.current = oppNow;

    const drew = reserveNow < prevReserve && oppNow > prevOpp;
    if (!drew || drawingRef.current) return undefined;

    const timer = window.setTimeout(() => {
      setMotionLock(true);
      runFlight({
        tileId: `ai-draw-${reserveNow}-${oppNow}`,
        left: 0,
        right: 0,
        faceDown: true,
        fromSelector: '[data-reserve-top="true"]',
        toSelector: "[data-opponent-origin]",
        startOrientation: "vertical",
        endOrientation: "vertical",
        durationMs: MOTION.drawFlightMs,
        arcLiftPx: MOTION.drawArcLiftPx,
        skipHide: true,
        apply: () => {},
        onLanded: () => play("draw"),
      }).finally(() => {
        setMotionLock(false);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [opponentCount, play, runFlight, setMotionLock, state.reserve.length]);

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
      const humanWon = state.roundResult.winnerIndex === HUMAN_INDEX;
      play(humanWon ? "roundWin" : "defeat");
      if (humanWon) vibrate([12, 30, 12]);
      else vibrate(30);
      const winnerName = humanWon ? t("game.you") : t("game.rival");
      setBanner({
        variant: "round",
        title: t("dialog.roundOver"),
        subtitle: `${winnerName} · ${t("rules.pointsAwarded", {
          points: state.roundResult.points,
        })}`,
      });
      const timer = window.setTimeout(() => setBanner(null), MOTION.bannerMs);
      return () => window.clearTimeout(timer);
    }

    if (state.phase === PHASE.MATCH_OVER) {
      const humanWon = state.matchWinner === HUMAN_INDEX;
      play(humanWon ? "matchWin" : "defeat");
      if (humanWon) vibrate([16, 40, 16, 40, 24]);
      else vibrate(40);
      const winnerName = humanWon ? t("game.you") : t("game.rival");
      setBanner({
        variant: "match",
        title: t("dialog.matchOver"),
        subtitle: t("rules.matchWon", { name: winnerName }),
      });
      const timer = window.setTimeout(() => setBanner(null), MOTION.celebrationMs);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [HUMAN_INDEX, play, state.matchWinner, state.phase, state.roundResult, t, vibrate]);

  const celebrating = Boolean(banner);
  const humanStatus = (() => {
    if (state.phase === PHASE.MATCH_OVER) {
      return state.matchWinner === HUMAN_INDEX
        ? t("rules.matchWon", { name: t("game.you") })
        : t("rules.matchWon", { name: t("game.rival") });
    }
    if (state.phase === PHASE.ROUND_OVER) return t("dialog.roundOver");
    if (drag || ambiguousSelected) return t("game.dragToEnd");
    if (isHumanTurn) return t("game.yourTurn");
    return t("game.waiting");
  })();

  const opponentStatus = (() => {
    if (state.phase !== PHASE.PLAYING) return t("game.waiting");
    if (aiThinking) return t("game.thinking");
    return t("game.waiting");
  })();

  const canPlayButton =
    isHumanTurn &&
    Boolean(selectedId) &&
    isAutoPlaceable(actions.legalMoves, selectedId);

  return (
    <div className={`game-page${celebrating ? " game-page--celebrate" : ""}`}>
      <Header difficulty={difficulty} onDifficultyChange={setDifficulty} />

      <div className="game-page__body">
        <OpponentPanel
          name={t("game.rival")}
          status={opponentStatus}
          tileCount={opponentCount}
          thinking={aiThinking}
          isTurn={state.currentPlayer === OPPONENT_INDEX && state.phase === PHASE.PLAYING}
        />

        <div className="game-page__mid">
          <div className="game-page__sidebar game-page__sidebar--left">
            <Reserve count={state.reserve.length} />
          </div>

          <GameTable
            tiles={boardTiles}
            hiddenIds={hiddenIds}
            newestId={newestId}
            dropActive={Boolean(drag) || ambiguousSelected}
            hotEnd={hotEnd}
            validEnds={dragValidEnds}
          />

          <div className="game-page__sidebar game-page__sidebar--right">
            <ScoreBoard
              playerScore={state.scores[HUMAN_INDEX]}
              opponentScore={state.scores[OPPONENT_INDEX]}
              target={state.targetScore}
              round={state.round}
              playerName={t("game.you")}
              opponentName={t("game.rival")}
            />
          </div>
        </div>

        <PlayerPanel
          name={t("game.you")}
          status={humanStatus}
          tiles={humanHand}
          selectedId={selectedId}
          onSelectTile={isHumanTurn ? handleTileSelect : undefined}
          onTilePointerDown={isHumanTurn ? handleTilePointerDown : undefined}
          draggingId={drag?.tileId ?? null}
          isTurn={isHumanTurn}
          hiddenIds={hiddenIds}
          enteringIds={enteringIds}
        />
      </div>

      <BottomBar
        canPlay={canPlayButton}
        canDraw={isHumanTurn && actions.canDraw && !drag}
        canPass={isHumanTurn && actions.canPass}
        onPlay={handlePlay}
        onDraw={handleDraw}
        onPass={pass}
        onNewGame={restart}
      />

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
          width={drag.w}
          height={drag.h}
        />
      ) : null}

      <GameBanner
        visible={Boolean(banner)}
        variant={banner?.variant}
        title={banner?.title}
        subtitle={banner?.subtitle}
      />
    </div>
  );
}

export default GamePage;
