import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PHASE,
  DEFAULT_DIFFICULTY,
  AI_DIFFICULTY_STORAGE_KEY,
  normalizeDifficulty,
  applyAiTurn,
  applyAutoAction,
  chooseAiAction,
  chooseAutoAction,
  chooseThinkTimeMs,
  drawTile,
  getAvailableActions,
  playTile,
  passTurn,
  startMatch,
  startNextRound,
  advanceAfterRoundSummary,
  resolvePlayChoice,
  DEFAULT_RULESET_ID,
  RULESET_STORAGE_KEY,
  normalizeRulesetId,
} from "../game/index.js";
import {
  HUMAN_INDEX,
  PLAYER_COUNT_STORAGE_KEY,
  buildOfflinePlayerIds,
  isAiSeat,
} from "../game/players.js";
import { V1_PLAYER_COUNT } from "../game/v1Product.js";
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

function readStoredRulesetId() {
  try {
    return normalizeRulesetId(readStorage(RULESET_STORAGE_KEY, DEFAULT_RULESET_ID));
  } catch {
    return DEFAULT_RULESET_ID;
  }
}

function createMatchState(options) {
  const playerCount = V1_PLAYER_COUNT;
  const rulesetId = normalizeRulesetId(
    options.rulesetId ?? readStoredRulesetId()
  );
  return startMatch({
    seed: options.seed,
    targetScore: options.targetScore,
    playerCount,
    playerIds: buildOfflinePlayerIds(playerCount),
    rulesetId,
  });
}

function createInitialState(options) {
  if (options.skipResume) {
    // Fresh start from Game Setup — drop prior save so it cannot resurrect.
    clearMatchSave();
  }

  const saved = options.skipResume ? null : loadMatch();
  if (saved?.state && saved.state.players?.length === V1_PLAYER_COUNT) {
    // Resume integrity: ruleset comes from the saved match, not prefs.
    // V1 only resumes 1v1. Old 3P/4P saves fail validation and never reach here.
    const resumedRulesetId =
      typeof saved.state.rulesetId === "string" && saved.state.rulesetId
        ? saved.state.rulesetId
        : saved.rulesetId ?? DEFAULT_RULESET_ID;
    return {
      state: saved.state,
      difficulty:
        options.difficulty != null
          ? normalizeDifficulty(options.difficulty)
          : normalizeDifficulty(saved.difficulty),
      selectedId: saved.selectedId,
      resumed: true,
      matchStartedAt: saved.matchStartedAt || Date.now(),
      playerCount: V1_PLAYER_COUNT,
      rulesetId: resumedRulesetId,
    };
  }
  const preferredCount = V1_PLAYER_COUNT;
  const preferredDifficulty =
    options.difficulty != null
      ? normalizeDifficulty(options.difficulty)
      : readStoredDifficulty();
  const preferredRulesetId = normalizeRulesetId(
    options.rulesetId ?? readStoredRulesetId()
  );
  if (options.playerCount != null) {
    writeStorage(PLAYER_COUNT_STORAGE_KEY, preferredCount);
  }
  if (options.difficulty != null) {
    writeStorage(AI_DIFFICULTY_STORAGE_KEY, preferredDifficulty);
  }
  if (options.rulesetId != null) {
    writeStorage(RULESET_STORAGE_KEY, preferredRulesetId);
  }
  return {
    state: createMatchState({
      ...options,
      playerCount: preferredCount,
      rulesetId: preferredRulesetId,
    }),
    difficulty: preferredDifficulty,
    selectedId: null,
    resumed: false,
    matchStartedAt: Date.now(),
    playerCount: preferredCount,
    rulesetId: preferredRulesetId,
  };
}

/**
 * Bridge rules + commercial AI → UI, with offline save / resume / stats.
 * V1 product surface: human seat 0 vs LeoBest (seat 1).
 */
