/**
 * All Fives count scoring.
 *
 * LIVE PLAY (this module's scorePlay path):
 *   post-move topology → getCurrentTerminalEnds() → exact terminal sum
 *   award that sum only when exactTotal >= 10 and exactTotal % 5 === 0.
 *   A live total of 5 is NOT a table score. No rounding.
 *   5 → 0, 8 → 0, 10 → +10, 13 → 0, 15 → +15.
 *
 * ROUND END (calculateAllFivesRoundPoints only):
 *   opponents' remaining hand pips, then roundToNearestFive.
 *   That rounding function is never used by live play, and live play may
 *   still produce a 5 at round-end (hand pips). The two pipelines stay apart.
 */

import { getCurrentTerminalEnds } from "./allFivesSpinner.js";
import { ROUND_END_REASON } from "./constants.js";

/** Cumulative match target for All Fives. */
export const ALL_FIVES_MATCH_TARGET = 200;

function tableTileIds(board, north, south) {
  const ids = [];
  for (const tile of board || []) {
    if (tile?.id) ids.push(tile.id);
  }
  for (const tile of north || []) {
    if (tile?.id) ids.push(tile.id);
  }
  for (const tile of south || []) {
    if (tile?.id) ids.push(tile.id);
  }
  return ids;
}

function awardFromExactTotal(exactTotal) {
  return exactTotal >= 10 && exactTotal % 5 === 0 ? exactTotal : 0;
}

/**
 * Visual highlight records — the SAME terminals that produced the award.
 * Empty when award is 0. Contributions must sum to awarded.
 *
 * @param {ReturnType<typeof explainAllFivesScore>} report
 * @returns {object[]}
 */
export function scoringHighlightsFromReport(report) {
  if (!report || !(Number(report.awarded) > 0)) return [];
  const highlights = (report.terminals || [])
    .filter((end) => Number(end.contribution) > 0)
    .map((end) => ({
    branch: end.branch,
    sourceTileId: end.sourceTileId,
    scoringSide: end.scoringSide,
    scoringSides: Array.isArray(end.scoringSides)
      ? end.scoringSides.slice()
      : end.scoringSide === "both"
        ? ["left", "right"]
        : [end.scoringSide ?? end.sourcePort],
    contribution: end.contribution,
  }));
  const sum = highlights.reduce(
    (total, item) => total + (Number(item.contribution) || 0),
    0
  );
  if (sum !== report.awarded) {
    throw new Error(
      `Highlight contributions ${sum} must equal awarded ${report.awarded}`
    );
  }
  return highlights;
}

/**
 * Sum of currently exposed terminal chain ends.
 * Derived only from getCurrentTerminalEnds (post-move topology).
 *
 * @param {object[]|object} board - board array, or a state object with spinner arms
 * @param {object} [layout] - optional { spinnerId, spinnerNorth, spinnerSouth }
 * @returns {number}
 */
export function exposedEndTotal(board, layout) {
  return explainAllFivesScore(
    board && !Array.isArray(board) && typeof board === "object"
      ? board
      : { board, ...layout }
  ).exactTotal;
}

/**
 * Inspectable live-scoring report from post-move topology.
 *
 * `isOpening` is ignored. Opening and later plays use the same rule:
 * award the exact terminal total iff it is >= 10 and a multiple of 5.
 *
 * @param {object} options
 * @returns {{
 *   playedTile: string|null,
 *   selectedDestination: string|null,
 *   boardTileIds: string[],
 *   terminals: object[],
 *   endpoints: object[],
 *   exactTotal: number,
 *   exposedTotal: number,
 *   qualifies: boolean,
 *   awarded: number,
 *   pointsAwarded: number
 * }}
 */
export function explainAllFivesScore(options = {}) {
  const raw = options.board;
  const fromState = Boolean(raw && !Array.isArray(raw) && typeof raw === "object");
  const boardTiles = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.board)
      ? raw.board
      : [];
  const spinnerId =
    options.spinnerId ?? (fromState ? raw.spinnerId : null) ?? null;
  const spinnerNorth =
    options.spinnerNorth ??
    (fromState ? raw.spinnerNorth : null) ??
    [];
  const spinnerSouth =
    options.spinnerSouth ??
    (fromState ? raw.spinnerSouth : null) ??
    [];
  const layout = {
    board: boardTiles,
    spinnerId,
    spinnerNorth,
    spinnerSouth,
  };
  const terminals = getCurrentTerminalEnds(layout);
  const boardTileIds = tableTileIds(boardTiles, spinnerNorth, spinnerSouth);
  for (const end of terminals) {
    if (!boardTileIds.includes(end.sourceTileId)) {
      throw new Error(
        `Scoring terminal ${end.sourceTileId} is not on the post-move board`
      );
    }
  }
  const exactTotal = terminals.reduce((sum, end) => sum + end.contribution, 0);
  const awarded = awardFromExactTotal(exactTotal);
  const endpoints = terminals.map((end) => ({
    ...end,
    branch: end.port,
  }));
  return {
    playedTile: options.tileId ?? null,
    selectedDestination: options.end ?? null,
    boardTileIds,
    terminals,
    endpoints,
    exactTotal,
    exposedTotal: exactTotal,
    qualifies: awarded > 0,
    awarded,
    liveAward: awarded,
    pointsAwarded: awarded,
    highlights: scoringHighlightsFromReport({
      terminals,
      awarded,
    }),
  };
}

/**
 * Inspectable scoring dump for tests / development. Not used in production UI.
 *
 * @param {ReturnType<typeof explainAllFivesScore>} report
 * @returns {string}
 */
