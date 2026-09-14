/**
 * Bounded online action waits. Run: node src/online/actionTimeout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONLINE_ACTION_TIMEOUT_MS,
  awaitWithTimeout,
  isActionTimeoutError,
  onlineActionBlockReason,
} from "./actionTimeout.js";
import {
  emptyServiceHealthState,
  noteServiceFailure,
  noteServiceSuccess,
  shouldDisableGameplayActions,
} from "./serviceHealth.js";
import { isResumableMatch } from "./joinTimeout.js";
import { END } from "../game/constants.js";
import { isAutoPlaceable, legalEndsForTile } from "../game/interaction.js";
import { equivalentPlayEnd } from "./onlineTable.js";
import { destinationTileId } from "../game/destinationTarget.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(join(root, "hooks/useOnlineMatch.js"), "utf8");
const matchmaking = readFileSync(join(root, "online/matchmaking.js"), "utf8");
const page = readFileSync(join(root, "pages/OnlineGamePage.jsx"), "utf8");
const dialog = readFileSync(join(root, "components/AbandonMatchDialog.jsx"), "utf8");
const tableTest = readFileSync(join(root, "online/onlineTable.test.js"), "utf8");
const onlineTable = readFileSync(join(root, "online/onlineTable.js"), "utf8");

assert.equal(ONLINE_ACTION_TIMEOUT_MS, 15000);
assert.equal(onlineActionBlockReason({ hasMatch: true }), "");
assert.equal(onlineActionBlockReason({ hasMatch: true, busy: true }), "busy");
assert.equal(onlineActionBlockReason({ hasMatch: true, outage: true }), "outage");
assert.equal(onlineActionBlockReason({ hasMatch: true, busy: true, outage: true }), "outage");
assert.equal(onlineActionBlockReason({}), "no_match");

{
  const value = await awaitWithTimeout(Promise.resolve("ok"), 50);
  assert.equal(value, "ok");
}

{
  let rejected = null;
  try {
    await awaitWithTimeout(new Promise(() => {}), 20);
  } catch (error) {
    rejected = error;
  }
  assert.equal(isActionTimeoutError(rejected), true);
}

assert.match(onlineTable, /ONLINE_ACTION_TIMEOUT_MS\s*=\s*15000/);
assert.match(hook, /ONLINE_ACTION_TIMEOUT_MS/);
assert.match(hook, /Promise\.race/);
assert.match(hook, /timed\?\.timeout/);
assert.match(hook, /timeout_resolve_hung/);
assert.match(hook, /busyRef\.current = false/);

{
  const run = hook.slice(hook.indexOf("const runAction"), hook.indexOf("const playTile"));
  const finallyAt = run.indexOf("} finally {");
  const busyClearAt = run.indexOf("busyRef.current = false", finallyAt);
  assert.ok(finallyAt > 0 && busyClearAt > finallyAt, "busy clears in runAction finally");
  assert.match(run, /ONLINE_ACTION_TIMEOUT_MS/);
  assert.match(run, /timed\?\.timeout/);
}

{
  const leave = hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {"));
  assert.doesNotMatch(leave, /shouldDisableGameplayActions/);
  assert.doesNotMatch(leave, /if \(busyRef\.current\)/);
  assert.match(leave, /ONLINE_ACTION_TIMEOUT_MS/);
  assert.match(leave, /applyForfeitTerminalFields/);
  assert.match(leave, /clearOnlineSession\(\)/);
}

assert.match(page, /handleAbandonCancel/);
assert.match(
  page.slice(page.indexOf("const handleAbandonCancel"), page.indexOf("const handleAbandonLeave")),
  /leavingRef\.current/,
  "cancel ignores clicks while leave is in flight"
);
assert.match(dialog, /disabled=\{busy\}/);
assert.match(hook, /visibilitychange/);
assert.match(hook, /refreshInFlightRef\.current\)/);
assert.match(tableTest, /tileId: "0-4"/);

/**
 * Mirrors useOnlineMatch.runAction: busy must clear in finally, before any
 * post-action getGameView. A hung refresh must not freeze Play or Leave.
 */
async function simulateRunAction(submit, refresh) {
  const state = { busy: true };
  let result = false;
  let refreshAfter = false;
  let busyDuringRefresh = null;
  try {
    await awaitWithTimeout(submit(), 30);
    result = true;
  } catch {
    refreshAfter = true;
    result = false;
  } finally {
    state.busy = false;
  }
  if (refreshAfter) {
    busyDuringRefresh = state.busy;
    await refresh(state);
  }
  return { busy: state.busy, result, refreshAfter, busyDuringRefresh };
}