export function useMatch(options = {}) {
  const targetScore = options.targetScore;
  const [boot] = useState(() => createInitialState(options));
  const [difficulty, setDifficultyState] = useState(() => boot.difficulty);
  const [playerCount, setPlayerCountState] = useState(() => boot.playerCount);
  const [rulesetId] = useState(() => boot.rulesetId);
  const [state, setState] = useState(() => boot.state);
  const [selectedId, setSelectedId] = useState(() => boot.selectedId);
  const [matchStartedAt, setMatchStartedAt] = useState(() => boot.matchStartedAt);
  const [matchEndedAt, setMatchEndedAt] = useState(() =>
    boot.state.phase === PHASE.MATCH_OVER ? Date.now() : null
  );
  const [errorKey, setErrorKey] = useState(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [motionLock, setMotionLock] = useState(false);
  const [pendingAiDraw, setPendingAiDraw] = useState(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const playerCountRef = useRef(playerCount);
  playerCountRef.current = playerCount;
  const rulesetIdRef = useRef(rulesetId);
  rulesetIdRef.current = rulesetId;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const abandonedRef = useRef(false);
  const matchStartedAtRef = useRef(matchStartedAt);
  matchStartedAtRef.current = matchStartedAt;
  const prevPhaseRef = useRef(state.phase);

  const actions = useMemo(() => getAvailableActions(state), [state]);
  const isHumanTurn =
    state.phase === PHASE.PLAYING &&
    state.currentPlayer === HUMAN_INDEX &&
    !motionLock;

  const persist = useCallback(() => {
    if (abandonedRef.current) return;
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

  const setPlayerCount = useCallback(() => {
    setPlayerCountState(V1_PLAYER_COUNT);
    playerCountRef.current = V1_PLAYER_COUNT;
    writeStorage(PLAYER_COUNT_STORAGE_KEY, V1_PLAYER_COUNT);
  }, []);

  const restart = useCallback(() => {
    setSelectedId(null);
    setErrorKey(null);
    setAiThinking(false);
    setMotionLock(false);
    setPendingAiDraw(null);
    const startedAt = Date.now();
    setMatchStartedAt(startedAt);
    matchStartedAtRef.current = startedAt;
    setMatchEndedAt(null);
    const count = V1_PLAYER_COUNT;
    // Match keeps its ruleset until the player returns to Setup.
    const matchRulesetId = normalizeRulesetId(
      stateRef.current?.rulesetId ?? rulesetIdRef.current
    );
    const next = createMatchState({
      seed: Date.now(),
      targetScore,
      playerCount: count,
      rulesetId: matchRulesetId,
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

  const abandonMatch = useCallback(() => {
    const current = stateRef.current;
    abandonedRef.current = true;
    recordMatch({
      won: false,
      humanScore: current?.scores?.[HUMAN_INDEX] ?? 0,
      fingerprint: `${current?.seed ?? "match"}:forfeit:${Date.now()}`,
    });
    clearMatchSave();
  }, []);

  const continueRound = useCallback(() => {
    setSelectedId(null);
    setErrorKey(null);
    setState((current) => {
      const next = current.roundResult?.summary
        ? advanceAfterRoundSummary(current)
        : startNextRound(current);
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

  const commitDraw = useCallback((tileId = null) => {
    const current = stateRef.current;
    if (!getAvailableActions(current).canDraw) return null;
    const drawnId =
      typeof tileId === "string" && tileId
        ? tileId
        : current.reserve[0];
    if (!drawnId || !current.reserve.includes(drawnId)) return null;
    const tile = current.byId[drawnId];
    try {
      const next = drawTile(current, drawnId);
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

  const confirmAiDraw = useCallback((tileId) => {
    const current = stateRef.current;
    const drawnId =
      typeof tileId === "string" && current.reserve.includes(tileId)
        ? tileId
        : current.reserve[0];
    if (!drawnId) return null;
    try {
      const next = drawTile(current, drawnId);
      stateRef.current = next;
      setState(next);
      setErrorKey(null);
      return { tileId: drawnId, nextState: next };
    } catch {
      setErrorKey("errors.reserveEmpty");
      return null;
    }
  }, []);

  const clearPendingAiDraw = useCallback(() => {
    setPendingAiDraw(null);
  }, []);

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
  // Draws pause for a face-down reserve visualization; play/pass apply immediately.
  useEffect(() => {
    if (motionLock || pendingAiDraw) return undefined;
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
      const current = stateRef.current;
      if (current.phase !== PHASE.PLAYING || current.currentPlayer !== seat) {
        setAiThinking(false);
        return;
      }

      let action = null;
      try {
        action = chooseAiAction(current, {
          difficulty,
          aiIndex: seat,
        });
      } catch {
        action = null;
      }

      if (action?.type === "draw" && current.reserve[0]) {
        setPendingAiDraw({
          seat,
          tileId: current.reserve[0],
          tileIds: current.reserve.slice(),
        });
        setAiThinking(false);
        return;
      }

      let queuedDraw = null;
      setState((latest) => {
        if (latest.phase !== PHASE.PLAYING || latest.currentPlayer !== seat) {
          return latest;
        }
        try {
          const next = applyAiTurn(latest, {
            difficulty,
            aiIndex: seat,
          });
          stateRef.current = next;
          return next;
        } catch {
          try {
            const unlocked = sanitizeMatchState(latest);
            const recoveredAction = chooseAutoAction(unlocked);
            if (recoveredAction?.type === "draw" && unlocked.reserve[0]) {
              queuedDraw = {
                seat,
                tileId: unlocked.reserve[0],
                tileIds: unlocked.reserve.slice(),
              };
              return latest;
            }
            const recovered = recoveredAction
              ? applyAutoAction(unlocked, recoveredAction)
              : unlocked;
            stateRef.current = recovered;
            return recovered;
          } catch {
            return latest;
          }
        }
      });
      if (queuedDraw) {
        setPendingAiDraw(queuedDraw);
        setAiThinking(false);
        return;
      }
      setAiThinking(false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state, difficulty, motionLock, pendingAiDraw]);

  useEffect(() => {
    if (state.phase !== PHASE.ROUND_OVER) return undefined;
    if (state.roundResult?.summary) return undefined;
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.phase !== PHASE.ROUND_OVER) return current;
        if (current.roundResult?.summary) return current;
        const next = startNextRound(current);
        stateRef.current = next;
        return next;
      });
    }, MOTION.celebrationMs);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.round, state.roundResult?.summary]);

  const spinnerNorth = Array.isArray(state.spinnerNorth) ? state.spinnerNorth : [];
  const spinnerSouth = Array.isArray(state.spinnerSouth) ? state.spinnerSouth : [];
  const boardTiles = state.board.map((tile) => ({
    id: tile.id,
    left: tile.left,
    right: tile.right,
    orientation: tile.orientation,
    destination: tile.destination ?? null,
    branch: tile.branch ?? tile.destination ?? null,
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
    rulesetId: state.rulesetId ?? rulesetId,
    boardTiles,
    spinnerId: state.spinnerId ?? null,
    spinnerNorth,
    spinnerSouth,
    lastPlayPoints: Number(state.lastPlayPoints) || 0,
    lastPlayPointsSeat:
      typeof state.lastPlayPointsSeat === "number" ? state.lastPlayPointsSeat : null,
    lastPlayScoreTerminals: Array.isArray(state.lastPlayScoreTerminals)
      ? state.lastPlayScoreTerminals
      : [],
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
    confirmAiDraw,
    clearPendingAiDraw,
    pendingAiDraw,
    draw,
    pass,
    restart,
    abandonMatch,
    continueRound,
    setMotionLock,
    HUMAN_INDEX,
  };
}

export default useMatch;
