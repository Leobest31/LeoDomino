/**
 * Server-side online gameplay authority.
 *
 * Reuses the existing pure engine in src/game (Classic/legacy, Haitian, American).
 * Does not reimplement rules. Deals, projects a safe public view, and applies
 * play / draw / pass plus a documented next-round advance.
 *
 * Shared engine imports (do not duplicate rules here):
 *   ../game/rules/drawDominoes.js
 *   ../game/rules/constants.js
 *   ../game/rules/haitianStart.js
 *   ../game/rulesets/index.js
 *
 * Draw never forwards a client tile id. Seed is never taken from the client
 * at the handler boundary (see gameplayHandler.js).
 */

import {
  advanceAfterRoundSummary,
  drawTile,
  getAvailableActions,
  passTurn,
  playTile,
  startMatch,
  startNextRound,
} from "../game/rules/drawDominoes.js";
import { PHASE } from "../game/rules/constants.js";
import { HAITIAN_OPENING_TILE_ID } from "../game/rules/haitianStart.js";
import { resolveRuleset } from "../game/rulesets/index.js";

export const ONLINE_RULESET_IDS = Object.freeze(["legacy", "haitian", "american"]);
export const ONLINE_ACTION_PLAY = "play";
export const ONLINE_ACTION_DRAW = "draw";
export const ONLINE_ACTION_PASS = "pass";
export const ONLINE_ACTION_ADVANCE_ROUND = "advance_round";
export const PLAYER_A_SEAT = 0;
export const PLAYER_B_SEAT = 1;

const ALLOWED_RULESETS = new Set(ONLINE_RULESET_IDS);

export class GameplayError extends Error {
  /** @param {string} code @param {string} [message] */
  constructor(code, message) {
    super(message || code);
    this.name = "GameplayError";
    this.code = code;
  }
}

/** Cryptographically seeded 32-bit integer for the engine deal. */
export function createServerSeed() {
  const buf = new Uint32Array(1);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    buf[0] = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }
  return (buf[0] || 1) >>> 0;
}

export function isOnlineRulesetId(id) {
  return typeof id === "string" && ALLOWED_RULESETS.has(id);
}

export function seatForUser(match, userId) {
  if (!match || !userId) return null;
  if (match.player_a === userId) return PLAYER_A_SEAT;
  if (match.player_b === userId) return PLAYER_B_SEAT;
  return null;
}

/**
 * Deal a 1v1 online match using the existing engine.
 * `seed` is for tests / the server handler only — never a client RPC argument.
 */
export function dealOnlineGame(options) {
  const rulesetId = options?.rulesetId;
  if (!isOnlineRulesetId(rulesetId)) {
    throw new GameplayError("UNSUPPORTED_RULESET", `Unsupported online ruleset: ${rulesetId}`);
  }
  const playerAId = options.playerAId;
  const playerBId = options.playerBId;
  if (!playerAId || !playerBId || playerAId === playerBId) {
    throw new GameplayError("INVALID_SEATS", "Online deal requires two distinct player ids");
  }
  const seed = options.seed ?? createServerSeed();
  const startOptions = {
    rulesetId,
    seed,
    playerCount: 2,
    playerIds: [playerAId, playerBId],
  };
  if (typeof options.targetScore === "number" && Number.isFinite(options.targetScore)) {
    startOptions.targetScore = options.targetScore;
  }
  return { state: startMatch(startOptions), seed };
}

