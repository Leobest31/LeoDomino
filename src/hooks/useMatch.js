import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PHASE,
  DEFAULT_DIFFICULTY,
  AI_DIFFICULTY_STORAGE_KEY,
  normalizeDifficulty,
  applyAiTurn,
  applyAutoAction,
  chooseAutoAction,
  chooseThinkTimeMs,
  drawTile,
  getAvailableActions,
  playTile,
  passTurn,
  startMatch,
  startNextRound,
  resolvePlayChoice,
} from "../game/index.js";
import {
  HUMAN_INDEX,
  PLAYER_COUNT_STORAGE_KEY,
  buildOfflinePlayerIds,
  isAiSeat,
  normalizePlayerCount,
} from "../game/players.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import { MOTION } from "../utils/motion.js";
import {
  clearMatchSave,
  loadMatch,
  sanitizeMatchState,
  saveMatch,
  recordMatch,
  recordRound,
} from "../persistence/index.js";

function readStoredDifficulty() {
  return normalizeDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY));
}

function readStoredPlayerCount() {
  return normalizePlayerCount(readStorage(PLAYER_COUNT_STORAGE_KEY, 2));
}

function createMatchState(options) {
  const playerCount = normalizePlayerCount(
    options.playerCount ?? readStoredPlayerCount()
  );
  return startMatch({
    seed: options.seed,
    targetScore: options.targetScore,
    playerCount,
    playerIds: buildOfflinePlayerIds(playerCount),
  });
}

function createInitialState(options) {
  const saved = options.skipResume ? null : loadMatch();
  if (saved?.state) {
    // Resume integrity: table size comes from the saved match, not prefs.
    const resumedCount = normalizePlayerCount(saved.state.players?.length);
    return {
      state: saved.state,
      difficulty:
        options.difficulty != null
          ? normalizeDifficulty(options.difficulty)
          : normalizeDifficulty(saved.difficulty),
      selectedId: saved.selectedId,
      resumed: true,
      matchStartedAt: saved.matchStartedAt || Date.now(),
      playerCount: resumedCount,
    };
  }
  const preferredCount = normalizePlayerCount(
    options.playerCount ?? readStoredPlayerCount()
  );
  return {
    state: createMatchState({ ...options, playerCount: preferredCount }),
    difficulty:
      options.difficulty != null
        ? normalizeDifficulty(options.difficulty)
        : readStoredDifficulty(),
    selectedId: null,
    resumed: false,
    matchStartedAt: Date.now(),
    playerCount: preferredCount,
  };
}

/**
 * Bridge rules + commercial AI → UI, with offline save / resume / stats.
 * Offline V1: human seat 0, AI on every other seat (2 / 3 / 4 players).
 */
