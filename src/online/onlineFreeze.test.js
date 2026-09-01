/**
 * Online table freeze recovery — drag lifecycle, tap-to-end, Realtime/focus.
 * Does not change engine legality, 60s timeout, strikes, scoring, or RP.
 * Run: node src/online/onlineFreeze.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachCapturedPointerTracking, pointerStillDown } from "../ui/handTilePointer.js";
import {
  endChoiceI18nKey,
  hasUsableDomTargets,
  isUnhealthyRealtimeStatus,
  resolvePlayWithoutDomTargets,
  shouldBypassDragLock,
  shouldClearLocalInteraction,
  shouldRefreshAuthoritativeViewOnResume,
} from "./interactionRecovery.js";
import { TIMEOUT_STRIKE_LIMIT, TURN_TIMEOUT_MS } from "./turnTimeout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const onlinePage = read("pages/OnlineGamePage.jsx");
const gamePage = read("pages/GamePage.jsx");
const hook = read("hooks/useOnlineMatch.js");
const gameplay = read("online/gameplay.js");
const board = read("board/BoardContainer.jsx");
const pointer = read("ui/handTilePointer.js");
const timeout = read("online/turnTimeout.js");
const authority = read("online/gameAuthority.js");

function fakeTarget() {
  const listeners = {};
  return {
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((row) => row !== fn);
    },
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };
}

function playingView(extras = {}) {
  return {
    matchId: "match-freeze",
    phase: "playing",
    status: "playing",
    version: 10,
    currentSeat: 0,
    round: 2,
    ...extras,
  };
}

{
  const start = onlinePage.slice(
    onlinePage.indexOf("const startDrag"),
    onlinePage.indexOf("if (shouldDeferHandDrag")
  );
  assert.match(
    start,
    /bindDragPointerTracking\(pointerEvent\.pointerId\)/,
    "pointerup/cancel/lostpointercapture bind from drag start, not only a later effect"
  );
  assert.match(pointer, /lostpointercapture/);
  assert.match(onlinePage, /lostpointercapture|attachCapturedPointerTracking/);
  assert.match(gamePage, /attachCapturedPointerTracking/);
  console.log("  ✓ pointerup can happen before deferred drag effect");
}

{
  const target = fakeTarget();
  let cancelled = 0;
  let finished = 0;
  const stop = attachCapturedPointerTracking(target, {
    onMove() {},
    onUp() {
      finished += 1;
    },
    onCancel() {
      cancelled += 1;
    },
  });
  target.dispatch("pointercancel", { pointerId: 1 });
  assert.equal(cancelled, 1, "pointercancel clears drag");
  target.dispatch("pointerup", { pointerId: 1 });
  assert.equal(finished, 0, "ended flag prevents a second exit after cancel");
  stop();
  console.log("  ✓ pointercancel clears drag");
}

{
  const target = fakeTarget();
  let cancelled = 0;
  const stop = attachCapturedPointerTracking(target, {
    onMove() {},
    onUp() {},
    onCancel() {
      cancelled += 1;
    },
  });
  target.dispatch("lostpointercapture", { pointerId: 1 });
  assert.equal(cancelled, 1, "lostpointercapture clears drag");
  target.dispatch("pointercancel", { pointerId: 1 });
  assert.equal(cancelled, 1, "lostpointercapture and cancel share a single exit");
  stop();
  console.log("  ✓ lostpointercapture clears drag");
}

{
  const previous = playingView({ version: 10, currentSeat: 0 });
  const next = playingView({ version: 11, currentSeat: 0 });
  assert.equal(shouldClearLocalInteraction(previous, next), true);
  assert.equal(shouldBypassDragLock(previous, next), true);
  assert.match(onlinePage, /shouldClearLocalInteraction/);
  console.log("  ✓ server version change clears stale drag");
}

{
  const previous = playingView({ version: 10, currentSeat: 0 });
  const next = playingView({ version: 10, currentSeat: 1 });
  assert.equal(shouldClearLocalInteraction(previous, next), true);
  assert.match(onlinePage, /setSelectedId\(null\)/);
  console.log("  ✓ currentSeat change clears stale selected/end-choice state");
}

{
  const previous = playingView({ version: 10 });
  const timedOut = {
    ...previous,
    version: 11,
    phase: "match_over",
    status: "match_over",
  };
  assert.equal(shouldClearLocalInteraction(previous, timedOut), true);
  assert.equal(shouldBypassDragLock(previous, timedOut), true);
  assert.match(hook, /shouldBypassDragLock/);
  assert.match(hook, /applyView\(next, \{ force: true \}\)/);
  console.log("  ✓ timeout transition while drag exists unlocks the hand");
}

{
  assert.match(onlinePage, /handleEndpointActivate/);
  assert.match(onlinePage, /onEndpointActivate=\{isHumanTurn && !busy \? handleEndpointActivate/);
  assert.match(onlinePage, /data-end-choice=\{end\}/);
  assert.match(onlinePage, /data-end-choice=""/);
  assert.match(board, /data-endpoint-hit/);
  assert.match(board, /onEndpointActivate\(endpointEnd\)/);
  assert.equal(endChoiceI18nKey("left"), "game.chooseLeftEnd");
  assert.equal(endChoiceI18nKey("right"), "game.chooseRightEnd");
  assert.match(onlinePage, /t\(endChoiceI18nKey\(end\)\)/);
  console.log("  ✓ two-end Classic tile supports tap-left and tap-right");
}

{
  const choose = resolvePlayWithoutDomTargets({
    legalEnds: ["left", "right"],
    equivalent: null,
    autoEnd: null,
  });
  assert.equal(choose.action, "choose");
  const cancel = resolvePlayWithoutDomTargets({ legalEnds: [] });
  assert.equal(cancel.action, "cancel");
  const place = resolvePlayWithoutDomTargets({
    legalEnds: ["left", "right"],
    equivalent: "left",
  });
  assert.equal(place.action, "place");
  assert.equal(place.end, "left");
  assert.equal(hasUsableDomTargets([]), false);
  assert.equal(hasUsableDomTargets([{ end: "left", rect: { x: 0 } }]), true);
  assert.match(onlinePage, /resolvePlayWithoutDomTargets/);
  assert.match(onlinePage, /hasUsableDomTargets/);
  assert.match(onlinePage, /setSelectedId\(current\.tileId\)/);
  console.log("  ✓ empty/missing DOM drop targets do not strand the player");
}

{
  assert.equal(shouldRefreshAuthoritativeViewOnResume(playingView()), true);
  assert.equal(
    shouldRefreshAuthoritativeViewOnResume({ phase: "match_over", status: "match_over" }),
    false
  );
  assert.match(hook, /shouldRefreshAuthoritativeViewOnResume/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /window\.addEventListener\("focus", refreshIfPlaying\)/);
  assert.match(hook, /refreshView\(\{ force: true \}\)/);
  console.log("  ✓ missed Realtime + visibility return refetches authoritative view");
}

{
  assert.equal(isUnhealthyRealtimeStatus("CHANNEL_ERROR"), true);
  assert.equal(isUnhealthyRealtimeStatus("CLOSED"), true);
  assert.equal(isUnhealthyRealtimeStatus("SUBSCRIBED"), false);
  assert.match(gameplay, /onStatus\?\.\(status\)/);
  assert.match(hook, /isUnhealthyRealtimeStatus/);
  assert.match(hook, /subscribeGameSession\(matchId, onEvent, undefined, onStatus\)/);
  console.log("  ✓ Realtime channel error can recover via getGameView");
}

{
  assert.match(onlinePage, /pickTargetDestination\(\s*clientX,\s*clientY/);
  assert.match(onlinePage, /setPointerCapture/);
  assert.match(onlinePage, /bindDragPointerTracking\(pointerEvent\.pointerId\)/);
  console.log("  ✓ normal drag/drop still works");
}

{
  const select = onlinePage.slice(
    onlinePage.indexOf("const handleTileSelect"),
    onlinePage.indexOf("const stopDragTracking")
  );
  assert.match(select, /isAutoPlaceable\(moves, tileId\)/);
  assert.match(select, /placeTile\(tileId, autoEnd\)/);
  assert.doesNotMatch(select, /setSelectedId\(tileId\).*isAutoPlaceable/);
  console.log("  ✓ one-end tile behavior remains unchanged");
}

{
  assert.equal(TURN_TIMEOUT_MS, 60_000);
  assert.equal(TIMEOUT_STRIKE_LIMIT, 3);
  assert.match(timeout, /export const TURN_TIMEOUT_MS = 60 \* 1000/);
  assert.match(timeout, /export const TIMEOUT_STRIKE_LIMIT = 3/);
  assert.match(authority, /applyTimeoutResolution/);
  assert.match(onlinePage, /timeoutStrike/);
  assert.doesNotMatch(onlinePage, /TURN_TIMEOUT_MS\s*=/);
  console.log("  ✓ true AFK timeout still produces strikes normally");
}

{
  assert.equal(pointerStillDown({ buttons: 1, pointerType: "mouse" }), true);
  assert.equal(pointerStillDown({ buttons: 0, pointerType: "mouse" }), false);
  assert.equal(pointerStillDown({ buttons: 0, pointerType: "touch" }), true);
  console.log("  ✓ deferred mouse lift does not start a stuck drag");
}

console.log("  ✓ online freeze recovery");
