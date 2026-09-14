/**
 * Shared drag/drop destination-resolution resilience.
 *
 * Root-cause contract: DOM geometry (collectDestinationTargets) is only an
 * interaction aid. It must never become the source of truth for whether a
 * legal move exists. This file proves the shared recovery path — used by
 * OnlineGamePage.jsx's finishDrag for every online ruleset (legacy, haitian,
 * american) — always produces an executable action ("place" or "choose")
 * whenever the authoritative engine says a legal move exists, regardless of
 * which (if any) endpoint DOM targets were measurable at pointer-up time.
 *
 * Does not change engine legality, scoring, timeout economics, or the
 * American spinner / Haitian Dekabès / first-to-4 rules.
 *
 * Run: node src/online/dragDropResilience.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getAvailableActions, playTile } from "../game/rules/drawDominoes.js";
import { PHASE } from "../game/rules/constants.js";
import { generateSet, indexTiles } from "../game/tiles.js";
import { createBoard } from "../game/board.js";
import { legalEndsForTile, isAutoPlaceable, resolvePlayChoice } from "../game/interaction.js";
import { equivalentPlayEnd } from "./onlineTable.js";
import { resolvePlayWithoutDomTargets } from "./interactionRecovery.js";
import { dragDropDiag, DRAG_DROP_RECOVERY } from "./onlineActionDiag.js";
import { isPlausiblePlayDrop, TABLE_CANCEL_ZONE_PAD_PX } from "../game/destinationTarget.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const onlinePage = readFileSync(join(root, "pages/OnlineGamePage.jsx"), "utf8");

function section(title) {
  console.log(`  ✓ ${title}`);
}

/**
 * Faithful re-creation of finishDrag's decision sequence using the exact
 * same imported, unmodified functions the component calls. `targets` here
 * stands in for whatever collectDestinationTargets(legalEnds, layout) would
 * have measured from the DOM — full, partial, or empty.
 *
 * `drop` is optional: { clientX, clientY, tableRect }. When omitted, the
 * drop is treated as unambiguously plausible (landed on the table) — this
 * preserves every existing target-loss-matrix test, which is exercising
 * hit-test/recovery logic, not cancel-zone classification. Pass `drop`
 * explicitly to also exercise the cancel-safety gate.
 */
function resolveDrop({ moves, tileId, layout, hit, drop }) {
  const legalEnds = legalEndsForTile(moves, tileId);
  if (hit) return { action: "place", end: hit };
  if (!legalEnds.length) return { action: "none" };
  if (drop) {
    const plausible = isPlausiblePlayDrop(drop.clientX, drop.clientY, drop.tableRect ?? null);
    if (!plausible) return { action: "cancelled" };
  }
  const equivalent = equivalentPlayEnd(moves, tileId, layout);
  const autoEnd = isAutoPlaceable(moves, tileId) ? resolvePlayChoice(moves, tileId)?.end : null;
  const resolved = resolvePlayWithoutDomTargets({ legalEnds, equivalent, autoEnd });
  return resolved;
}

/** All subsets of `items` (power set), used to try every combination of
 * "which legal ends happen to have a measurable DOM target right now". */
function powerSet(items) {
  return items.reduce(
    (subsets, item) => subsets.concat(subsets.map((set) => [...set, item])),
    [[]]
  );
}

function baseEngineState(overrides) {
  const tiles = generateSet();
  const byId = indexTiles(tiles);
  return {
    seed: 1,
    byId,
    players: [{ id: "a", hand: [] }, { id: "b", hand: [] }],
    reserve: [],
    board: createBoard(),
    spinnerId: null,
    spinnerNorth: [],
    spinnerSouth: [],
    phase: PHASE.PLAYING,
    currentPlayer: 0,
    scores: [0, 0],
    round: 1,
    targetScore: 100,
    rulesetId: "legacy",
    mustPlayTileId: null,
    consecutivePasses: 0,
    roundStarterIndex: 0,
    roundResult: null,
    matchWinner: null,
    lastPlayPoints: 0,
    lastPlayPointsSeat: null,
    lastPlayScoreTerminals: [],
    ...overrides,
  };
}

