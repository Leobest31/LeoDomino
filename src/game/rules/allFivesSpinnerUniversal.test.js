/**
 * Universal spinner scoring — every first double 0-0 … 6-6.
 * Run: node src/game/rules/allFivesSpinnerUniversal.test.js
 */

import assert from "node:assert/strict";
import { explainAllFivesScore } from "./allFivesScoring.js";
import { shouldShowPlayScorePopup } from "./allFivesSpinner.js";

function section(title) {
  console.log(`✓ ${title}`);
}

function spin(pip) {
  return { id: `${pip}-${pip}`, left: pip, right: pip };
}

function leftArm(pip, free) {
  return { id: `L-${pip}-${free}`, left: free, right: pip };
}

function rightArm(pip, free) {
  return { id: `R-${pip}-${free}`, left: pip, right: free };
}

function nsArm(tag, pip, free) {
  return { id: `${tag}-${pip}-${free}`, left: pip, right: free };
}

function valuesOf(rep) {
  return Object.fromEntries(rep.endpoints.map((end) => [end.branch, end.value]));
}

function score(board, extra = {}) {
  return explainAllFivesScore({ board, isOpening: false, ...extra });
}

const FREES = (pip) => {
  const used = new Set([pip]);
  const next = () => {
    for (let n = 0; n <= 6; n += 1) {
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    throw new Error("no free pip");
  };
  return { a: next(), b: next(), c: next(), d: next(), e: next(), f: next() };
};

const matrix = [];

function record(pip, state, rep) {
  matrix.push({
    spinner: `${pip}-${pip}`,
    state,
    ends: valuesOf(rep),
    total: rep.exposedTotal,
    points: rep.pointsAwarded,
  });
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const id = `${pip}-${pip}`;
    const f = FREES(pip);
    const s = spin(pip);

    const alone = score([s], { spinnerId: id });
    assert.deepEqual(valuesOf(alone), { spinner: pip * 2 });
    assert.equal(alone.exposedTotal, pip * 2);
    assert.equal(
      alone.pointsAwarded,
      pip * 2 >= 10 && pip * 2 % 5 === 0 ? pip * 2 : 0
    );
    record(pip, "spinner alone", alone);

    const left = score([leftArm(pip, f.a), s], { spinnerId: id });
    assert.deepEqual(valuesOf(left), { left: f.a, spinner: pip * 2 });
    assert.equal(left.exposedTotal, f.a + pip * 2);
    assert.equal(
      left.endpoints.find((e) => e.sourceTileId === id)?.reason,
      "spinner-terminal-double-on-main-line"
    );
    record(pip, "main LEFT occupied", left);

    const right = score([s, rightArm(pip, f.b)], { spinnerId: id });
    assert.deepEqual(valuesOf(right), { right: f.b, spinner: pip * 2 });
    assert.equal(right.exposedTotal, f.b + pip * 2);
    record(pip, "main RIGHT occupied", right);

    const both = score([leftArm(pip, f.a), s, rightArm(pip, f.b)], { spinnerId: id });
    assert.deepEqual(valuesOf(both), { left: f.a, right: f.b });
    assert.equal(both.exposedTotal, f.a + f.b);
    assert.equal(
      both.endpoints.some((e) => e.sourceTileId === id),
      false,
      `${id} both mains consumed: spinner contributes 0`
    );
    record(pip, "LEFT + RIGHT occupied", both);

    const north = score([s], {
      spinnerId: id,
      spinnerNorth: [nsArm("N", pip, f.c)],
    });
    assert.deepEqual(valuesOf(north), { spinner: pip * 2, north: f.c });
    assert.equal(north.exposedTotal, pip * 2 + f.c);
    record(pip, "NORTH active", north);

    const south = score([s], {
      spinnerId: id,
      spinnerSouth: [nsArm("S", pip, f.d)],
    });
    assert.deepEqual(valuesOf(south), { spinner: pip * 2, south: f.d });
    assert.equal(south.exposedTotal, pip * 2 + f.d);
    record(pip, "SOUTH active", south);

    const ns = score([s], {
      spinnerId: id,
      spinnerNorth: [nsArm("N", pip, f.c)],
      spinnerSouth: [nsArm("S", pip, f.d)],
    });
    assert.deepEqual(valuesOf(ns), { spinner: pip * 2, north: f.c, south: f.d });
    assert.equal(ns.exposedTotal, pip * 2 + f.c + f.d);
    record(pip, "NORTH + SOUTH active", ns);

    const leftNorth = score([leftArm(pip, f.a), s], {
      spinnerId: id,
      spinnerNorth: [nsArm("N", pip, f.c)],
    });
    assert.deepEqual(valuesOf(leftNorth), { left: f.a, spinner: pip * 2, north: f.c });
    assert.equal(leftNorth.exposedTotal, f.a + pip * 2 + f.c);
    record(pip, "LEFT + NORTH", leftNorth);

    const rightSouth = score([s, rightArm(pip, f.b)], {
      spinnerId: id,
      spinnerSouth: [nsArm("S", pip, f.d)],
    });
    assert.deepEqual(valuesOf(rightSouth), { right: f.b, spinner: pip * 2, south: f.d });
    assert.equal(rightSouth.exposedTotal, f.b + pip * 2 + f.d);
    record(pip, "RIGHT + SOUTH", rightSouth);

    const four = score([leftArm(pip, f.a), s, rightArm(pip, f.b)], {
      spinnerId: id,
      spinnerNorth: [nsArm("N", pip, f.c)],
      spinnerSouth: [nsArm("S", pip, f.d)],
    });
    assert.deepEqual(valuesOf(four), { left: f.a, right: f.b, north: f.c, south: f.d });
    assert.equal(four.exposedTotal, f.a + f.b + f.c + f.d);
    assert.equal(four.endpoints.some((e) => e.sourceTileId === id), false);
    record(pip, "all four branches", four);

    const extended = score([s], {
      spinnerId: id,
      spinnerNorth: [nsArm("N", pip, f.c), { id: `Nx-${f.c}-${f.e}`, left: f.c, right: f.e }],
    });
    assert.deepEqual(valuesOf(extended), { spinner: pip * 2, north: f.e });
    assert.equal(extended.exposedTotal, pip * 2 + f.e);
    assert.equal(
      extended.endpoints.some((e) => e.value === f.c && e.branch === "north"),
      false,
      "internal north connection does not score"
    );
    record(pip, "NORTH extended by normal tile", extended);

    const tipDouble = score([s], {
      spinnerId: id,
      spinnerNorth: [
        nsArm("N", pip, f.c),
        { id: `${f.c}-${f.c}`, left: f.c, right: f.c },
      ],
    });
    assert.equal(tipDouble.endpoints.find((e) => e.branch === "north")?.value, f.c * 2);
    assert.equal(
      tipDouble.endpoints.find((e) => e.branch === "north")?.type,
      "terminal-double"
    );
    assert.equal(
      tipDouble.endpoints.filter((e) => e.branch === "north").length,
      1,
      "terminal double on a branch counts both sides"
    );
    record(pip, "NORTH tip is a later double", tipDouble);

    const pastDouble = score([s], {
      spinnerId: id,
      spinnerNorth: [
        nsArm("N", pip, f.c),
        { id: `${f.c}-${f.c}`, left: f.c, right: f.c },
        { id: `N2-${f.c}-${f.e}`, left: f.c, right: f.e },
      ],
    });
    assert.equal(pastDouble.endpoints.find((e) => e.branch === "north")?.value, f.e);
    assert.equal(
      pastDouble.endpoints.some((e) => e.sourceTileId === `${f.c}-${f.c}`),
      false,
      "consumed later double contributes 0"
    );
    record(pip, "NORTH double extended again", pastDouble);
  }
  section("parameterized spinner 0-0…6-6: 13 topology states each");
}