export function formatAllFivesScoreReport(report) {
  const dest = report.selectedDestination ? ` @ ${report.selectedDestination}` : "";
  const lines = [`MOVE: ${report.playedTile ?? "?"}${dest}`, "TERMINALS:"];
  const rows = report.terminals?.length ? report.terminals : report.endpoints;
  if (!rows?.length) {
    lines.push("  (none)");
  } else {
    for (const end of rows) {
      const label = end.branch;
      const extra = end.type === "terminal-double" && end.values
        ? ` [${end.values.join("+")}]`
        : "";
      lines.push(`  ${label}: ${end.contribution ?? end.value}${extra}`);
    }
  }
  lines.push(`EXACT TOTAL: ${report.exactTotal ?? report.exposedTotal}`);
  lines.push(`EXPOSED TOTAL: ${report.exposedTotal}`);
  lines.push(`QUALIFIES: ${report.qualifies ? "yes" : "no"}`);
  lines.push(`POINTS: ${report.awarded ?? report.pointsAwarded}`);
  return lines.join("\n");
}

/**
 * Points awarded for a single play under All Fives live scoring.
 * Always uses the post-move board topology. Never uses hand/reserve tiles,
 * previous-move ends, visual layout, or round-end rounding.
 *
 * Award the exact terminal total if it is >= 10 and a multiple of 5; else 0.
 * Live 5 does not score. Round-end nearest-5 may still produce 5.
 */
export function scoreAllFivesPlay(options) {
  return explainAllFivesScore(options).awarded;
}

/**
 * Ruleset policy adapter — called after a successful place.
 *
 * @param {object} options
 * @param {object[]} options.board
 * @returns {number}
 */
export function allFivesScorePlay(options) {
  return scoreAllFivesPlay(options);
}

/**
 * Round a pip total to the nearest multiple of 5.
 * Used ONLY by round-end scoring. Live play must never call this.
 *
 * Non-positive / non-finite → 0. Standard half-up via Math.round:
 * 1–2→0, 3–7→5, 8–12→10, …
 *
 * @param {number} value
 * @returns {number}
 */
export function roundToNearestFive(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 5) * 5;
}

/**
 * Floor a value down to a multiple of 5. Never rounds up.
 * Used by All Fives blocked-round *tied* shares only.
 *
 * @param {number} value
 * @returns {number}
 */
export function roundDownToFive(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / 5) * 5;
}

function winnerSeatList(winnerIndex, winnerIndices, playerCount) {
  if (Array.isArray(winnerIndices) && winnerIndices.length) {
    const unique = [];
    for (const raw of winnerIndices) {
      const index = Math.floor(Number(raw));
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < playerCount &&
        !unique.includes(index)
      ) {
        unique.push(index);
      }
    }
    unique.sort((a, b) => a - b);
    return unique;
  }
  const single = Math.floor(Number(winnerIndex));
  if (Number.isInteger(single) && single >= 0 && single < playerCount) {
    return [single];
  }
  return [];
}

/**
 * Authoritative All Fives round-end breakdown. Same hands and award for
 * 2P, 3P, and 4P — player count only changes how many losing seats exist.
 *
 * @param {object} options
 * @param {number|null} [options.winnerIndex]
 * @param {number[]} [options.winnerIndices]
 * @param {{ id?: string, hand: string[] }[]} options.players
 * @param {Record<string, { a: number, b: number }>} options.byId
 * @param {string} [options.reason]
 * @returns {{
 *   winnerIndex: number|null,
 *   winnerIndices: number[],
 *   reason: string|null,
 *   hands: { playerIndex: number, tiles: { id: string, left: number, right: number, pips: number }[], raw: number }[],
 *   rawTotal: number,
 *   awarded: number
 * }}
 */
export function explainAllFivesRoundEnd({
  winnerIndex,
  winnerIndices,
  players = [],
  byId = {},
  reason = null,
} = {}) {
  /** @type {{ playerIndex: number, tiles: { id: string, left: number, right: number, pips: number }[], raw: number }[]} */
  const hands = [];
  const winners = winnerSeatList(
    winnerIndex,
    winnerIndices,
    Array.isArray(players) ? players.length : 0
  );
  if (winners.length === 0 || !Array.isArray(players)) {
    return {
      winnerIndex: winnerIndex ?? null,
      winnerIndices: winners,
      reason,
      hands,
      rawTotal: 0,
      awarded: 0,
    };
  }
  const winnerSet = new Set(winners);
  for (let i = 0; i < players.length; i += 1) {
    if (winnerSet.has(i)) continue;
    const ids = Array.isArray(players[i]?.hand) ? players[i].hand : [];
    const tiles = ids.map((id) => {
      const tile = byId[id];
      const left = Number(tile?.a) || 0;
      const right = Number(tile?.b) || 0;
      return { id, left, right, pips: left + right };
    });
    if (tiles.length === 0) continue;
    const raw = tiles.reduce((sum, tile) => sum + tile.pips, 0);
    hands.push({ playerIndex: i, tiles, raw });
  }
  const rawTotal = hands.reduce((sum, hand) => sum + hand.raw, 0);
  const awarded =
    reason === ROUND_END_REASON.BLOCKED && winners.length > 1
      ? roundDownToFive(rawTotal / winners.length)
      : roundToNearestFive(rawTotal);
  return {
    winnerIndex: winners.length === 1 ? winners[0] : null,
    winnerIndices: winners,
    reason,
    hands,
    rawTotal,
    awarded,
  };
}

/**
 * End-of-round All Fives award (domino-out or blocked).
 * Sum opponents' remaining pips, then round to nearest multiple of 5.
 */
export function calculateAllFivesRoundPoints(options) {
  return explainAllFivesRoundEnd(options).awarded;
}