/**
 * Exercises the full target-loss matrix for one (state, tileId) pair:
 * every subset of legalEnds keeps a measurable target, the rest do not.
 * Asserts the resolver always yields "place" or "choose" — never "none" —
 * and, when it says "place", that the real engine actually accepts the move.
 */
function assertRecoverableAcrossTargetLoss(label, state, tileId) {
  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, tileId);
  assert.ok(legalEnds.length > 0, `${label}: precondition — tile must be legal`);
  const layout = { board: state.board, spinnerId: state.spinnerId, rulesetId: state.rulesetId };

  for (const measurable of powerSet(legalEnds)) {
    const targets = measurable.map((end) => ({ end, tileId: `synthetic-${end}`, rect: {} }));
    // Hit-test never finds the pointer over any of these synthetic rects
    // (no real geometry) — this is exactly "DOM measurement failed" for
    // every end not in `measurable`, and "present but pointer missed it"
    // for every end that is.
    const hit = null;
    const resolved = resolveDrop({ moves, tileId, layout, targets, hit });
    assert.notEqual(
      resolved.action,
      "none",
      `${label}: legalEnds=${JSON.stringify(legalEnds)} measurable=${JSON.stringify(measurable)} must not dead-end`
    );
    assert.ok(
      resolved.action === "place" || resolved.action === "choose",
      `${label}: unexpected action ${resolved.action}`
    );
    if (resolved.action === "place") {
      assert.ok(legalEnds.includes(resolved.end), `${label}: placed end must be logically legal`);
      const next = playTile(state, tileId, resolved.end);
      assert.equal(next.phase !== undefined, true, `${label}: engine must accept the recovered placement`);
    }
  }
}

// ---------------------------------------------------------------------
// A. Exact JUS v225 incident replay (Haitian) — real fixture, real engine.
// ---------------------------------------------------------------------
{
  const fixture = JSON.parse(
    readFileSync(join(root, "online/fixtures/timeoutFreeze.haitian.98bd12ce.json"), "utf8")
  );
  const state = fixture.engineState;
  assert.equal(state.rulesetId, "haitian");
  assert.deepEqual(state.players[1].hand, ["1-5"]);

  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, "1-5");
  assert.deepEqual(legalEnds.sort(), ["left", "right"], "JUS's final tile is legal on both ends");

  assertRecoverableAcrossTargetLoss("JUS v225 (haitian)", state, "1-5");

  // The specific incident: BOTH endpoint DOM nodes measurable, but the
  // pointer lands on neither (exactly what a wrapped 25-tile board can do).
  const layout = { board: state.board, spinnerId: state.spinnerId, rulesetId: "haitian" };
  const resolved = resolveDrop({
    moves,
    tileId: "1-5",
    layout,
    targets: [{ end: "left" }, { end: "right" }],
    hit: null,
  });
  assert.equal(resolved.action, "choose", "ambiguous two-end tile offers an explicit choice, never silence");

  // Whichever end the player then confirms, it must win the match.
  for (const end of ["left", "right"]) {
    const next = playTile(state, "1-5", end);
    assert.equal(next.phase, PHASE.MATCH_OVER);
    assert.equal(next.matchWinner, 1);
    assert.equal(next.roundResult.reason, "dekabes");
    assert.deepEqual(next.scores, [2, 4]);
  }
  section("JUS v225 exact replay: legal move survives full/partial/zero target loss and still wins");
}

