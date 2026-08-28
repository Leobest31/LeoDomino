/**
 * Pure helpers for the live 1v1 online table.
 * Never reads game_secrets. Never treats Classic as a stored ruleset id.
 *
 * Authoritative interaction policy
 * --------------------------------
 * PUBLIC STATE (a Realtime `game_sessions` row may patch these):
 *   board, version, currentSeat, scores, phase, round, handCounts,
 *   reserveCount, spinner, lastPlay*, roundResult, matchWinnerSeat
 *
 * PRIVATE / INTERACTION STATE (only Edge viewer snapshots may set these):
 *   enterOnlineMatch / getGameView / submitGameAction / advanceOnlineRound
 *   → myHand, legalMoves, canPlay, canDraw, canPass, mustPlayTileId
 *
 * Ranking:
 *   1. Older versions never overwrite newer versions.
 *   2. Same version: a coherent viewer snapshot beats a public-only merge.
 *   3. Never derive legalMoves from a mismatched / stale myHand.
 *   4. Never keep opponent-turn canDraw / canPass after a version advance.
 *   5. Realtime is never the final interaction authority by itself.
 */
import { generateSet, indexTiles } from "../game/tiles.js";
import { getLegalMoves } from "../game/moves.js";
import { getAllFivesLegalMoves } from "../game/rules/allFivesSpinner.js";
import { isAutoPlaceable, legalEndsForTile, resolvePlayChoice } from "../game/interaction.js";
import { destinationTileId } from "../game/destinationTarget.js";
import { FIND_MATCH_RULESET_IDS, styleIdFromRulesetId } from "./matchmaking.js";
import { HAITIAN_OPENING_TILE_ID } from "../game/rules/haitianStart.js";

export const ONLINE_SESSION_KEY = "leodomino.onlineMatch";
export const ONLINE_MODE = "online";
export const INTERACTION_SOURCE_VIEWER = "viewer";
export const INTERACTION_SOURCE_PUBLIC = "public";

const TILES_BY_ID = indexTiles(generateSet());
const ALLOWED_RULESETS = new Set(FIND_MATCH_RULESET_IDS);
const SECRET_KEYS = new Set([
  "engine_state",
  "engineState",
  "game_secrets",
  "gameSecrets",
  "seed",
  "deal_seed",
  "dealSeed",
  "reserve",
  "opponentHand",
  "opponent_hand",
  "players",
]);

export function lockedRulesetId(value) {
  if (typeof value !== "string" || !ALLOWED_RULESETS.has(value)) return null;
  return value;
}

export function assertNeverClassicRuleset(rulesetId) {
  if (rulesetId === "classic") {
    throw new Error("Classic must be stored as legacy");
  }
  return lockedRulesetId(rulesetId);
}

export function canEnterAcceptedMatch(match, playerId) {
  if (!match?.id || !playerId) return false;
  const seated = [match.host?.playerId, match.opponent?.playerId, match.playerA, match.playerB]
    .filter(Boolean);
  if (seated.length === 0) return true;
  return seated.includes(playerId);
}

export function persistOnlineSession(record, storage = globalThis.sessionStorage) {
  if (!storage || !record?.matchId) return;
  const rulesetId = lockedRulesetId(record.rulesetId);
  const payload = {
    matchId: record.matchId,
    ...(rulesetId ? { rulesetId } : {}),
  };
  storage.setItem(ONLINE_SESSION_KEY, JSON.stringify(payload));
}

export function readOnlineSession(storage = globalThis.sessionStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ONLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.matchId || typeof parsed.matchId !== "string") return null;
    return {
      matchId: parsed.matchId,
      rulesetId: lockedRulesetId(parsed.rulesetId),
    };
  } catch {
    return null;
  }
}