export function useMatch(options = {}) {
  const targetScore = options.targetScore;
  const [boot] = useState(() => createInitialState(options));
  const [difficulty, setDifficultyState] = useState(() => boot.difficulty);
  const [playerCount, setPlayerCountState] = useState(() => boot.playerCount);
  const [state, setState] = useState(() => boot.state);
  const [selectedId, setSelectedId] = useState(() => boot.selectedId);
  const [matchStartedAt, setMatchStartedAt] = useState(() => boot.matchStartedAt);
  const [matchEndedAt, setMatchEndedAt] = useState(() =>
    boot.state.phase === PHASE.MATCH_OVER ? Date.now() : null
  );
  const [errorKey, setErrorKey] = useState(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [motionLock, setMotionLock] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const playerCountRef = useRef(playerCount);
  playerCountRef.current = playerCount;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const matchStartedAtRef = useRef(matchStartedAt);
  matchStartedAtRef.current = matchStartedAt;
  const prevPhaseRef = useRef(state.phase);

  const actions = useMemo(() => getAvailableActions(state), [state]);
  const isHumanTurn =
    state.phase === PHASE.PLAYING &&
    state.currentPlayer === HUMAN_INDEX &&
    !motionLock;

  const persist = useCallback(() => {
    saveMatch({
      state: stateRef.current,
      difficulty: difficultyRef.current,
      selectedId: selectedRef.current,
      matchStartedAt: matchStartedAtRef.current,
    });
  }, []);

  const setDifficulty = useCallback((next) => {
    const normalized = normalizeDifficulty(next);
    setDifficultyState(normalized);
    writeStorage(AI_DIFFICULTY_STORAGE_KEY, normalized);
  }, []);

  const setPlayerCount = useCallback((next) => {
    const normalized = normalizePlayerCount(next);
    setPlayerCountState(normalized);
    playerCountRef.current = normalized;
    writeStorage(PLAYER_COUNT_STORAGE_KEY, normalized);
  }, []);

  const restart = useCallback(() => {
    setSelectedId(null);
    setErrorKey(null);
    setAiThinking(false);
    setMotionLock(false);
    const startedAt = Date.now();
    setMatchStartedAt(startedAt);
    matchStartedAtRef.current = startedAt;
    setMatchEndedAt(null);
    const count = normalizePlayerCount(playerCountRef.current);
    const next = createMatchState({
      seed: Date.now(),
      targetScore,
      playerCount: count,
    });
    stateRef.current = next;
    setState(next);
    clearMatchSave();
    saveMatch({
      state: next,
      difficulty: difficultyRef.current,
      selectedId: null,
      matchStartedAt: startedAt,
    });
  }, [targetScore]);

  const continueRound = useCallback(() => {
    setSelectedId(null);
    setErrorKey(null);
    setState((current) => {
      const next = startNextRound(current);
      stateRef.current = next;
      return next;
    });
  }, []);

  const selectTile = useCallback(
    (tileId) => {
      if (!isHumanTurn) return;
      setErrorKey(null);
      setSelectedId((current) => (current === tileId ? null : tileId));
    },
    [isHumanTurn]
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  const commitPlay = useCallback((tileId, end = null) => {
    const current = stateRef.current;
    const legalMoves = getAvailableActions(current).legalMoves;
    const chosen = resolvePlayChoice(legalMoves, tileId, end);
    if (!chosen) {
      setErrorKey("errors.illegalMove");
      return null;
    }
    const tile = current.byId[tileId];
    try {
      const next = playTile(current, chosen.tileId, chosen.end);
      stateRef.current = next;
      setState(next);
      setSelectedId(null);
      setErrorKey(null);
      return {
        kind: "play",
        actor: "human",
        tileId,
        left: tile.a,
        right: tile.b,
        end: chosen.end,
        orientation: chosen.orientation,
        placedLeft: chosen.left,
        placedRight: chosen.right,
      };
    } catch {
      setErrorKey("errors.illegalMove");
      return null;
    }
  }, []);

  const commitDraw = useCallback(() => {
    const current = stateRef.current;
    if (!getAvailableActions(current).canDraw) return null;
    const drawnId = current.reserve[0];
    const tile = current.byId[drawnId];
    try {
      const next = drawTile(current);
      stateRef.current = next;
      setState(next);
      setErrorKey(null);
      return {
        kind: "draw",
        actor: "human",
        tileId: drawnId,
        left: tile.a,
        right: tile.b,
        nextState: next,
      };
    } catch {
      setErrorKey("errors.reserveEmpty");
      return null;
    }
  }, []);

  const playSelected = useCallback(() => {
    if (!selectedId) return null;
    return commitPlay(selectedId);
  }, [commitPlay, selectedId]);

  const draw = useCallback(() => commitDraw(), [commitDraw]);

  const pass = useCallback(() => {
    if (!isHumanTurn || !actions.canPass) return;
    try {
      const next = passTurn(stateRef.current);
      stateRef.current = next;
      setState(next);
      setErrorKey(null);
    } catch {
      setErrorKey("errors.noMoves");
    }
  }, [actions.canPass, isHumanTurn]);

  // Autosave after every meaningful match change.
  useEffect(() => {
    persist();
  }, [state, difficulty, selectedId, persist]);

  // Flush save when the tab hides / unloads.
  useEffect(() => {
    const flush = () => persist();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => {
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);

  // Career stats — round / match boundaries (no engine changes).
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (prev === state.phase) return;

    if (state.phase === PHASE.ROUND_OVER && state.roundResult) {
      const humanPoints =
        state.roundResult.winnerIndex === HUMAN_INDEX ? state.roundResult.points : 0;
      recordRound(
        humanPoints,
        `${state.seed}:r${state.round}:${state.roundResult.winnerIndex}:${state.roundResult.points}`
      );
    }

    if (state.phase === PHASE.MATCH_OVER) {
      setMatchEndedAt((current) => current ?? Date.now());
      recordMatch({
        won: state.matchWinner === HUMAN_INDEX,
        humanScore: state.scores[HUMAN_INDEX] ?? 0,
        fingerprint: `${state.seed}:m:${state.scores.join("-")}:${state.matchWinner}`,
      });
    } else if (prev === PHASE.MATCH_OVER) {
      setMatchEndedAt(null);
    }
  }, [state]);

  // Multi-AI orchestration: every non-human seat takes its own turn.
  useEffect(() => {
    if (motionLock) return undefined;
    if (state.phase !== PHASE.PLAYING) {
      setAiThinking(false);
      return undefined;
    }
    const seat = state.currentPlayer;
    if (!isAiSeat(seat)) {
      setAiThinking(false);
      return undefined;
    }

    setAiThinking(true);
    const delay = chooseThinkTimeMs(state, difficulty);

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.phase !== PHASE.PLAYING || current.currentPlayer !== seat) {
          return current;
        }
        try {
          const next = applyAiTurn(current, {
            difficulty,
            aiIndex: seat,
          });
          stateRef.current = next;
          return next;
        } catch {
          // Last-ditch legal recovery (draw/pass/play) — no AI heuristics.
          try {
            const unlocked = sanitizeMatchState(current);
            const action = chooseAutoAction(unlocked);
            const recovered = action ? applyAutoAction(unlocked, action) : unlocked;
            stateRef.current = recovered;
            return recovered;
          } catch {
            return current;
          }
        }
      });
      setAiThinking(false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state, difficulty, motionLock]);

  useEffect(() => {
    if (state.phase !== PHASE.ROUND_OVER) return undefined;
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.phase !== PHASE.ROUND_OVER) return current;
        const next = startNextRound(current);
        stateRef.current = next;
        return next;
      });
    }, MOTION.celebrationMs);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.round]);

  const boardTiles = state.board.map((tile) => ({
    id: tile.id,
    left: tile.left,
    right: tile.right,
    orientation: tile.orientation,
  }));

  const humanHand = state.players[HUMAN_INDEX].hand.map((id) => {
    const tile = state.byId[id];
    return { id, left: tile.a, right: tile.b };
  });

  const opponentHands = state.players
    .map((player, index) => ({
      index,
      id: player.id,
      count: player.hand.length,
    }))
    .filter((entry) => entry.index !== HUMAN_INDEX);

  const thinkingSeat =
    aiThinking && state.phase === PHASE.PLAYING && isAiSeat(state.currentPlayer)
      ? state.currentPlayer
      : null;

  return {
    state,
    stateRef,
    selectedId,
    errorKey,
    actions,
    isHumanTurn,
    aiThinking,
    thinkingSeat,
    difficulty,
    setDifficulty,
    playerCount,
    setPlayerCount,
    boardTiles,
    humanHand,
    opponentHands,
    opponentCount: opponentHands[0]?.count ?? 0,
    matchStartedAt,
    matchDurationSeconds: Math.max(
      0,
      Math.floor(((matchEndedAt ?? Date.now()) - matchStartedAt) / 1000)
    ),
    selectTile,
    clearSelection,
    playSelected,
    commitPlay,
    commitDraw,
    draw,
    pass,
    restart,
    continueRound,
    setMotionLock,
    HUMAN_INDEX,
  };
}

export default useMatch;