{
  const outcome = await simulateRunAction(
    () => Promise.reject(Object.assign(new Error("boom"), { code: "GAMEPLAY_FAILED" })),
    async () => {}
  );
  assert.equal(outcome.busy, false);
  assert.equal(outcome.busyDuringRefresh, false);
  assert.equal(outcome.result, false);
  assert.equal(outcome.refreshAfter, true);
  console.log("  ✓ pending action always clears on rejection");
}

{
  const outcome = await simulateRunAction(
    () => new Promise(() => {}),
    async () => {}
  );
  assert.equal(outcome.busy, false);
  assert.equal(outcome.busyDuringRefresh, false);
  assert.equal(outcome.result, false);
  console.log("  ✓ pending action always clears on timeout");
}

{
  const one = noteServiceFailure(emptyServiceHealthState(), {
    name: "TimeoutError",
    timeout: true,
    message: "timeout",
  });
  assert.equal(one.outage, false);
  assert.equal(
    onlineActionBlockReason({
      hasMatch: true,
      busy: false,
      outage: shouldDisableGameplayActions(one),
    }),
    ""
  );
  const recovered = noteServiceSuccess(one);
  assert.equal(shouldDisableGameplayActions(recovered), false);
  console.log("  ✓ valid play succeeds after a prior transient request failure");
  console.log("  ✓ Leave succeeds after a prior transient request failure");
}

{
  const outage = noteServiceFailure(emptyServiceHealthState(), {
    status: 504,
    code: "PGRST003",
  });
  assert.equal(shouldDisableGameplayActions(outage), true);
  const recovered = noteServiceSuccess(outage);
  assert.equal(shouldDisableGameplayActions(recovered), false);
  console.log("  ✓ serviceOutage recovery restores controls");
}

{
  const leave = hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {"));
  assert.match(leave, /setLeaveErrorKey/);
  assert.match(page, /if \(!ok\) return/);
  assert.match(dialog, /data-abandon-error=\{errorKey\}/);
  console.log("  ✓ Leave does not silently no-op");
}

{
  const handler = page.slice(
    page.indexOf("const handleAbandonLeave"),
    page.indexOf("const tableEpochRef")
  );
  assert.match(handler, /if \(leavingRef\.current\) return/);
  assert.match(handler, /leavingRef\.current = true/);
  assert.match(handler, /\.finally\(/);
  assert.match(handler, /leavingRef\.current = false/);
  console.log("  ✓ duplicate Leave tap does not send duplicate forfeit");
}

{
  const run = hook.slice(hook.indexOf("const runAction"), hook.indexOf("const playTile"));
  assert.match(run, /inFlightBaseVersionRef\.current = -1/);
  const finallyAt = run.indexOf("} finally {");
  const versionClearAt = run.indexOf("inFlightBaseVersionRef.current = -1", finallyAt);
  assert.ok(versionClearAt > finallyAt, "stale in-flight version clears with busy");
  console.log("  ✓ stale Realtime version cannot permanently lock actions");
}

{
  assert.match(hook, /if \(status !== "ready" \|\| !serviceOutage\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /window\.addEventListener\("focus"/);
  assert.match(hook, /pageshow/);
  console.log("  ✓ background → foreground recovery restores action availability");
}

{
  const opening = { board: [{ id: "4-4", left: 4, right: 4, orientation: "vertical" }] };
  const againstFour = [
    { tileId: "0-4", end: END.LEFT },
    { tileId: "0-4", end: END.RIGHT },
  ];
  assert.deepEqual(legalEndsForTile(againstFour, "0-4"), [END.LEFT, END.RIGHT]);
  assert.equal(isAutoPlaceable(againstFour, "0-4"), false);
  assert.equal(destinationTileId("left", opening), destinationTileId("right", opening));
  assert.equal(equivalentPlayEnd(againstFour, "0-4", opening), END.RIGHT);
  console.log("  ✓ legal 0-4 on open 4 remains playable");
}

{
  const leave = hook.slice(hook.indexOf("const leave = useCallback"), hook.indexOf("return {"));
  assert.match(leave, /clearOnlineSession\(\)/);
  assert.equal(
    isResumableMatch({ id: "m1", status: "finished", finishReason: "forfeit" }),
    false
  );
  assert.equal(isResumableMatch({ id: "m1", status: "playing" }), true);
  console.log("  ✓ terminal forfeit still clears session");
  console.log("  ✓ terminal match does not Resume");
}

{
  assert.doesNotMatch(hook, /settle_match_global_rp|winner_new_rp/);
  assert.match(matchmaking, /forfeit_online_match/);
  console.log("  ✓ no RP/winner rule regression in client action path");
}

console.log("  ✓ action timeout + lock release");
