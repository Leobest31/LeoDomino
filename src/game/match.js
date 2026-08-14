/**
 * Match state factory and pure engine actions (place / draw).
 * No scoring, turn enforcement, or round lifecycle — that is Phase 4.
 */

import { DEFAULT_PLAYER_COUNT, END, HAND_SIZE } from "./constants.js";
import { createBoard, getOpenEnds, placeTile } from "./board.js";
import { createShuffledDeck, deal } from "./deck.js";
import { findLegalMove, getLegalMoves, hasLegalMove } from "./moves.js";
import {
  emptySpinnerState,
  getAmericanLegalMoves,
  placeAmericanTile,
  readSpinnerState,
} from "./rules/americanSpinner.js";
import { resolveRuleset } from "./rulesets/index.js";

function usesSpinner(match) {
  try {
    return Boolean(resolveRuleset(match?.rulesetId).usesSpinner);
  } catch {
    return false;
  }
}

/**
 * @typedef {object} PlayerState
 * @property {string} id
 * @property {string[]} hand
 */

/**
 * @typedef {object} MatchState
 * @property {number} seed
 * @property {Record<string, object>} byId
 * @property {PlayerState[]} players
 * @property {string[]} reserve
 * @property {object[]} board
 * @property {string} [rulesetId]
 */

/**
 * Create a fresh deal: shuffled set, 7 tiles each, remainder in reserve, empty board.
 *
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.playerCount=2]
 * @param {number} [options.handSize=7]
 * @param {string[]} [options.playerIds]
 * @param {string} [options.rulesetId]
 * @returns {MatchState}
 */
export function createMatch(options = {}) {
  const playerCount = options.playerCount ?? DEFAULT_PLAYER_COUNT;
  const handSize = options.handSize ?? HAND_SIZE;
  const seed = options.seed ?? Date.now();

  const { tiles, seed: usedSeed } = createShuffledDeck(seed);
  const { hands, reserve, byId } = deal(tiles, { playerCount, handSize });

  const playerIds =
    options.playerIds ??
    Array.from({ length: playerCount }, (_, index) => `player-${index + 1}`);

  if (playerIds.length !== playerCount) {
    throw new Error("playerIds length must match playerCount");
  }

  /** @type {MatchState} */
  const match = {
    seed: usedSeed,
    byId,
    players: playerIds.map((id, index) => ({
      id,
      hand: hands[index].slice(),
    })),
    reserve: reserve.slice(),
    board: createBoard(),
    ...emptySpinnerState(),
  };

  if (typeof options.rulesetId === "string" && options.rulesetId) {
    match.rulesetId = options.rulesetId;
  }

  return match;
}

/**
 * Snapshot open ends for UI / AI consumers.
 * @param {MatchState} match
 */
export function readOpenEnds(match) {
  return getOpenEnds(match.board);
}

/**
 * Legal moves for a player index.
 * @param {MatchState} match
 * @param {number} playerIndex
 */
export function listLegalMoves(match, playerIndex) {
  const player = match.players[playerIndex];
  if (!player) {
    throw new Error(`Invalid playerIndex: ${playerIndex}`);
  }
  if (usesSpinner(match)) {
    return getAmericanLegalMoves(player.hand, match);
  }
  return getLegalMoves(player.hand, match.board, match.byId);
}

/**
 * Place a tile from a player's hand onto a board end.
 * Returns a new match state; does not mutate the input.
 *
 * @param {MatchState} match
 * @param {number} playerIndex
 * @param {string} tileId
 * @param {"left"|"right"} [end="right"]
 * @returns {MatchState}
 */
export function applyPlace(match, playerIndex, tileId, end = END.RIGHT) {
  const player = match.players[playerIndex];
  if (!player) {
    throw new Error(`Invalid playerIndex: ${playerIndex}`);
  }

  if (!player.hand.includes(tileId)) {
    throw new Error(`Player ${player.id} does not hold tile ${tileId}`);
  }

  const nextPlayers = match.players.map((entry, index) => {
    if (index !== playerIndex) return entry;
    return {
      ...entry,
      hand: entry.hand.filter((id) => id !== tileId),
    };
  });

  if (usesSpinner(match)) {
    const legalMoves = getAmericanLegalMoves(player.hand, match);
    let chosen = legalMoves.find((m) => m.tileId === tileId && m.end === end);
    if (!chosen && match.board.length === 0) {
      chosen = legalMoves.find((m) => m.tileId === tileId) ?? null;
    }
    if (!chosen) {
      throw new Error(`Illegal placement: ${tileId} on ${end}`);
    }
    const tile = match.byId[tileId];
    const placed = placeAmericanTile(match, tile, chosen.end);
    return {
      ...match,
      players: nextPlayers,
      board: placed.board,
      spinnerId: placed.spinnerId,
      spinnerNorth: placed.spinnerNorth,
      spinnerSouth: placed.spinnerSouth,
    };
  }

  const legal = findLegalMove(player.hand, match.board, match.byId, tileId, end);
  if (!legal) {
    // Opening moves are stored as end "right"; accept left as alias on empty board.
    if (match.board.length === 0 && end === END.LEFT) {
      return applyPlace(match, playerIndex, tileId, END.RIGHT);
    }
    throw new Error(`Illegal placement: ${tileId} on ${end}`);
  }

  const tile = match.byId[tileId];
  const nextBoard = placeTile(match.board, tile, legal.end);
  const spin = readSpinnerState(match);

  return {
    ...match,
    players: nextPlayers,
    board: nextBoard,
    spinnerId: spin.spinnerId,
    spinnerNorth: spin.spinnerNorth,
    spinnerSouth: spin.spinnerSouth,
  };
}

/**
 * Draw the top tile from the reserve into a player's hand.
 * Returns null if the reserve is empty; otherwise a new match state.
 *
 * @param {MatchState} match
 * @param {number} playerIndex
 * @returns {MatchState|null}
 */
export function applyDraw(match, playerIndex) {
  if (!match.reserve.length) {
    return null;
  }

  const player = match.players[playerIndex];
  if (!player) {
    throw new Error(`Invalid playerIndex: ${playerIndex}`);
  }

  const [drawnId, ...rest] = match.reserve;

  const nextPlayers = match.players.map((entry, index) => {
    if (index !== playerIndex) return entry;
    return {
      ...entry,
      hand: [...entry.hand, drawnId],
    };
  });

  return {
    ...match,
    players: nextPlayers,
    reserve: rest,
  };
}

/**
 * Convenience: whether a player currently has a legal placement.
 * @param {MatchState} match
 * @param {number} playerIndex
 */
export function playerHasLegalMove(match, playerIndex) {
  const player = match.players[playerIndex];
  if (!player) {
    throw new Error(`Invalid playerIndex: ${playerIndex}`);
  }
  if (usesSpinner(match)) {
    return getAmericanLegalMoves(player.hand, match).length > 0;
  }
  return hasLegalMove(player.hand, match.board, match.byId);
}

/**
 * Deep-enough clone for persistence / tests (structuredClone when available).
 * @param {MatchState} match
 * @returns {MatchState}
 */
export function cloneMatch(match) {
  if (typeof structuredClone === "function") {
    return structuredClone(match);
  }
  return JSON.parse(JSON.stringify(match));
}