{
  for (let pip = 0; pip <= 6; pip += 1) {
    const later = spin(pip);
    const opener = spin((pip + 3) % 7);
    const link = (pip + 3) % 7;
    const board = [
      opener,
      { id: `link-${link}-${pip}`, left: link, right: pip },
      later,
    ];
    const spinnerId = opener.id;
    const asRightTip = score(board, { spinnerId });
    assert.equal(asRightTip.endpoints.find((e) => e.branch === "right")?.value, pip * 2);
    assert.equal(
      asRightTip.endpoints.find((e) => e.branch === "right")?.type,
      "terminal-double"
    );
    assert.equal(
      asRightTip.endpoints.filter((e) => e.sourceTileId === later.id).length,
      1,
      `${later.id} as outer end counts both sides`
    );

    const consumed = score(
      [
        ...board,
        { id: `past-${pip}-${(pip + 1) % 7}`, left: pip, right: (pip + 1) % 7 },
      ],
      { spinnerId }
    );
    assert.equal(
      consumed.endpoints.some((e) => e.sourceTileId === later.id),
      false,
      `${later.id} fully consumed contributes 0`
    );
  }
  section("later doubles 0-0…6-6 at outer ends: both sides, then zero after extend");
}

{
  const awards = [];

  const liveFive = score([spin(0), rightArm(0, 5)], { spinnerId: "0-0" });
  assert.deepEqual(valuesOf(liveFive), { right: 5, spinner: 0 });
  assert.equal(liveFive.exposedTotal, 5);
  assert.equal(liveFive.pointsAwarded, 0);
  assert.deepEqual(liveFive.highlights, []);

  const plus10 = score([spin(5)], { spinnerId: "5-5" });
  assert.equal(plus10.exposedTotal, 10);
  assert.equal(plus10.pointsAwarded, 10);
  awards.push({ pts: 10, example: plus10 });

  const plus15 = score([spin(6), rightArm(6, 3)], { spinnerId: "6-6" });
  assert.deepEqual(valuesOf(plus15), { right: 3, spinner: 12 });
  assert.equal(plus15.exposedTotal, 15);
  assert.equal(plus15.pointsAwarded, 15);
  assert.equal(
    plus15.highlights.reduce((sum, item) => sum + item.contribution, 0),
    15
  );
  awards.push({ pts: 15, example: plus15 });

  const plus20 = score([spin(5), rightArm(5, 4)], {
    spinnerId: "5-5",
    spinnerNorth: [nsArm("N", 5, 6)],
  });
  assert.deepEqual(valuesOf(plus20), { spinner: 10, right: 4, north: 6 });
  assert.equal(plus20.exposedTotal, 20);
  assert.equal(plus20.pointsAwarded, 20);
  awards.push({ pts: 20, example: plus20 });

  const plus25 = score([leftArm(4, 6), spin(4), rightArm(4, 5)], {
    spinnerId: "4-4",
    spinnerNorth: [nsArm("N", 4, 6)],
    spinnerSouth: [nsArm("S", 4, 4)],
  });
  assert.equal(plus25.exposedTotal, 25);
  assert.equal(plus25.pointsAwarded, 25);
  awards.push({ pts: 25, example: plus25 });

  const plus30 = score([leftArm(5, 6), spin(5), rightArm(5, 4)], {
    spinnerId: "5-5",
    spinnerNorth: [nsArm("N", 5, 5)],
    spinnerSouth: [nsArm("S", 5, 5)],
  });
  assert.equal(plus30.exposedTotal, 30);
  assert.equal(plus30.pointsAwarded, 30);
  awards.push({ pts: 30, example: plus30 });

  for (const row of awards) {
    assert.equal(shouldShowPlayScorePopup(row.pts), true);
  }

  const zero = score([spin(4)], { spinnerId: "4-4" });
  assert.equal(zero.exposedTotal, 8);
  assert.equal(zero.pointsAwarded, 0);
  assert.equal(shouldShowPlayScorePopup(0), false);

  assert.equal(score([spin(6), rightArm(6, 1)], { spinnerId: "6-6" }).pointsAwarded, 0);

  section("reachable awards +10/+15/+20/+25/+30; live 5 and 13 stay 0");
}

{
  const maxOrdinary = Math.max(...matrix.map((row) => row.total));
  assert.ok(maxOrdinary <= 40, `ordinary-tile matrix max ${maxOrdinary} ≤ 40`);
  section("ordinary-tile spinner matrix stays within reachable terminal sums");
}

{
  const lines = [
    "Spinner | State | Open Ends | Total | Points",
    "--------|-------|-----------|-------|-------",
  ];
  for (const row of matrix) {
    const ends = Object.entries(row.ends)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    lines.push(`${row.spinner} | ${row.state} | ${ends} | ${row.total} | ${row.points}`);
  }
  console.log("\n" + lines.join("\n") + "\n");
  section(`printed ${matrix.length}-row spinner scoring matrix`);
}

console.log("Universal spinner scoring tests passed.");
