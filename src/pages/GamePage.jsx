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
import MatchOverModal from "../components/MatchOverModal";
import { useMatch } from "../hooks/useMatch";
import { useFlightDirector } from "../hooks/useFlightDirector";
import { usePrefs } from "../hooks/usePrefs.js";
import {
  PHASE,
  ROUND_END_REASON,
  getAvailableActions,
  isAmbiguousPlacement,
  isAutoPlaceable,
  legalEndsForTile,
  resolvePlayChoice,
  resolveDragDestination,
  opponentFeltPosition,
  resolveRuleset,
} from "../game/index.js";
import { MOTION, wait } from "../utils/motion.js";
import "./GamePage.css";

function seatDisplayName(t, seatOrder, opponentCount) {
  if (opponentCount <= 1) return t("game.rival");
  return t("game.aiSeat", { n: seatOrder + 1 });
}

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
 * @param {{ onMainMenu?: () => void, matchOptions?: object }} props
 */
function GamePage({ onMainMenu, matchOptions = null }) {
  const { t } = useI18n();
  const { play } = useAudio();
  const { vibrate } = usePrefs();
  const {
    state,
    stateRef,
    selectedId,
    actions,
    isHumanTurn,
    difficulty,
    setDifficulty,
    boardTiles,
    spinnerId,
    spinnerNorth,
    spinnerSouth,
    humanHand,
    thinkingSeat,
    playerCount,
    setPlayerCount,
    matchDurationSeconds,
    selectTile,
    clearSelection,
    commitPlay,
    commitDraw,
    pass,
    restart,
    persist,
    setMotionLock,
    HUMAN_INDEX,
  } = useMatch(matchOptions ?? {});

  const { flight, hiddenIds, runFlight, hideTile, showTile } = useFlightDirector();
  const [newestId, setNewestId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Hold prior HUD scores while the floating +N plays. */
  const [scoreReveal, setScoreReveal] = useState(null);
  const [enteringIds, setEnteringIds] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [hotEnd, setHotEnd] = useState(null);
  const tableStageRef = useRef(null);
  const prevBoardRef = useRef(boardTiles.map((tile) => tile.id));
  const prevPhaseRef = useRef(state.phase);
  const prevHandRef = useRef([]);
  const prevTurnRef = useRef(isHumanTurn);
  const prevReserveRef = useRef(state.reserve.length);
  const prevHandCountsRef = useRef(state.players.map((player) => player.hand.length));
  const hiddenIdsRef = useRef(hiddenIds);
  const dragRef = useRef(null);
  const drawingRef = useRef(false);
  const skipClickRef = useRef(false);
  const autoDrawKeyRef = useRef("");
  const openingTileIdRef = useRef(null);
  hiddenIdsRef.current = hiddenIds;
  dragRef.current = drag;

  // AI / resumed count scores: float +N, then release the HUD.
  useEffect(() => {
    const pts = state.statusVars?.playPoints;
    if (!Number.isFinite(pts) || pts <= 0) return;
    if (scoreReveal?.points === pts) return;
    // Human path already set scoreReveal inside placeTileOnBoard.
    if (scoreReveal) return;
    const hold = state.scores.map((score, index) =>
      index === state.statusVars?.scorer ? score - pts : score
    );
    setScoreReveal({ points: pts, holdScores: hold });
  }, [state.statusVars, state.scores, scoreReveal]);

  // Layout-only: remember the opening tile so the chain stays centered on it.
  if (boardTiles.length === 0) {
    openingTileIdRef.current = null;
  } else if (boardTiles.length === 1) {
    openingTileIdRef.current = boardTiles[0].id;
  }

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
          const priorScores = stateRef.current.scores.slice();
          commitPlay(tileId, chosen.end);
          const pts = stateRef.current.statusVars?.playPoints;
          if (Number.isFinite(pts) && pts > 0) {
            setScoreReveal({
              points: pts,
              holdScores: priorScores,
            });
          }
        },
        onLanded: () => {
          setNewestId(tileId);
          showTile(tileId);
          play("place");
          vibrate(14);
        },
      });
      setMotionLock(false);
      return true;
    },
    [clearSelection, commitPlay, play, runFlight, setMotionLock, showTile, stateRef, vibrate]
  );

  const finishDrag = useCallback(
    async (clientX, clientY) => {
      const current = dragRef.current;
      if (!current) return;

      const targetedEnd = hitDropEnd(clientX, clientY);
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

      const legalMoves = getAvailableActions(stateRef.current).legalMoves;
      const resolved = resolveDragDestination(legalMoves, tileId, targetedEnd);

      if (resolved.ok) {
        hideTile(tileId);
        await placeTileOnBoard(tileId, resolved.move.end, fromRect);
        return;
      }

      // Invalid / ambiguous drop — return the tile to the hand (no auto branch pick).
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

        // Tabletop rule: a drawn tile always lands in the hand and waits for
        // the player — it is never auto-played, even when only one end is
        // legal. When it's playable both ways, pre-select it so the existing
        // drop-zone UI immediately offers the left/right choice.
        if (ends.length > 0) {
          if (ends.length > 1) {
            selectTile(drawnId);
          }
          play("pickup");
          break;
        }
      }
    } finally {
      drawingRef.current = false;
      setMotionLock(false);
    }
  }, [commitDraw, play, runFlight, selectTile, setMotionLock, stateRef]);

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

  // AI / external board additions — fly onto the shared board.
  // Board tiles stay visible always; flight is cosmetic only (no hideTile).
  const boardSignature = state.board.map((tile) => tile.id).join("|");
  const handCountsSignature = state.players.map((player) => player.hand.length).join("|");

  useLayoutEffect(() => {
    const prev = prevBoardRef.current;
    const prevCounts = prevHandCountsRef.current;
    const nextIds = state.board.map((tile) => tile.id);
    const nextCounts = state.players.map((player) => player.hand.length);
    const added = nextIds.filter((id) => !prev.includes(id));
    prevBoardRef.current = nextIds;

    if (!added.length) return undefined;

    // Sync hand baselines only when a board tile was added (AI/human play).
    prevHandCountsRef.current = nextCounts;

    const tileId = added[added.length - 1];
    // Human plays already animate via placeTileOnBoard — skip duplicate flight.
    if (hiddenIdsRef.current.has(tileId)) {
      // Ensure any stale hide cannot leave a board tile invisible in the hand layer.
      showTile(tileId);
      return undefined;
    }

    const placed = state.board.find((tile) => tile.id === tileId);
    if (!placed) return undefined;

    const fromSeat = nextCounts.findIndex(
      (count, index) => index !== HUMAN_INDEX && count < (prevCounts[index] ?? count)
    );
    const fromSelector =
      fromSeat >= 0
        ? `[data-opponent-origin][data-seat-index="${fromSeat}"]`
        : "[data-opponent-origin]";

    const timer = window.setTimeout(() => {
      setMotionLock(true);
      runFlight({
        tileId,
        left: placed.left,
        right: placed.right,
        faceDown: false,
        fromSelector,
        toSelector: `[data-board-tile="${tileId}"]`,
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
        setMotionLock(false);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [boardSignature, handCountsSignature, HUMAN_INDEX, play, runFlight, setMotionLock, showTile, state.board, state.players]);

  // Safety: every board tile must remain visible for the whole round.
  useEffect(() => {
    for (const tile of state.board) {
      if (hiddenIdsRef.current.has(tile.id)) {
        showTile(tile.id);
      }
    }
  }, [boardSignature, showTile, state.board]);

  // AI draws one face-down tile at a time from the reserve into the drawing seat.
  useLayoutEffect(() => {
    const prevReserve = prevReserveRef.current;
    const prevCounts = prevHandCountsRef.current;
    const reserveNow = state.reserve.length;
    const nextCounts = state.players.map((player) => player.hand.length);
    const drewSeat = nextCounts.findIndex(
      (count, index) =>
        index !== HUMAN_INDEX &&
        count > (prevCounts[index] ?? count) &&
        reserveNow < prevReserve
    );
    prevReserveRef.current = reserveNow;
    prevHandCountsRef.current = nextCounts;

    if (drewSeat < 0 || drawingRef.current) return undefined;

    const timer = window.setTimeout(() => {
      setMotionLock(true);
      runFlight({
        tileId: `ai-draw-${drewSeat}-${reserveNow}-${nextCounts[drewSeat]}`,
        left: 0,
        right: 0,
        faceDown: true,
        fromSelector: '[data-reserve-top="true"]',
        toSelector: `[data-opponent-origin][data-seat-index="${drewSeat}"]`,
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
  }, [HUMAN_INDEX, handCountsSignature, play, runFlight, setMotionLock, state.players, state.reserve.length]);

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
        ? t("game.you")
        : seatDisplayName(
            t,
            Math.max(0, winnerIndex - 1),
            Math.max(1, state.players.length - 1)
          );
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
  }, [HUMAN_INDEX, play, state.matchWinner, state.phase, state.players.length, state.roundResult, t, vibrate]);

  const celebrating = Boolean(banner);
  const matchOver = state.phase === PHASE.MATCH_OVER;
  const humanWonMatch = state.matchWinner === HUMAN_INDEX;
  const playerNames = state.players.map((_, index) => {
    if (index === HUMAN_INDEX) return t("game.you");
    return seatDisplayName(t, index - 1, state.players.length - 1);
  });
  const winnerName =
    state.matchWinner == null
      ? ""
      : playerNames[state.matchWinner] ?? t("game.rival");

  const humanStatus = (() => {
    if (matchOver) {
      return t("rules.matchWon", { name: winnerName || t("game.rival") });
    }
    if (state.phase === PHASE.ROUND_OVER) return t("dialog.roundOver");
    if (drag || ambiguousSelected) return t("game.dragToEnd");
    if (isHumanTurn) return t("game.yourTurn");
    return t("game.waiting");
  })();

  // Seat layout for every non-human player (2 / 3 / 4 player tables).
  const opponentSeats = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => index !== HUMAN_INDEX)
    .map(({ player, index }, seatOrder, seats) => {
      const position = opponentFeltPosition(index, state.players.length) ?? "top";
      const thinking = thinkingSeat === index;
      const isTurn = state.currentPlayer === index && state.phase === PHASE.PLAYING;
      return {
        index,
        position,
        name: seatDisplayName(t, seatOrder, seats.length),
        status: thinking || isTurn ? t("game.thinking") : t("game.waiting"),
        tileCount: player.hand.length,
        thinking,
        isTurn,
      };
    });
  const topSeats = opponentSeats.filter((seat) => seat.position === "top");
  const leftSeats = opponentSeats.filter((seat) => seat.position === "left");
  const rightSeats = opponentSeats.filter((seat) => seat.position === "right");

  const canPlayButton =
    isHumanTurn &&
    Boolean(selectedId) &&
    isAutoPlaceable(actions.legalMoves, selectedId);

  const handleNewMatch = () => {
    play("button");
    restart();
  };

  const handlePlayerCountChange = (next) => {
    setPlayerCount(next);
  };

  const handleMatchStats = () => {
    play("button");
    setSettingsOpen(true);
  };

  /** Leave to Setup without wiping the saved match (Resume restores it). */
  const handleMainMenu = () => {
    play("button");
    persist();
    onMainMenu?.();
  };

  return (
    <div
      className={`game-page game-page--players-${state.players.length}${
        celebrating ? " game-page--celebrate" : ""
      }${matchOver ? " game-page--match-over" : ""}`}
    >
      <div className="game-page__shell">
        <div className="game-page__chrome" {...(matchOver ? { inert: true } : {})}>
          <Header
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            playerCount={playerCount}
            onPlayerCountChange={handlePlayerCountChange}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
            onMainMenu={handleMainMenu}
            compact
            startBelow={
              <div className="game-page__hud-score">
                <ScoreBoard
                  scores={scoreReveal?.holdScores ?? state.scores}
                  names={playerNames}
                  humanIndex={HUMAN_INDEX}
                  target={state.targetScore}
                  round={state.round}
                  scoreFormat={
                    resolveRuleset(state.rulesetId).hudScoreFormat ?? "absolute"
                  }
                />
              </div>
            }
            centerBelow={
              <div className="game-page__top-hud-center">
                {topSeats.map((seat) => (
                  <OpponentPanel
                    key={seat.index}
                    position="top"
                    seatIndex={seat.index}
                    name={seat.name}
                    status={seat.status}
                    tileCount={seat.tileCount}
                    thinking={seat.thinking}
                    isTurn={seat.isTurn}
                  />
                ))}
              </div>
            }
          />
        </div>

        <div className="game-page__body" {...(matchOver ? { inert: true } : {})}>
          <div className="game-page__mid">
            {leftSeats.length > 0 ? (
              <div className="game-page__side-seats game-page__side-seats--left">
                {leftSeats.map((seat) => (
                  <OpponentPanel
                    key={seat.index}
                    position="left"
                    seatIndex={seat.index}
                    name={seat.name}
                    status={seat.status}
                    tileCount={seat.tileCount}
                    thinking={seat.thinking}
                    isTurn={seat.isTurn}
                  />
                ))}
              </div>
            ) : null}

            <div className="game-page__table-stage" ref={tableStageRef}>
              <GameTable
                tiles={boardTiles}
                newestId={newestId}
                centerTileId={openingTileIdRef.current}
                spinnerId={spinnerId}
                spinnerNorth={spinnerNorth}
                spinnerSouth={spinnerSouth}
                dropActive={Boolean(drag) || ambiguousSelected}
                hotEnd={hotEnd}
                validEnds={dragValidEnds}
                playPoints={scoreReveal?.points ?? 0}
                onPlayPointsDone={() => setScoreReveal(null)}
              />
            </div>

            {rightSeats.length > 0 ? (
              <div className="game-page__side-seats game-page__side-seats--right">
                {rightSeats.map((seat) => (
                  <OpponentPanel
                    key={seat.index}
                    position="right"
                    seatIndex={seat.index}
                    name={seat.name}
                    status={seat.status}
                    tileCount={seat.tileCount}
                    thinking={seat.thinking}
                    isTurn={seat.isTurn}
                  />
                ))}
              </div>
            ) : null}
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

        <div {...(matchOver ? { inert: true } : {})}>
          <BottomBar
            canPlay={canPlayButton}
            canDraw={isHumanTurn && actions.canDraw && !drag}
            canPass={isHumanTurn && actions.canPass}
            onPlay={handlePlay}
            onDraw={handleDraw}
            onPass={pass}
            onNewGame={restart}
            endAbove={
              <div className="game-page__hud-reserve">
                <Reserve count={state.reserve.length} />
              </div>
            }
          />
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

      <MatchOverModal
        open={matchOver}
        humanWon={humanWonMatch}
        winnerName={winnerName}
        scores={state.scores}
        roundsPlayed={state.round}
        durationSeconds={matchDurationSeconds}
        onNewMatch={handleNewMatch}
        onStatistics={handleMatchStats}
        onMainMenu={handleMainMenu}
      />
    </div>
  );
}

export default GamePage;