// ---------------------------------------------------------------------
// B. Classic (legacy) — same class of ambiguity, different ruleset.
// ---------------------------------------------------------------------
{
  const state = baseEngineState({
    rulesetId: "legacy",
    board: [{ id: "2-2", left: 2, right: 2, orientation: "vertical" }],
    players: [{ id: "a", hand: ["2-5", "0-0"] }, { id: "b", hand: ["1-1", "3-3"] }],
  });
  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, "2-5");
  assert.deepEqual(legalEnds.sort(), ["left", "right"]);
  assertRecoverableAcrossTargetLoss("Classic two-end tile", state, "2-5");
  section("Classic: ambiguous two-end tile recoverable under every target-loss combination");
}

// ---------------------------------------------------------------------
// C. American (american ruleset) — same shared layer, main-chain ambiguity.
// ---------------------------------------------------------------------
{
  const state = baseEngineState({
    rulesetId: "american",
    board: [{ id: "2-2", left: 2, right: 2, orientation: "vertical" }],
    players: [{ id: "a", hand: ["2-5", "0-0"] }, { id: "b", hand: ["1-1", "3-3"] }],
  });
  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, "2-5");
  assert.deepEqual(legalEnds.sort(), ["left", "right"]);
  assertRecoverableAcrossTargetLoss("American two-end tile", state, "2-5");
  section("American: main-chain ambiguous tile recoverable under every target-loss combination (ruleset-agnostic layer)");
}

// ---------------------------------------------------------------------
// D. American spinner-branch vs. main-chain ambiguity (interaction-layer
// contract). Synthetic legalMoves shape — exercises the documented rule in
// src/game/interaction.js ("a unique MAIN wins even if a spinner arm is
// also legal") together with the target-loss recovery, without asserting
// on the American ruleset's internal spinner-unlock precondition.
// ---------------------------------------------------------------------
{
  const moves = [
    { tileId: "3-6", end: "left", destination: "MAIN_LEFT" },
    { tileId: "3-6", end: "north", destination: "SPINNER_NORTH" },
  ];
  const legalEnds = legalEndsForTile(moves, "3-6");
  assert.deepEqual(legalEnds.sort(), ["left", "north"]);
  assert.equal(isAutoPlaceable(moves, "3-6"), true, "a single MAIN end auto-resolves even with a legal spinner arm");
  const layout = { board: [{ id: "x" }], spinnerId: "6-6", rulesetId: "american" };
  for (const measurable of powerSet(legalEnds)) {
    const targets = measurable.map((end) => ({ end }));
    const resolved = resolveDrop({ moves, tileId: "3-6", layout, targets, hit: null });
    assert.equal(resolved.action, "place", "unique MAIN end must still auto-place, DOM loss or not");
    assert.equal(resolved.end, "left", "main chain wins over the spinner arm, exactly as documented");
  }
  section("American: spinner-branch-vs-main auto-resolution unaffected by target loss (rule preserved)");
}

// ---------------------------------------------------------------------
// E. Equivalent pip ends (opening double / same physical destination tile
// for two logical ends) — must still auto-place under target loss.
// ---------------------------------------------------------------------
{
  const state = baseEngineState({
    rulesetId: "legacy",
    board: [],
    players: [{ id: "a", hand: ["6-6", "0-0"] }, { id: "b", hand: ["1-1", "3-3"] }],
  });
  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, "6-6");
  assert.ok(legalEnds.length >= 1, "opening double is legal");
  assertRecoverableAcrossTargetLoss("Opening double (equivalent ends)", state, "6-6");
  section("Equivalent-end / opening tile recoverable under target loss");
}

