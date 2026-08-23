/**
 * Canonical live scoring: current terminal chain ends only.
 * Run: node src/game/rules/allFivesTerminals.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { generateSet, indexTiles } from "../tiles.js";
import { createBoard } from "../board.js";
import { BRANCH } from "../boardTopology.js";
import { END } from "../constants.js";
import { PHASE } from "./constants.js";
import {
  explainAllFivesScore,
  formatAllFivesScoreReport,
  scoreAllFivesPlay,
} from "./allFivesScoring.js";
import {
  SPINNER_NORTH,
  getAllFivesLegalMoves,
  getCurrentTerminalEnds,
  shouldShowPlayScorePopup,
} from "./allFivesSpinner.js";
import { playTile } from "./drawDominoes.js";
import { ALL_FIVES_RULESET_ID } from "../rulesets/allFives.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function spin(pip) {
  return { id: `${pip}-${pip}`, left: pip, right: pip };
}

function explain(board, extra = {}) {
  return explainAllFivesScore({ board, ...extra });
}

function byBranch(rep) {
  return Object.fromEntries(
    (rep.terminals || []).map((end) => [end.branch, end.contribution])
  );
}

function assertOnBoard(rep) {
  for (const end of rep.terminals) {
    assert.equal(
      rep.boardTileIds.includes(end.sourceTileId),
      true,
      `${end.sourceTileId} must be on the post-move table`
    );
  }
}

function allFivesState(overrides = {}) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [
      { id: "a", hand: [] },
      { id: "b", hand: [] },
    ],
    reserve: [],
    board: createBoard(),
    spinnerId: null,
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: 200,
    rulesetId: ALL_FIVES_RULESET_ID,
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    statusKey: null,
    statusVars: null,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
    ...overrides,
  };
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const scoringSrc = readFileSync(join(here, "allFivesScoring.js"), "utf8");
  const liveStart = scoringSrc.indexOf("export function explainAllFivesScore");
  const roundStart = scoringSrc.indexOf("export function roundToNearestFive");
  const liveSrc = scoringSrc.slice(liveStart, roundStart);
  assert.equal(liveSrc.includes("roundToNearestFive"), false);
  assert.equal(liveSrc.includes("calculateAllFivesRoundPoints"), false);
  assert.equal(liveSrc.includes("handPipTotal"), false);
  const playSrc = scoringSrc.slice(
    scoringSrc.indexOf("export function scoreAllFivesPlay"),
    scoringSrc.indexOf("export function allFivesScorePlay")
  );
  assert.match(playSrc, /explainAllFivesScore/);
  assert.equal(playSrc.includes("roundToNearestFive"), false);
  section("live scoring cannot enter round-end rounding");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const spinner = spin((pip + 3) % 7);
    const linkPip = (pip + 3) % 7;
    const later = spin(pip);
    const outward = (pip + 1) % 7;
    const board = [
      spinner,
      { id: `link-${linkPip}-${pip}`, left: linkPip, right: pip },
      later,
    ];
    const layout = { spinnerId: spinner.id };
    const asTerminal = explain(board, layout);
    const right = asTerminal.terminals.find((end) => end.branch === BRANCH.MAIN_RIGHT);
    assert.ok(right);
    assert.equal(right.sourceTileId, later.id);
    assert.equal(right.type, "terminal-double");
    assert.deepEqual(right.values, [pip, pip]);
    assert.equal(right.contribution, pip * 2);
    assertOnBoard(asTerminal);

    const extended = explain(
      [
        ...board,
        { id: `out-${pip}-${outward}`, left: pip, right: outward },
      ],
      layout
    );
    assert.equal(
      extended.terminals.some((end) => end.sourceTileId === later.id),
      false,
      `${later.id} becomes internal after extend`
    );
    const newRight = extended.terminals.find((end) => end.branch === BRANCH.MAIN_RIGHT);
    assert.equal(newRight.sourceTileId, `out-${pip}-${outward}`);
    assert.equal(newRight.type, "single-terminal");
    assert.equal(newRight.contribution, outward);
    assert.equal(
      extended.terminals.reduce((sum, end) => sum + end.contribution, 0),
      extended.exactTotal
    );
    assertOnBoard(extended);
  }
  section("terminal doubles 0-0…6-6: both sides, then zero after extend");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const partner = (pip + 1) % 7;
    const partnerId = `${Math.min(pip, partner)}-${Math.max(pip, partner)}`;
    const tiles = generateSet();
    const byId = indexTiles(tiles);
    const lone = {
      board: [spin(pip)],
      spinnerId: id,
      spinnerNorth: [],
      spinnerSouth: [],
      byId,
      rulesetId: ALL_FIVES_RULESET_ID,
    };
    const legal = getAllFivesLegalMoves([partnerId], lone);
    assert.equal(
      legal.some((move) => move.end === SPINNER_NORTH || move.end === "north"),
      true,
      `${id}: empty north remains a legal destination`
    );
    const loneRep = explain(lone.board, lone);
    assert.deepEqual(byBranch(loneRep), {
      SPINNER: pip * 2,
    });
    assert.equal(
      loneRep.terminals.some((end) => end.branch === BRANCH.SPINNER_TOP),
      false,
      `${id}: inactive TOP is not a scoring terminal`
    );
    assert.equal(
      loneRep.terminals.some((end) => end.branch === BRANCH.SPINNER_BOTTOM),
      false,
      `${id}: inactive BOTTOM is not a scoring terminal`
    );
    assert.equal(
      loneRep.terminals.some(
        (end) =>
          end.sourceTileId === id &&
          end.contribution === pip * 2 &&
          end.type === "terminal-double" &&
          end.reason === "spinner-terminal-double-on-main-line"
      ),
      true,
      `${id}: lone spinner is a main-line terminal double`
    );
    assertOnBoard(loneRep);

    const northArm = { id: `N-${pip}-${partner}`, left: pip, right: partner };
    const occupied = explain([spin(pip)], {
      spinnerId: id,
      spinnerNorth: [northArm],
    });
    assert.equal(
      occupied.terminals.some((end) => end.branch === BRANCH.SPINNER_TOP && end.sourceTileId === id),
      false,
      `${id}: occupied spinner port itself scores 0`
    );
    const top = occupied.terminals.find((end) => end.branch === BRANCH.SPINNER_TOP);
    assert.equal(top.sourceTileId, northArm.id);
    assert.equal(top.contribution, partner);
    assert.equal(
      occupied.terminals.some(
        (end) => end.branch === BRANCH.MAIN_LEFT || end.branch === BRANCH.MAIN_RIGHT
      ),
      false,
      `${id}: empty spinner L/R ports are not scoring terminals once an arm exists`
    );
    assertOnBoard(occupied);

    const tip = { id: `${partner}-${partner}`, left: partner, right: partner };
    const tipRep = explain([spin(pip)], {
      spinnerId: id,
      spinnerNorth: [northArm, tip],
    });
    const tipEnd = tipRep.terminals.find((end) => end.branch === BRANCH.SPINNER_TOP);
    assert.equal(tipEnd.type, "terminal-double");
    assert.equal(tipEnd.contribution, partner * 2);
    assert.equal(tipEnd.sourceTileId, tip.id);
    assertOnBoard(tipRep);

    const pastPip = (partner + 1) % 7 === pip ? (partner + 2) % 7 : (partner + 1) % 7;
    const past = { id: `Nx-${partner}-${pastPip}`, left: partner, right: pastPip };
    const pastRep = explain([spin(pip)], {
      spinnerId: id,
      spinnerNorth: [northArm, tip, past],
    });
    assert.equal(
      pastRep.terminals.some((end) => end.sourceTileId === tip.id),
      false,
      `${id}: extending the arm double removes its contribution`
    );
    assert.equal(
      pastRep.terminals.find((end) => end.branch === BRANCH.SPINNER_TOP)?.contribution,
      pastPip
    );
    assertOnBoard(pastRep);
  }
  section("spinner 0-0…6-6: empty faces / legal dest ≠ terminals; arm doubles 2× then 0");
}

{
  const cases = [
    {
      label: "4",
      exact: 4,
      award: 0,
      board: [spin(0), { id: "0-2", left: 0, right: 2 }, spin(2)],
      extra: { spinnerId: "0-0" },
    },
    {
      label: "5",
      exact: 5,
      award: 5,
      board: [spin(0), { id: "0-5", left: 0, right: 5 }],
      extra: { spinnerId: "0-0" },
    },
    {
      label: "6",
      exact: 6,
      award: 0,
      board: [spin(3)],
      extra: { spinnerId: "3-3" },
    },
    {
      label: "8",
      exact: 8,
      award: 0,
      board: [spin(4)],
      extra: { spinnerId: "4-4" },
    },
    {
      label: "9",
      exact: 9,
      award: 0,
      board: [
        { id: "3-4", left: 3, right: 4 },
        spin(4),
        { id: "4-6", left: 4, right: 6 },
      ],
      extra: { spinnerId: "4-4" },
    },
    {
      label: "10",
      exact: 10,
      award: 10,
      board: [spin(5)],
      extra: { spinnerId: "5-5" },
    },
    {
      label: "11",
      exact: 11,
      award: 0,
      board: [
        { id: "3-5", left: 3, right: 5 },
        spin(5),
        { id: "5-4", left: 5, right: 4 },
      ],
      extra: {
        spinnerId: "5-5",
        spinnerNorth: [{ id: "N-5-4", left: 5, right: 4 }],
      },
    },
    {
      label: "13",
      exact: 13,
      award: 0,
      board: [
        { id: "4-6", left: 4, right: 6 },
        spin(6),
        { id: "6-5", left: 6, right: 5 },
      ],
      extra: {
        spinnerId: "6-6",
        spinnerNorth: [{ id: "N-6-4", left: 6, right: 4 }],
      },
    },
    {
      label: "6-6+3",
      exact: 15,
      award: 15,
      board: [spin(6), { id: "6-3", left: 6, right: 3 }],
      extra: { spinnerId: "6-6" },
    },
    {
      label: "15",
      exact: 15,
      award: 15,
      board: [
        { id: "3-4", left: 3, right: 4 },
        spin(4),
        { id: "4-6", left: 4, right: 6 },
      ],
      extra: {
        spinnerId: "4-4",
        spinnerNorth: [{ id: "N-4-6", left: 4, right: 6 }],
      },
    },
    {
      label: "20",
      exact: 20,
      award: 20,
      board: [
        { id: "6-3", left: 6, right: 3 },
        spin(3),
        { id: "3-5", left: 3, right: 5 },
      ],
      extra: {
        spinnerId: "3-3",
        spinnerNorth: [{ id: "N-3-4", left: 3, right: 4 }],
        spinnerSouth: [{ id: "S-3-5", left: 3, right: 5 }],
      },
    },
    {
      label: "25",
      exact: 25,
      award: 25,
      board: [
        { id: "5-6", left: 5, right: 6 },
        spin(6),
        { id: "6-4", left: 6, right: 4 },
      ],
      extra: {
        spinnerId: "6-6",
        spinnerNorth: [
          { id: "6-5", left: 6, right: 5 },
          { id: "5-5", left: 5, right: 5 },
        ],
        spinnerSouth: [
          { id: "6-3", left: 6, right: 3 },
          { id: "3-3", left: 3, right: 3 },
        ],
      },
    },
    {
      label: "30",
      exact: 30,
      award: 30,
      board: [
        { id: "3-5", left: 5, right: 3 },
        spin(3),
        { id: "3-6", left: 3, right: 6 },
        { id: "6-6", left: 6, right: 6 },
      ],
      extra: {
        spinnerId: "3-3",
        spinnerNorth: [
          { id: "3-4", left: 3, right: 4 },
          { id: "4-4", left: 4, right: 4 },
        ],
        spinnerSouth: [
          { id: "3-0", left: 3, right: 0 },
          { id: "0-5", left: 0, right: 5 },
        ],
      },
    },
    {
      label: "35",
      exact: 35,
      award: 35,
      board: [
        { id: "3-5", left: 5, right: 3 },
        spin(3),
        { id: "3-6", left: 3, right: 6 },
        { id: "6-6", left: 6, right: 6 },
      ],
      extra: {
        spinnerId: "3-3",
        spinnerNorth: [
          { id: "3-4", left: 3, right: 4 },
          { id: "4-4", left: 4, right: 4 },
        ],
        spinnerSouth: [
          { id: "3-0", left: 3, right: 0 },
          { id: "0-5", left: 0, right: 5 },
          { id: "5-5", left: 5, right: 5 },
        ],
      },
    },
  ];

  for (const row of cases) {
    const rep = explain(row.board, row.extra);
    const extracted = rep.terminals.reduce((sum, end) => sum + end.contribution, 0);
    assert.equal(extracted, row.exact, `${row.label}: extracted ${extracted}`);
    assert.equal(rep.exactTotal, row.exact, `${row.label}: exactTotal`);
    assert.equal(rep.qualifies, row.award > 0, `${row.label}: qualifies`);
    assert.equal(rep.awarded, row.award, `${row.label}: awarded`);
    assert.equal(scoreAllFivesPlay({ board: row.board, ...row.extra }), row.award);
    assert.equal(shouldShowPlayScorePopup(rep.awarded), row.award > 0);
    assertOnBoard(rep);
    const glowSum = (rep.highlights || []).reduce(
      (sum, item) => sum + item.contribution,
      0
    );
    if (row.award > 0) {
      assert.equal(
        rep.highlights.length,
        rep.terminals.filter((end) => end.contribution > 0).length,
        `${row.label}: glow count`
      );
      assert.equal(glowSum, row.award, `${row.label}: highlighted ends must sum to award`);
      for (const glow of rep.highlights) {
        const match = rep.terminals.find(
          (end) =>
            end.sourceTileId === glow.sourceTileId &&
            end.scoringSide === glow.scoringSide &&
            end.contribution === glow.contribution
        );
        assert.ok(match, `${row.label}: highlight ${glow.sourceTileId} must be a scoring terminal`);
      }
    } else {
      assert.deepEqual(rep.highlights, [], `${row.label}: zero award has no glow`);
      assert.equal(glowSum, 0);
    }
  }
  section("multi-branch exact totals 4…35 from extracted terminals");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["5-6", "2-5", "0-1"] },
      { id: "b", hand: ["2-3", "0-2"] },
    ],
    reserve: ["0-4"],
  });
  state = playTile(state, "5-6");
  state = { ...state, currentPlayer: 0 };
  const after = playTile(state, "2-5", END.LEFT);
  const rep = explainAllFivesScore({
    board: after.board,
    spinnerId: after.spinnerId,
    spinnerNorth: after.spinnerNorth,
    spinnerSouth: after.spinnerSouth,
    tileId: "2-5",
    end: END.LEFT,
    byId: after.byId,
  });
  assert.equal(after.board.some((tile) => tile.id === "2-3"), false);
  assert.equal(after.players[1].hand.includes("2-3"), true);
  assert.equal(rep.boardTileIds.includes("2-3"), false);
  assert.equal(
    rep.terminals.some((end) => end.sourceTileId === "2-3"),
    false,
    "unplayed 3-2 contributes nothing"
  );
  const values = rep.terminals.map((end) => end.contribution).sort((a, b) => a - b);
  assert.deepEqual(values, [2, 6]);
  assert.equal(rep.exactTotal, 8);
  assert.equal(rep.qualifies, false);
  assert.equal(rep.awarded, 0);
  assert.equal(after.lastPlayPoints, 0);
  assert.equal(after.scores[0], 0);
  assert.notEqual(rep.awarded, 5);
  const dump = formatAllFivesScoreReport(rep);
  assert.match(dump, /EXACT TOTAL: 8/);
  assert.match(dump, /POINTS: 0/);
  console.log("\n2-5 reproduction:\n" + dump + "\n");
  section("play 2-5 onto 5-6: terminals 2+6=8 → 0; unplayed 3-2 ignored");
}

{
  const eight = explain([spin(4)], { spinnerId: "4-4" });
  assert.equal(eight.exactTotal, 8);
  assert.equal(eight.awarded, 0);

  const thirteen = explain(
    [
      { id: "4-6", left: 4, right: 6 },
      spin(6),
      { id: "6-5", left: 6, right: 5 },
    ],
    {
      spinnerId: "6-6",
      spinnerNorth: [{ id: "N-6-4", left: 6, right: 4 }],
    }
  );
  assert.equal(thirteen.exactTotal, 13);
  assert.equal(thirteen.awarded, 0);
  assert.deepEqual(thirteen.highlights, []);

  const twentyThree = explain(
    [
      { id: "1-5", left: 5, right: 1 },
      spin(1),
      { id: "1-6", left: 1, right: 6 },
    ],
    {
      spinnerId: "1-1",
      spinnerNorth: [{ id: "1-4", left: 1, right: 4 }],
      spinnerSouth: [
        { id: "1-3", left: 1, right: 3 },
        { id: "3-4", left: 3, right: 4 },
        { id: "4-4", left: 4, right: 4 },
      ],
    }
  );
  const extracted = twentyThree.terminals.reduce((sum, end) => sum + end.contribution, 0);
  assert.equal(extracted, 23);
  assert.equal(twentyThree.exactTotal, 23);
  assert.equal(twentyThree.awarded, 0, "23 is not rounded to 20 or 25");
  section("8 / 13 / 23 stay exact and award 0 — no nearest-5");
}

{
  const ends = getCurrentTerminalEnds({
    board: [spin(4), { id: "4-2", left: 4, right: 2 }],
    spinnerId: "4-4",
  });
  assert.equal(ends.find((end) => end.branch === BRANCH.MAIN_LEFT), undefined);
  assert.equal(ends.find((end) => end.branch === BRANCH.MAIN_RIGHT)?.contribution, 2);
  assert.equal(ends.find((end) => end.reason === "spinner-terminal-double-on-main-line")?.contribution, 8);
  section("A/B. one-sided spinner is a terminal double; empty main side is not a separate terminal");
}

{
  let state = allFivesState({
    players: [
      { id: "a", hand: ["5-5", "3-5"] },
      { id: "b", hand: ["0-1"] },
    ],
  });
  const open = playTile(state, "5-5");
  assert.equal(open.lastPlayPoints, 10);
  const openGlow = open.lastPlayScoreTerminals.reduce(
    (sum, item) => sum + item.contribution,
    0
  );
  assert.equal(openGlow, 10);
  assert.equal(open.lastPlayScoreTerminals.length, 1);
  assert.equal(open.lastPlayScoreTerminals[0].sourceTileId, "5-5");
  assert.equal(open.lastPlayScoreTerminals[0].scoringSide, "both");
  assert.deepEqual(open.lastPlayScoreTerminals[0].scoringSides, ["left", "right"]);

  const zeroMove = playTile({ ...open, currentPlayer: 0 }, "3-5", END.RIGHT);
  assert.equal(zeroMove.lastPlayPoints, 0);
  assert.deepEqual(zeroMove.lastPlayScoreTerminals, []);
  assert.equal(shouldShowPlayScorePopup(zeroMove.lastPlayPoints), false);
  section("G/H/I. awarded terminals drive glow; zero-point move has none");
}

{
  const doubleTip = explain(
    [spin(0), { id: "0-5", left: 0, right: 5 }, { id: "5-5", left: 5, right: 5 }],
    { spinnerId: "0-0" }
  );
  assert.equal(doubleTip.exactTotal, 10);
  assert.equal(doubleTip.awarded, 10);
  const scoring = doubleTip.terminals.filter((end) => end.contribution > 0);
  assert.equal(scoring.length, 1);
  assert.equal(scoring[0].sourceTileId, "5-5");
  assert.equal(scoring[0].type, "terminal-double");
  assert.equal(scoring[0].contribution, 10);
  assert.equal(scoring[0].scoringSide, "both");
  assert.equal(doubleTip.highlights.length, 1);
  assert.deepEqual(doubleTip.highlights[0].scoringSides, ["left", "right"]);
  assert.equal(
    doubleTip.highlights.reduce((sum, item) => sum + item.contribution, 0),
    doubleTip.awarded
  );

  const extended = explain(
    [
      spin(0),
      { id: "0-5", left: 0, right: 5 },
      { id: "5-5", left: 5, right: 5 },
      { id: "5-2", left: 5, right: 2 },
    ],
    { spinnerId: "0-0" }
  );
  assert.equal(
    extended.terminals.some((end) => end.sourceTileId === "5-5"),
    false
  );
  assert.equal(extended.exactTotal, 2);
  assert.equal(extended.awarded, 0);
  assert.deepEqual(extended.highlights, []);
  section("D/E. terminal double glows both sides, then 0 after extend");
}

{
  const rep = explain([spin(6), { id: "6-3", left: 6, right: 3 }], { spinnerId: "6-6" });
  assert.equal(rep.exactTotal, 15);
  assert.equal(rep.liveAward, 15);
  assert.equal(rep.awarded, 15);
  const spinnerTerm = rep.terminals.find(
    (end) => end.reason === "spinner-terminal-double-on-main-line"
  );
  assert.ok(spinnerTerm);
  assert.deepEqual(spinnerTerm.values, [6, 6]);
  assert.equal(spinnerTerm.contribution, 12);
  const outer = rep.terminals.find((end) => end.sourceTileId === "6-3");
  assert.equal(outer.contribution, 3);
  const glowSum = rep.highlights.reduce((sum, item) => sum + item.contribution, 0);
  assert.equal(glowSum, 15);
  assert.equal(
    rep.highlights.some((item) => item.sourceTileId === "6-6" && item.scoringSide === "both"),
    true
  );
  assert.equal(
    rep.highlights.some((item) => item.sourceTileId === "6-3" && item.contribution === 3),
    true
  );
  section("6-6 + 6-3: 3+6+6=+15; both spinner halves and the 3 glow");
}

console.log("\nAll Fives terminal-end scoring tests passed.");