export function statusFromPhase(phase) {
  if (phase === PHASE.MATCH_OVER) return "match_over";
  if (phase === PHASE.ROUND_OVER) return "round_over";
  return "playing";
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/** Strip opponent-hand secrets from engine roundResult. */
export function sanitizeRoundResult(roundResult) {
  if (!roundResult || typeof roundResult !== "object") return null;
  const { hands: _hands, ...rest } = roundResult;
  return cloneJson(rest);
}

function publicSpinner(state) {
  return {
    id: state.spinnerId ?? null,
    north: Array.isArray(state.spinnerNorth) ? state.spinnerNorth.slice() : [],
    south: Array.isArray(state.spinnerSouth) ? state.spinnerSouth.slice() : [],
  };
}

/** Safe public projection persisted on game_sessions. */
export function projectPublicSession(state, meta = {}) {
  return {
    rulesetId: state.rulesetId,
    status: statusFromPhase(state.phase),
    version: meta.version ?? 0,
    currentSeat: state.currentPlayer,
    round: state.round,
    phase: state.phase,
    scores: Array.isArray(state.scores) ? state.scores.slice() : [0, 0],
    board: cloneJson(state.board) ?? [],
    spinner: publicSpinner(state),
    lastPlayPoints: state.lastPlayPoints ?? 0,
    lastPlayPointsSeat: state.lastPlayPointsSeat ?? null,
    lastPlayScoreTerminals: cloneJson(state.lastPlayScoreTerminals) ?? [],
    reserveCount: Array.isArray(state.reserve) ? state.reserve.length : 0,
    handCounts: (state.players ?? []).map((player) =>
      Array.isArray(player.hand) ? player.hand.length : 0
    ),
    roundResult: sanitizeRoundResult(state.roundResult),
    matchWinnerSeat: state.matchWinner ?? null,
  };
}

/** Viewer-filtered view: own hand only, never reserve ids or seed. */
export function projectGameView(state, options) {
  const viewerSeat = options.viewerSeat;
  if (viewerSeat !== PLAYER_A_SEAT && viewerSeat !== PLAYER_B_SEAT) {
    throw new GameplayError("INVALID_SEAT", "viewerSeat must be 0 or 1");
  }
  const publicState = projectPublicSession(state, { version: options.version ?? 0 });
  const myHand = Array.isArray(state.players?.[viewerSeat]?.hand)
    ? state.players[viewerSeat].hand.slice()
    : [];
  const isTurn = state.currentPlayer === viewerSeat && state.phase === PHASE.PLAYING;
  const available = isTurn
    ? getAvailableActions(state)
    : { canPlay: false, canDraw: false, canPass: false, legalMoves: [] };

  return {
    matchId: options.matchId ?? null,
    viewerSeat,
    myHand,
    mustPlayTileId: isTurn ? state.mustPlayTileId ?? null : null,
    canPlay: Boolean(available.canPlay),
    canDraw: Boolean(available.canDraw),
    canPass: Boolean(available.canPass),
    legalMoves: isTurn ? cloneJson(available.legalMoves) ?? [] : [],
    ...publicState,
  };
}

export function assertViewHidesOpponent(view, opponentHand) {
  const mine = new Set(view.myHand ?? []);
  const publicJson = JSON.stringify({
    board: view.board,
    spinner: view.spinner,
    legalMoves: view.legalMoves,
    mustPlayTileId: view.mustPlayTileId,
  });
  for (const tileId of opponentHand ?? []) {
    if (mine.has(tileId)) continue;
    if (publicJson.includes(tileId)) continue;
    if ((view.myHand ?? []).includes(tileId)) {
      throw new GameplayError("SECRET_LEAK", "opponent tile in viewer hand");
    }
  }
  const json = JSON.stringify(view);
  if (/"seed"\s*:/.test(json)) {
    throw new GameplayError("SECRET_LEAK", "view leaked seed");
  }
  if (json.includes('"reserve":[')) {
    throw new GameplayError("SECRET_LEAK", "view leaked reserve order");
  }
}

function tileInHand(state, seat, tileId) {
  return Boolean(state.players?.[seat]?.hand?.includes(tileId));
}

function legalPlacement(state, tileId, end) {
  const available = getAvailableActions(state);
  return (available.legalMoves ?? []).some((move) => move.tileId === tileId && move.end === end);
}

function normalizeEnd(end) {
  if (end == null || end === "") return "right";
  if (typeof end !== "string") {
    throw new GameplayError("ILLEGAL_PLACEMENT", "end must be a string");
  }
  return end;
}

/** Apply one authoritative action. Caller enforces expected_version / locking. */
export function applyOnlineAction(state, input) {
  const seat = input.seat;
  const action = input.action ?? {};
  const type = action.type;

  if (type === ONLINE_ACTION_ADVANCE_ROUND) {
    return applyAdvanceRound(state);
  }
  if (state.phase !== PHASE.PLAYING) {
    throw new GameplayError("ROUND_NOT_ACTIVE", "Round is not active");
  }
  if (state.currentPlayer !== seat) {
    throw new GameplayError("WRONG_TURN", "Not this seat's turn");
  }
  if (type === ONLINE_ACTION_PLAY) return applyPlay(state, action);
  if (type === ONLINE_ACTION_DRAW) return applyDrawAction(state, action);
  if (type === ONLINE_ACTION_PASS) return applyPass(state);
  throw new GameplayError("UNKNOWN_ACTION", `Unsupported action type: ${type}`);
}

function applyPlay(state, action) {
  const tileId = action.tileId;
  if (typeof tileId !== "string" || !tileId) {
    throw new GameplayError("ILLEGAL_TILE", "play requires tileId");
  }
  if (!tileInHand(state, state.currentPlayer, tileId)) {
    throw new GameplayError("ILLEGAL_TILE", "Tile is not in the caller's hand");
  }
  const end = normalizeEnd(action.end);
  const available = getAvailableActions(state);
  if (!available.canPlay) {
    throw new GameplayError("ILLEGAL_PLACEMENT", "No legal play now");
  }
  const openingEmpty = !Array.isArray(state.board) || state.board.length === 0;
  const exact = legalPlacement(state, tileId, end);
  const openingOk =
    openingEmpty && (available.legalMoves ?? []).some((move) => move.tileId === tileId);
  if (!exact && !openingOk) {
    throw new GameplayError("ILLEGAL_PLACEMENT", `Illegal placement: ${tileId} on ${end}`);
  }
  try {
    const next = playTile(state, tileId, end);
    return { state: next, actionType: ONLINE_ACTION_PLAY, safePayload: { tileId, end } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Must open|must open|Must play/i.test(message)) {
      throw new GameplayError("ILLEGAL_TILE", message);
    }
    throw new GameplayError("ILLEGAL_PLACEMENT", message);
  }
}

function applyDrawAction(state, action) {
  if (action.tileId != null && action.tileId !== "") {
    throw new GameplayError("CLIENT_TILE_ID_FORBIDDEN", "Draw must not include a tile id");
  }
  const available = getAvailableActions(state);
  if (!available.canDraw) {
    throw new GameplayError("DRAW_NOT_ALLOWED", "Draw is not allowed now");
  }
  return { state: drawTile(state), actionType: ONLINE_ACTION_DRAW, safePayload: {} };
}

function applyPass(state) {
  const available = getAvailableActions(state);
  if (!available.canPass) {
    throw new GameplayError("PASS_NOT_ALLOWED", "Pass is not allowed now");
  }
  return { state: passTurn(state), actionType: ONLINE_ACTION_PASS, safePayload: {} };
}

/**
 * Minimum next-round contract (not play/draw/pass).
 * Classic/Haitian: startNextRound with a server seed.
 * American: pending match winner finishes via advanceAfterRoundSummary;
 * otherwise startNextRound with a server seed.
 */
export function applyAdvanceRound(state, options = {}) {
  if (state.phase === PHASE.PLAYING || state.phase === PHASE.MATCH_OVER) {
    throw new GameplayError("ADVANCE_NOT_ALLOWED", "No round to advance");
  }
  if (state.phase !== PHASE.ROUND_OVER) {
    throw new GameplayError("ADVANCE_NOT_ALLOWED", "Advance only after round over");
  }
  const pending =
    state.roundResult?.pendingMatchWinner ?? state.roundResult?.pendingMatchWinner;
  if (pending != null) {
    return {
      state: advanceAfterRoundSummary(state),
      actionType: ONLINE_ACTION_ADVANCE_ROUND,
      safePayload: {},
    };
  }
  void resolveRuleset(state.rulesetId);
  const seed = options.seed ?? createServerSeed();
  return {
    state: startNextRound(state, { seed }),
    actionType: ONLINE_ACTION_ADVANCE_ROUND,
    safePayload: {},
  };
}

export function matchStatusForEngine(state) {
  return state.phase === PHASE.MATCH_OVER ? "finished" : "playing";
}

export function haitianOpeningOk(state) {
  if (state.rulesetId !== "haitian") return true;
  const id = HAITIAN_OPENING_TILE_ID;
  const inHands = (state.players ?? []).some((player) => player.hand?.includes(id));
  const inReserve = state.reserve?.includes(id);
  return inHands && !inReserve && state.mustPlayTileId === id;
}

export { PHASE, HAITIAN_OPENING_TILE_ID, getAvailableActions };