// ---------------------------------------------------------------------
// F. Generic invariant, stated once, checked over every fixture above plus
// a purely synthetic multi-shape sweep: legalMoves.length > 0 must never
// produce "no executable UI path" solely from DOM measurement gaps.
// ---------------------------------------------------------------------
{
  const shapes = [
    [{ tileId: "t", end: "left", destination: "MAIN_LEFT" }],
    [
      { tileId: "t", end: "left", destination: "MAIN_LEFT" },
      { tileId: "t", end: "right", destination: "MAIN_RIGHT" },
    ],
    [
      { tileId: "t", end: "left", destination: "MAIN_LEFT" },
      { tileId: "t", end: "north", destination: "SPINNER_NORTH" },
      { tileId: "t", end: "south", destination: "SPINNER_SOUTH" },
    ],
  ];
  const layout = { board: [{ id: "x" }], spinnerId: null, rulesetId: "legacy" };
  for (const moves of shapes) {
    const legalEnds = legalEndsForTile(moves, "t");
    for (const measurable of powerSet(legalEnds)) {
      const targets = measurable.map((end) => ({ end }));
      const resolved = resolveDrop({ moves, tileId: "t", layout, targets, hit: null });
      assert.notEqual(resolved.action, "none");
    }
  }
  section("Property: legalMoves.length > 0 never yields \"no executable UI path\"");
}

// ---------------------------------------------------------------------
// G. Diagnostics: safe metadata only, no hand/tile/pip leakage.
// ---------------------------------------------------------------------
{
  const row = dragDropDiag("legal_tile_drop_unresolved", {
    ruleset: "haitian",
    legalEndCount: 2,
    measuredTargetCount: 1,
    destinationTypes: ["left", "right"],
    boardTileCount: 25,
    spinnerActive: true,
    resolvedByHitTest: false,
    recoveryAction: DRAG_DROP_RECOVERY.PARTIAL_TARGET,
    tapLike: false,
    matchId: "98bd12ce-c1cb-4b01-87dd-55d70f492d79",
    clientKnownVersion: 225,
  });
  assert.equal(row.ruleset, "haitian");
  assert.equal(row.legal_end_count, 2);
  assert.equal(row.measured_target_count, 1);
  assert.equal(row.recovery_action, DRAG_DROP_RECOVERY.PARTIAL_TARGET);
  assert.equal(row.board_tile_count, 25);
  assert.equal(row.spinner_active, true);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /1-5|"tileId"|"hand"|"pip"/i, "no tile id / hand / pip content leaks");
  section("Diagnostics: LEGAL_TILE_DROP_UNRESOLVED carries only safe, whitelisted fields");
}

