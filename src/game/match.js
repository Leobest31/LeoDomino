/**
 * Match state factory and pure engine actions (place / draw).
 * No scoring, turn enforcement, or round lifecycle — that is Phase 4.
 */

import { DEFAULT_PLAYER_COUNT, END, HAND_SIZE } from "./constants.js";
import { createBoard, getOpenEnds, placeTile } from "./board.js";
import { createShuffledDeck, deal } from "./deck.js";
import { findLegalMove, getLegalMoves } from "./moves.js";
import {
  getAllFivesLegalMoves,
  isSpinnerEnd,
  resolveSpinnerBranchPlacement,
  stampAllFivesSpinner,
  usesAllFivesSpinner,
} from "./rules/allFivesSpinner.js";
import {
  assertBoardTopology,
  buildBoardTopology,
  coercePlayEnd,
} from "./boardTopology.js";

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
    spinnerId: null,
    spinnerNorth: [],
    spinnerSouth: [],
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
  if (usesAllFivesSpinner(match)) {
    return getAllFivesLegalMoves(player.hand, match);
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

  const playEnd = coercePlayEnd(end);
  const tile = match.byId[tileId];
  const nextPlayers = match.players.map((entry, index) => {
    if (index !== playerIndex) return entry;
    return {
      ...entry,
      hand: entry.hand.filter((id) => id !== tileId),
    };
  });

  if (usesAllFivesSpinner(match) && isSpinnerEnd(playEnd)) {
    if (!match.spinnerId) {
      throw new Error(`Illegal placement: ${tileId} on ${playEnd} before first double`);
    }
    const legal = getAllFivesLegalMoves(player.hand, match).find(
      (move) => move.tileId === tileId && move.end === playEnd
    );
    if (!legal) {
      throw new Error(`Illegal placement: ${tileId} on ${playEnd}`);
    }
    const { pip, north, south } = {
      pip: match.byId[match.spinnerId]?.a,
      north: Array.isArray(match.spinnerNorth) ? match.spinnerNorth : [],
      south: Array.isArray(match.spinnerSouth) ? match.spinnerSouth : [],
    };
    const branch = playEnd === END.NORTH ? north : south;
    const attachPip = branch.length ? Number(branch[branch.length - 1].right) : Number(pip);
    const placed = resolveSpinnerBranchPlacement(tile, attachPip, playEnd);
    const nextNorth = playEnd === END.NORTH ? [...north, placed] : north.slice();
    const nextSouth = playEnd === END.SOUTH ? [...south, placed] : south.slice();
    const nextMatch = stampAllFivesSpinner(
      { ...match, players: nextPlayers },
      tile,
      match.board,
      legal,
      nextNorth,
      nextSouth
    );
    assertBoardTopology(buildBoardTopology(nextMatch));
    return nextMatch;
  }

  const legal = findLegalMove(player.hand, match.board, match.byId, tileId, playEnd);
  if (!legal) {
    // Opening moves are stored as end "right"; accept left as alias on empty board.
    if (match.board.length === 0 && playEnd === END.LEFT) {
      return applyPlace(match, playerIndex, tileId, END.RIGHT);
    }
    throw new Error(`Illegal placement: ${tileId} on ${playEnd}`);
  }

  const nextBoard = placeTile(match.board, tile, legal.end);
  let nextMatch = {
    ...match,
    players: nextPlayers,
    board: nextBoard,
  };

  // Visual/layout adapter only: the first double of the round is the
  // shared LeoDomino chain anchor. Does not change Classic/Haitian/etc.
  // legal-move topology (those rulesets do not read spinner North/South).
  if (!nextMatch.spinnerId && tile.isDouble) {
    nextMatch = {
      ...nextMatch,
      spinnerId: tile.id,
      spinnerNorth: Array.isArray(nextMatch.spinnerNorth)
        ? nextMatch.spinnerNorth
        : [],
      spinnerSouth: Array.isArray(nextMatch.spinnerSouth)
        ? nextMatch.spinnerSouth
        : [],
    };
  }

  if (usesAllFivesSpinner(match)) {
    nextMatch = stampAllFivesSpinner(
      nextMatch,
      tile,
      nextBoard,
      legal,
      Array.isArray(match.spinnerNorth) ? match.spinnerNorth : [],
      Array.isArray(match.spinnerSouth) ? match.spinnerSouth : []
    );
  }

  assertBoardTopology(buildBoardTopology(nextMatch));
  return nextMatch;
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
  return listLegalMoves(match, playerIndex).length > 0;
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