export function clearOnlineSession(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem?.(ONLINE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function sanitizeGameView(view, options = {}) {
  if (!view || typeof view !== "object") return null;
  const next = {};
  for (const [key, value] of Object.entries(view)) {
    if (SECRET_KEYS.has(key)) continue;
    next[key] = value;
  }
  next.myHand = Array.isArray(view.myHand) ? view.myHand.slice() : [];
  next.legalMoves = Array.isArray(view.legalMoves) ? view.legalMoves.slice() : [];
  next.board = Array.isArray(view.board) ? view.board.slice() : [];
  next.handCounts = Array.isArray(view.handCounts) ? view.handCounts.slice() : [0, 0];
  next.scores = Array.isArray(view.scores) ? view.scores.slice() : [0, 0];
  next.reserveCount = Number(view.reserveCount) || 0;
  next.rulesetId = lockedRulesetId(view.rulesetId);
  next.styleId = styleIdFromRulesetId(next.rulesetId);
  if ("reserve" in next) delete next.reserve;
  if ("seed" in next) delete next.seed;
  stampInteractionSource(next, view, options);
  return next;
}

function looksLikeEdgeViewer(view) {
  return (
    Array.isArray(view?.myHand) &&
    Array.isArray(view?.legalMoves) &&
    typeof view?.canPlay === "boolean" &&
    typeof view?.canDraw === "boolean" &&
    typeof view?.canPass === "boolean"
  );
}

function stampInteractionSource(next, source, options = {}) {
  const forcePublic = Boolean(options.asPublic);
  const forceViewer = Boolean(options.asViewer) && !forcePublic;
  if (forceViewer || (!forcePublic && source?.interactionSource === INTERACTION_SOURCE_VIEWER)) {
    next.interactionSource = INTERACTION_SOURCE_VIEWER;
    next.interactionVersion = viewVersion(next);
    return;
  }
  if (forcePublic || source?.interactionSource === INTERACTION_SOURCE_PUBLIC) {
    next.interactionSource = INTERACTION_SOURCE_PUBLIC;
    const stamped = Number(source?.interactionVersion);
    next.interactionVersion = Number.isInteger(stamped) ? stamped : -1;
    return;
  }
  if (looksLikeEdgeViewer(source)) {
    next.interactionSource = INTERACTION_SOURCE_VIEWER;
    next.interactionVersion = viewVersion(next);
    return;
  }
  next.interactionSource = INTERACTION_SOURCE_PUBLIC;
  next.interactionVersion = -1;
}

/** Tag an Edge enter / getGameView / action payload as the interaction authority. */
export function asViewerSnapshot(view) {
  return sanitizeGameView(view, { asViewer: true });
}

export function viewVersion(view) {
  const n = Number(view?.version);
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

export function tableEpochFromView(view) {
  if (!view?.matchId) return "none";
  return roundIdentityFromView(view);
}

/** Authoritative round identity: match + round number (not phase, not version). */
export function roundIdentityFromView(view) {
  if (!view?.matchId) return "none";
  return `${view.matchId}:${Number(view.round) || 0}`;
}

export function boardIdSignature(board) {
  if (!Array.isArray(board) || board.length === 0) return "";
  return board
    .map((tile) => (typeof tile === "string" ? tile : tile?.id))
    .filter(Boolean)
    .join(",");
}

/**
 * Once the authoritative round number increases, the previous chain is dead.
 * An omitted/empty public board, or a public board whose tile ids are still
 * the completed previous chain, must render as empty.
 */
function emptySpinner() {
  return { id: null, north: [], south: [] };
}

export function tableForNextRound(previous, incomingBoard, incomingSpinner) {
  const incoming = Array.isArray(incomingBoard) ? incomingBoard : [];
  const prevSig = boardIdSignature(previous?.board);
  const nextSig = boardIdSignature(incoming);
  const leftoverPreviousChain = Boolean(prevSig) && nextSig === prevSig;
  if (incoming.length === 0 || leftoverPreviousChain) {
    return { board: [], spinner: emptySpinner() };
  }
  return {
    board: incoming,
    spinner:
      incomingSpinner && typeof incomingSpinner === "object"
        ? incomingSpinner
        : emptySpinner(),
  };
}

/** True when public/viewer state has moved past the completed round. */
export function didAuthoritativeRoundAdvance(previous, incoming) {
  if (!previous || !incoming) return false;
  if (incoming.round != null && Number(incoming.round) > Number(previous.round || 0)) {
    return true;
  }
  if (
    isRoundOverView(previous) &&
    !isRoundOverView(incoming) &&
    !isMatchOverView(incoming) &&
    (incoming.phase === "playing" || incoming.status === "playing") &&
    (incoming.round == null || Number(incoming.round) >= Number(previous.round || 0))
  ) {
    return true;
  }
  return false;
}

/**
 * Drop a completed-round chain that Realtime/SQL leftover tries to reattach
 * after this client already has the next round's empty table.
 */
export function sealRoundTable(previous, incoming) {
  if (!incoming) return incoming;
  if (didAuthoritativeRoundAdvance(previous, incoming)) {
    const table = tableForNextRound(previous, incoming.board, incoming.spinner);
    return { ...incoming, board: table.board, spinner: table.spinner };
  }
  if (
    previous &&
    Number(incoming.round) === Number(previous.round) &&
    Array.isArray(previous.board) &&
    previous.board.length === 0 &&
    Array.isArray(incoming.board) &&
    incoming.board.length > 0 &&
    viewVersion(incoming) <= viewVersion(previous)
  ) {
    return { ...incoming, board: [], spinner: emptySpinner() };
  }
  return incoming;
}

export function viewerHandMatchesCounts(view) {
  const seat = Number(view?.viewerSeat);
  if (!Number.isInteger(seat) || seat < 0) return true;
  const expected = view?.handCounts?.[seat];
  if (expected == null || !Array.isArray(view?.myHand)) return true;
  return view.myHand.length === Number(expected);
}

export function interactionQuality(view) {
  if (!view) return 0;
  let score = 0;
  if (view.interactionSource === INTERACTION_SOURCE_VIEWER) score += 100;
  if (viewVersion(view) === Number(view.interactionVersion)) score += 40;
  if (viewerHandMatchesCounts(view)) score += 20;
  if (Array.isArray(view.legalMoves) && view.legalMoves.length > 0) score += 8;
  if (view.canPlay || view.canDraw || view.canPass) score += 4;
  if (view.mustPlayTileId) score += 2;
  return score;
}

/** Same-version ranking: a coherent viewer snapshot beats a public-only merge. */
export function isFullerViewerSnapshot(candidate, current) {
  if (!candidate || !current) return false;
  if (viewVersion(candidate) !== viewVersion(current)) return false;
  return interactionQuality(candidate) > interactionQuality(current);
}

/**
 * True when `candidate` should replace `current` as the live/pending snapshot.
 * Older versions never win. Same-version public merges lose to a fuller viewer.
 */
export function isBetterAuthoritativeView(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const nextV = viewVersion(candidate);
  const prevV = viewVersion(current);
  if (nextV < prevV) return false;
  if (nextV > prevV) return true;
  return isFullerViewerSnapshot(candidate, current);
}

export function keepAuthoritativeView(previous, next, options = {}) {
  const clean = sanitizeGameView(next);
  if (!clean || !clean.matchId) return previous ?? null;
  if (previous?.matchId && previous.matchId === clean.matchId) {
    const prevVersion = viewVersion(previous);
    const nextVersion = viewVersion(clean);
    if (prevVersion >= 0 && nextVersion < prevVersion) return previous;
    const sealed = sealRoundTable(previous, clean);
    clean.board = sealed.board;
    clean.spinner = sealed.spinner;
    if (prevVersion >= 0 && nextVersion === prevVersion) {
      if (isFullerViewerSnapshot(previous, clean) && !isFullerViewerSnapshot(clean, previous)) {
        return previous;
      }
      if (options.preferIncoming) return clean;
      if (isFullerViewerSnapshot(clean, previous)) return clean;
      return previous;
    }
  }
  return clean;
}

/** Flush a deferred view when it is newer, or a same-version fuller server hand. */
export function shouldFlushPendingView(current, pending) {
  return isBetterAuthoritativeView(pending, current);
}

/** Clear submittingMove when realtime/action already advanced past the in-flight base. */
export function shouldReleaseBusy(inFlightBaseVersion, appliedView) {
  if (!Number.isInteger(inFlightBaseVersion) || inFlightBaseVersion < 0) return false;
  return viewVersion(appliedView) > inFlightBaseVersion;
}

export function isRoundOverView(view) {
  if (!view) return false;
  if (view.phase === "matchOver" || view.status === "match_over") return false;
  return view.phase === "roundOver" || view.status === "round_over";
}

export function isMatchOverView(view) {
  return view?.phase === "matchOver" || view?.status === "match_over";
}

/**
 * Server forfeit RPC fields patched onto the live viewer so both seats can
 * open the result report without inventing a winner locally.
 */
export function applyForfeitTerminalFields(view, result) {
  if (!view || typeof view !== "object") return view ?? null;
  const winnerSeat = Number(result?.winnerSeat);
  if (winnerSeat !== 0 && winnerSeat !== 1) return view;
  const forfeitSeat =
    result?.forfeitSeat === 0 || result?.forfeitSeat === 1
      ? result.forfeitSeat
      : winnerSeat === 0
        ? 1
        : 0;
  return {
    ...view,
    phase: "matchOver",
    status: "match_over",
    matchWinnerSeat: winnerSeat,
    roundResult: {
      reason: "forfeit",
      forfeitSeat,
      winnerIndex: winnerSeat,
    },
  };
}

export function occupancyTouchMissed(result) {
  return Boolean(result) && result.touched === false;
}

/**
 * Realtime is public-only. Fetch Edge getGameView only when the merged
 * snapshot is not already a coherent viewer for this version.
 * Skip the echo fetch when our in-flight HTTP action will supply that viewer.
 * Terminal forfeit/match-over must never skip the viewer refresh.
 */
export function shouldRefreshViewerAfterRealtime(previous, merged, options = {}) {
  if (!merged) return false;
  if (isMatchOverView(merged) && !isMatchOverView(previous)) return true;
  if (hasCoherentInteraction(merged)) return false;
  const nextV = viewVersion(merged);
  const prevV = viewVersion(previous);
  if (nextV < prevV) return false;
  const inFlightBase = options.inFlightBaseVersion;
  if (
    options.busy &&
    Number.isInteger(inFlightBase) &&
    inFlightBase >= 0 &&
    nextV === inFlightBase + 1
  ) {
    return false;
  }
  return nextV > prevV;
}

/**
 * Visual-only preview of a play the viewer already chose from server legalMoves.
 * Does not run the engine. North/south spinner branches are hide-from-hand only
 * so we never invent a main-chain placement.
 */
export function optimisticPlayPreview(move) {
  if (!move?.tileId) return null;
  const end = move.end || move.destination;
  if (end === "north" || end === "south") {
    return { tileId: move.tileId, hideOnly: true };
  }
  if (move.left == null || move.right == null || !move.orientation) return { tileId: move.tileId, hideOnly: true };
  return {
    tileId: move.tileId,
    hideOnly: false,
    tile: {
      id: move.tileId,
      left: move.left,
      right: move.right,
      orientation: move.orientation,
      destination: move.destination ?? end ?? null,
    },
  };
}

export const ONLINE_ACTION_TIMEOUT_MS = 15000;

/**
 * Why a hand tile cannot start an online drag. "ok" means pointerdown may capture.
 * Does not bypass engine legalMoves — empty ends are not draggable.
 */
export function onlineDragGate({ isHumanTurn, busy, legalMoves, tileId } = {}) {
  if (!isHumanTurn) return "not_turn";
  if (busy) return "busy";
  if (!tileId) return "not_legal";
  if (!legalEndsForTile(legalMoves ?? [], tileId).length) return "not_legal";
  return "ok";
}

export function layoutFromView(view) {
  return {
    board: boardTilesFromView(view),
    spinnerId: view?.spinner?.id ?? null,
    spinnerNorth: view?.spinner?.north ?? [],
    spinnerSouth: view?.spinner?.south ?? [],
    rulesetId: view?.rulesetId || "",
  };
}

export function isViewerTurn(view) {
  if (!view) return false;
  const seat = Number(view.viewerSeat);
  const current = Number(view.currentSeat);
  if (!Number.isInteger(seat) || !Number.isInteger(current) || seat !== current) return false;
  return view.phase === "playing" || view.status === "playing";
}

/** Private interaction fields belong to this public version and came from Edge. */
export function hasCoherentInteraction(view) {
  if (!view) return false;
  if (view.interactionSource !== INTERACTION_SOURCE_VIEWER) return false;
  if (viewVersion(view) !== Number(view.interactionVersion)) return false;
  return viewerHandMatchesCounts(view);
}

/**
 * Safe to enable drag / draw / pass / "Your turn".
 * Public-only Realtime must not claim a turn while legalMoves/canDraw/canPass are stale.
 */
export function isInteractableTurn(view) {
  return isViewerTurn(view) && hasCoherentInteraction(view);
}

export function publicPlayedTileIds(view) {
  const ids = new Set();
  const take = (tile) => {
    const id = typeof tile === "string" ? tile : tile?.id;
    if (id) ids.add(id);
  };
  for (const tile of view?.board ?? []) take(tile);
  for (const tile of view?.spinner?.north ?? []) take(tile);
  for (const tile of view?.spinner?.south ?? []) take(tile);
  if (view?.spinner?.id) ids.add(view.spinner.id);
  return ids;
}

/** Drop tiles already on the public board from a stale pre-play myHand when counts then match. */
export function reconcileViewerHand(myHand, view) {
  if (!Array.isArray(myHand)) return myHand;
  const played = publicPlayedTileIds(view);
  if (!played.size) return myHand.slice();
  const next = myHand.filter((id) => !played.has(typeof id === "string" ? id : id?.id));
  const expected = view?.handCounts?.[Number(view?.viewerSeat)];
  if (expected == null || next.length === Number(expected)) return next;
  return myHand.slice();
}

/**
 * Restore interaction from a consistent viewer hand when the snapshot omitted
 * legalMoves (SQL-shaped views). Not used as the live Realtime authority —
 * Edge getGameView / action results stamp interactionSource=viewer instead.
 */
export function hydrateViewerInteraction(view) {
  if (!view || typeof view !== "object") return view;
  const next = { ...view };
  if (
    next.rulesetId === "haitian" &&
    !(next.board && next.board.length) &&
    !next.mustPlayTileId &&
    (next.myHand ?? []).includes(HAITIAN_OPENING_TILE_ID) &&
    isViewerTurn(next)
  ) {
    next.mustPlayTileId = HAITIAN_OPENING_TILE_ID;
  }
  if (!isViewerTurn(next) || !viewerHandMatchesCounts(next)) return next;
  if (Array.isArray(next.legalMoves) && next.legalMoves.length > 0) {
    next.canPlay = true;
    return next;
  }
  const moves = legalMovesForPublicView(next);
  if (!moves.length) return next;
  next.legalMoves = moves;
  next.canPlay = true;
  next.canDraw = false;
  next.canPass = false;
  return next;
}

export function legalMovesForPublicView(view) {
  if (!isViewerTurn(view)) return [];
  if (!viewerHandMatchesCounts(view)) return [];
  const hand = view.myHand ?? [];
  const board = view.board ?? [];
  try {
    let moves;
    if (view.rulesetId === "american") {
      try {
        moves = getAllFivesLegalMoves(hand, {
          board,
          spinnerId: view.spinner?.id ?? null,
          spinnerNorth: view.spinner?.north ?? [],
          spinnerSouth: view.spinner?.south ?? [],
          byId: TILES_BY_ID,
          rulesetId: "american",
        });
      } catch {
        moves = getLegalMoves(hand, board, TILES_BY_ID);
      }
    } else {
      moves = getLegalMoves(hand, board, TILES_BY_ID);
    }
    if (view.mustPlayTileId) {
      moves = moves.filter((move) => move.tileId === view.mustPlayTileId);
    }
    return moves;
  } catch {
    return [];
  }
}

export function draggableTileIds(view, { busy = false } = {}) {
  if (busy || !isInteractableTurn(view)) return [];
  const ids = [];
  for (const move of view?.legalMoves ?? []) {
    if (move?.tileId && !ids.includes(move.tileId)) ids.push(move.tileId);
  }
  return ids;
}

export function opponentHandCount(view) {
  const rival = view?.viewerSeat === 0 ? 1 : 0;
  return Number(view?.handCounts?.[rival]) || 0;
}

/**
 * When left and right are both legal but they are the same physical tile
 * (opening double 6-6), either end is a valid play. Do not leave the player
 * stuck needing a destination the UI cannot distinguish.
 */
export function equivalentPlayEnd(legalMoves, tileId, layout) {
  if (isAutoPlaceable(legalMoves, tileId)) {
    return resolvePlayChoice(legalMoves, tileId)?.end ?? null;
  }
  const ends = legalEndsForTile(legalMoves, tileId);
  if (!ends.length) return null;
  if (ends.length === 1) return ends[0];
  const ids = ends.map((end) => destinationTileId(end, layout));
  if (!ids[0] || ids.some((id) => id !== ids[0])) return null;
  const preferred = ends.includes("right") ? "right" : ends[0];
  return resolvePlayChoice(legalMoves, tileId, preferred)?.end ?? preferred;
}

function asInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asJsonValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function publicSessionFromRealtime(payload) {
  const row = payload?.new ?? payload?.record ?? null;
  if (!row || typeof row !== "object") return null;
  const version = asInteger(row.version);
  if (version == null || version < 0) return null;
  const board = asJsonArray(row.board);
  const spinner = asJsonValue(row.spinner);
  return {
    version,
    currentSeat: asInteger(row.current_seat ?? row.currentSeat),
    round: asInteger(row.round) ?? undefined,
    phase: row.phase,
    status: row.status,
    scores: asJsonArray(row.scores),
    board,
    spinner,
    lastPlayPoints: row.last_play_points ?? row.lastPlayPoints,
    lastPlayPointsSeat: row.last_play_points_seat ?? row.lastPlayPointsSeat,
    lastPlayScoreTerminals: asJsonValue(
      row.last_play_score_terminals ?? row.lastPlayScoreTerminals
    ),
    reserveCount: row.reserve_count ?? row.reserveCount,
    handCounts: asJsonArray(row.hand_counts ?? row.handCounts),
    roundResult: asJsonValue(row.round_result ?? row.roundResult),
    matchWinnerSeat: row.match_winner_seat ?? row.matchWinnerSeat,
  };
}

export function mergeRealtimeSessionView(previous, payload) {
  const pub = publicSessionFromRealtime(payload);
  if (!previous?.matchId || !pub) return previous ?? null;
  if (viewVersion(pub) < viewVersion(previous)) return previous;
  const versionAdvanced = viewVersion(pub) > viewVersion(previous);
  const roundAdvanced = didAuthoritativeRoundAdvance(previous, pub);
  const nextTable = roundAdvanced
    ? tableForNextRound(previous, pub.board, pub.spinner)
    : viewVersion(pub) <= viewVersion(previous) &&
        Array.isArray(previous.board) &&
        previous.board.length === 0 &&
        Array.isArray(pub.board) &&
        pub.board.length > 0
      ? { board: [], spinner: previous.spinner ?? emptySpinner() }
      : {
          board: pub.board ?? previous.board,
          spinner: pub.spinner === undefined ? previous.spinner : pub.spinner,
        };
  const merged = {
    ...previous,
    version: pub.version,
    currentSeat: pub.currentSeat ?? previous.currentSeat,
    round: pub.round ?? (roundAdvanced ? Number(previous.round || 0) + 1 : previous.round),
    phase: pub.phase || previous.phase,
    status: pub.status || previous.status,
    scores: pub.scores ?? previous.scores,
    board: nextTable.board,
    spinner: nextTable.spinner,
    lastPlayPoints: roundAdvanced
      ? pub.lastPlayPoints ?? 0
      : pub.lastPlayPoints ?? previous.lastPlayPoints,
    lastPlayPointsSeat:
      pub.lastPlayPointsSeat === undefined
        ? roundAdvanced
          ? null
          : previous.lastPlayPointsSeat
        : pub.lastPlayPointsSeat,
    lastPlayScoreTerminals: roundAdvanced
      ? pub.lastPlayScoreTerminals ?? []
      : pub.lastPlayScoreTerminals ?? previous.lastPlayScoreTerminals,
    reserveCount: pub.reserveCount ?? previous.reserveCount,
    handCounts: pub.handCounts ?? previous.handCounts,
    roundResult:
      pub.roundResult === undefined
        ? roundAdvanced
          ? null
          : previous.roundResult
        : pub.roundResult,
    matchWinnerSeat:
      pub.matchWinnerSeat === undefined
        ? previous.matchWinnerSeat
        : pub.matchWinnerSeat,
    myHand: roundAdvanced
      ? []
      : Array.isArray(previous.myHand)
        ? previous.myHand.slice()
        : [],
    viewerSeat: previous.viewerSeat,
    matchId: previous.matchId,
    rulesetId: previous.rulesetId,
  };
  if (!versionAdvanced) {
    merged.legalMoves = Array.isArray(previous.legalMoves) ? previous.legalMoves.slice() : [];
    merged.canPlay = previous.canPlay;
    merged.canDraw = previous.canDraw;
    merged.canPass = previous.canPass;
    merged.mustPlayTileId = previous.mustPlayTileId ?? null;
    merged.interactionSource = previous.interactionSource;
    merged.interactionVersion = previous.interactionVersion;
    return sanitizeGameView(merged);
  }
  // Newer public row: patch public fields only. Do not fabricate private
  // legalMoves / canDraw / canPass from a possibly stale myHand.
  merged.legalMoves = [];
  merged.canPlay = false;
  merged.canDraw = false;
  merged.canPass = false;
  merged.mustPlayTileId = null;
  merged.interactionSource = INTERACTION_SOURCE_PUBLIC;
  merged.interactionVersion = Number(previous.interactionVersion);
  if (!Number.isInteger(merged.interactionVersion)) merged.interactionVersion = -1;
  return sanitizeGameView(merged, { asPublic: true });
}

export function tileFaceFromId(id) {
  const tile = TILES_BY_ID[id];
  if (!tile) return null;
  return { id, left: tile.a, right: tile.b };
}

export function handTilesFromView(view) {
  return (view?.myHand ?? []).map((id) => tileFaceFromId(id)).filter(Boolean);
}

export function boardTilesFromView(view) {
  return (view?.board ?? []).map((tile) => ({
    id: tile.id,
    left: tile.left,
    right: tile.right,
    orientation: tile.orientation,
    destination: tile.destination ?? null,
    branch: tile.branch ?? tile.destination ?? null,
  }));
}

export function opaqueReserveIds(count) {
  const n = Math.max(0, Number(count) || 0);
  return Array.from({ length: n }, (_, index) => `online-reserve-${index}`);
}

export function isRealtimeSessionEvent(payload) {
  const table = payload?.table || payload?.filter?.table;
  if (table && table !== "game_sessions") return false;
  if (payload?.table === "game_secrets") return false;
  return true;
}

export function onlineErrorKey(error) {
  switch (error?.code) {
    case "NOT_A_PLAYER":
    case "MATCH_NOT_ELIGIBLE":
      return "online.notEligible";
    case "MATCH_NOT_FOUND":
    case "NO_SESSION":
      return "online.notFound";
    case "AUTH_REQUIRED":
    case "AUTH":
      return "online.auth";
    case "STALE_VERSION":
      return "online.stale";
    case "WRONG_TURN":
      return "online.wrongTurn";
    case "PASS_NOT_ALLOWED":
      return "online.passRejected";
    case "DRAW_NOT_ALLOWED":
    case "CLIENT_TILE_ID_FORBIDDEN":
      return "online.drawRejected";
    case "ILLEGAL_TILE":
    case "ILLEGAL_PLACEMENT":
      return "online.playRejected";
    case "ADVANCE_NOT_ALLOWED":
      return "online.advanceRejected";
    case "FORFEIT_FAILED":
    case "ABORT_FAILED":
      return "online.forfeitFailed";
    default:
      return "online.error";
  }
}