// ---------------------------------------------------------------------
// I. Single-legal-end cancel safety.
//
// A tile with exactly one legal end must still recover from missing/
// unmeasurable DOM geometry (I never gates on DOM availability), but a
// clearly-off-the-table drop must NOT force that recovery into a play.
// Classification uses only 2D geometry against the table felt rect — no
// timestamps, no DOM availability as legality authority (legality is still
// legalEnds, from the authoritative engine, throughout).
// ---------------------------------------------------------------------
{
  const state = baseEngineState({
    rulesetId: "legacy",
    // Non-double board tile exposes DIFFERENT pips at each end (3 vs 1), so
    // a tile matching only one of them has exactly one legal destination —
    // unlike a lone double, which exposes the same pip on both ends.
    board: [{ id: "3-1", left: 3, right: 1, orientation: "horizontal" }],
    players: [{ id: "a", hand: ["1-5", "0-0"] }, { id: "b", hand: ["4-4", "6-6"] }],
  });
  const moves = getAvailableActions(state).legalMoves;
  const legalEnds = legalEndsForTile(moves, "1-5");
  assert.equal(legalEnds.length, 1, "precondition: exactly one legal end");
  const layout = { board: state.board, spinnerId: state.spinnerId, rulesetId: state.rulesetId };
  const tableRect = { left: 100, top: 100, right: 500, bottom: 500 };

  // A. Missing DOM target, genuine drop intent (well inside the felt) →
  // still recoverable/playable.
  {
    const resolved = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: { clientX: 300, clientY: 300, tableRect },
    });
    assert.equal(resolved.action, "place");
    const next = playTile(state, "1-5", resolved.end);
    assert.ok(next.phase, "engine accepts the recovered single-end play");
  }

  // B. Obvious far-away cancel gesture (released well outside the felt,
  // beyond the cancel-zone pad) → must NOT auto-play.
  {
    const resolved = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: {
        clientX: tableRect.left - TABLE_CANCEL_ZONE_PAD_PX - 200,
        clientY: tableRect.top - TABLE_CANCEL_ZONE_PAD_PX - 200,
        tableRect,
      },
    });
    assert.equal(resolved.action, "cancelled", "far-away release must not force a play");
  }

  // C. Endpoint temporarily remounted (no measurable rect at pointer-up)
  // but the drop itself is on the table → still recoverable. Identical to
  // A in this model (a remount and a permanently-missing node look the
  // same at the instant of query) — the point is the gate does not depend
  // on *why* the DOM was unmeasurable, only on where the drop landed.
  {
    const resolved = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: { clientX: tableRect.left + 5, clientY: tableRect.top + 5, tableRect },
    });
    assert.equal(resolved.action, "place", "remounted/missing target on-table drop still recovers");
  }

  // D. Repeated retry after a cancel still works — the classifier is a pure
  // per-call function with no memory of the previous cancelled attempt.
  {
    const cancelled = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: { clientX: -9999, clientY: -9999, tableRect },
    });
    assert.equal(cancelled.action, "cancelled");
    const retried = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: { clientX: 300, clientY: 300, tableRect },
    });
    assert.equal(retried.action, "place", "a prior cancel must not block a subsequent genuine attempt");
  }

  // Unmeasurable table rect itself must never block the legal move either —
  // fails open toward recoverability, exactly like a missing per-end target.
  {
    const resolved = resolveDrop({
      moves,
      tileId: "1-5",
      layout,
      hit: null,
      drop: { clientX: 99999, clientY: 99999, tableRect: null },
    });
    assert.equal(resolved.action, "place", "unmeasurable table rect fails open, not closed");
  }

  section("Single-legal-end cancel safety: recoverable on-table, cancels off-table, retry-safe");
}

// ---------------------------------------------------------------------
// H. Source-wiring guard — keep OnlineGamePage.jsx's real finishDrag in
// sync with the decision sequence proven above (regression tripwire).
// ---------------------------------------------------------------------
{
  const finish = onlinePage.slice(
    onlinePage.indexOf("const finishDrag"),
    onlinePage.indexOf("const dragging")
  );
  assert.match(finish, /pickTargetDestination\(\s*clientX,\s*clientY/);
  assert.match(finish, /if \(!legalEnds\.length\) return;/);
  assert.match(finish, /isPlausiblePlayDrop\(clientX, clientY, tableRect\)/);
  assert.match(finish, /querySelector\("\.game-table__felt"\)/);
  assert.match(finish, /resolvePlayWithoutDomTargets\(\{ legalEnds, equivalent, autoEnd \}\)/);
  assert.match(finish, /dragDropDiag\("legal_tile_drop_unresolved"/);
  assert.match(finish, /dragDropDiag\("legal_tile_drop_recovery"/);
  assert.match(finish, /dragDropDiag\("legal_tile_drop_cancelled"/);
  assert.match(finish, /setSelectedId\(current\.tileId\)/);
  // The old bug: recovery gated behind !hasUsableDomTargets so a partial
  // target set (one of two ends measurable) fell through untouched. Must
  // no longer be true — resolvePlayWithoutDomTargets now runs whenever the
  // hit-test itself failed, independent of hasUsableDomTargets.
  assert.doesNotMatch(
    finish,
    /if \(!hasUsableDomTargets\(targets\) && legalEnds\.length\) \{/,
    "recovery must not be gated behind the all-or-nothing hasUsableDomTargets check"
  );
  section("OnlineGamePage.finishDrag wiring matches the proven shared recovery sequence (incl. cancel gate)");
}

console.log("Drag/drop resilience tests passed.");
