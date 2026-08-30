/**
 * Match-ready → live online table wiring contract.
 * Run: node src/ui/onlineTable.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const findMatch = read("pages/FindMatchPage.jsx");
const onlinePage = read("pages/OnlineGamePage.jsx");
const gamePage = read("pages/GamePage.jsx");
const hook = read("hooks/useOnlineMatch.js");
const matchHook = read("hooks/useMatch.js");
const client = read("online/gameplay.js");

assert.match(app, /onEnterMatch=\{handleEnterOnlineMatch\}/);
assert.match(app, /mode: ONLINE_MODE/);
assert.match(app, /matchId,/);
assert.match(app, /<OnlineGamePage/);
assert.match(app, /matchOptions\?\.mode === ONLINE_MODE/);
assert.match(app, /readOnlineSession/);
assert.match(app, /getMatchWithPlayers\(saved\.matchId\)/);
assert.match(app, /cleanupStaleOccupiedMatches/);
assert.match(hook, /touchMyMatchPresence/);
assert.doesNotMatch(app, /rulesetId: "classic"/);

{
  const enter = findMatch.slice(
    findMatch.indexOf("const handleEnterTable"),
    findMatch.indexOf("const handleBack")
  );
  assert.match(enter, /onEnterMatch\?\.\(/);
  assert.match(enter, /matchId: matched\.id/);
  assert.match(enter, /rulesetId: matched\.rulesetId/);
  assert.doesNotMatch(enter, /selectedId/);
  assert.doesNotMatch(enter, /enterOnlineMatch/);
}
assert.match(findMatch, /data-find-match-enter="true"/);
assert.match(findMatch, /findMatch\.enterTable/);
assert.doesNotMatch(findMatch, /enterOnlineMatch|getGameView|submitGameAction|game_secrets/);
assert.doesNotMatch(findMatch, /chat|sendMessage/);

assert.match(onlinePage, /useOnlineMatch/);
assert.match(onlinePage, /data-online-table="true"/);
assert.match(onlinePage, /className="game-page__hud-match"/);
assert.match(onlinePage, /game-page__hud-match-tags/);
assert.match(onlinePage, /data-online-match-id/);
assert.match(onlinePage, /data-online-ruleset/);
assert.match(onlinePage, /playTile\(/);
assert.match(onlinePage, /submitGameAction|playTile/);
{
  const pointer = onlinePage.slice(
    onlinePage.indexOf("const handleTilePointerDown"),
    onlinePage.indexOf("const finishDrag")
  );
  assert.match(
    pointer,
    /handleTilePointerDown = \(event, tileId\)/,
    "PlayerPanel passes tile.id string, not a tile object"
  );
  assert.match(pointer, /humanHand.find\(\(entry\) => entry.id === tileId\)/);
  assert.match(pointer, /setPointerCapture/);
  assert.doesNotMatch(pointer, /tile\?\.id/);
}
assert.match(onlinePage, /opaqueReserveIds/);
assert.match(onlinePage, /handTilesFromView/);
assert.match(onlinePage, /tileCount=\{view\.handCounts/);
assert.doesNotMatch(onlinePage, /opponentHand/);
assert.match(onlinePage, /scores=\{scores\}/);
assert.doesNotMatch(onlinePage, /useMatch\(/);
assert.doesNotMatch(onlinePage, /game_secrets|from\("game_sessions"\)|from\("game_actions"\)/);
assert.doesNotMatch(onlinePage, /Sentry\.nativeCrash/);
assert.match(onlinePage, /phase === PHASE\.MATCH_OVER|matchOver/);
assert.match(onlinePage, /MatchOverModal/);
assert.match(onlinePage, /tableEpochFromView/);
assert.match(onlinePage, /roundIdentityFromView/);
assert.match(onlinePage, /key=\{roundIdentity\}/);
assert.match(onlinePage, /data-online-board-epoch=\{tableEpoch\}/);
assert.match(onlinePage, /data-online-round-identity=\{roundIdentity\}/);
assert.match(onlinePage, /data-online-advance="true"/);
assert.match(onlinePage, /busy \|\| !roundOver \|\| matchOver/);
assert.match(onlinePage, /isInteractableTurn\(view\)/);
assert.match(onlinePage, /serviceOutage/);
assert.match(onlinePage, /!serviceOutage && isInteractableTurn\(view\)/);
assert.match(onlinePage, /data-online-outage/);
assert.match(onlinePage, /online\.serviceUnavailable/);
assert.match(hook, /shouldDisableGameplayActions/);
assert.match(hook, /shouldSuppressTimeoutResolve/);
assert.match(hook, /serviceOutage/);
assert.match(onlinePage, /hasCoherentInteraction/);
assert.doesNotMatch(onlinePage, /const isHumanTurn = isViewerTurn\(view\)/);
assert.match(onlinePage, /onlineDragGate/);
assert.match(onlinePage, /dragRef\.current = nextDrag/);
assert.match(onlinePage, /dragRef\.current = null/);
assert.doesNotMatch(onlinePage, /dragRef\.current = drag/);
assert.match(onlinePage, /setDragLock\(false\)/);
assert.match(onlinePage, /hiddenIds=\{hiddenIds\}/);
assert.match(onlinePage, /viewRef/);
assert.match(onlinePage, /pointercancel", onCancel/);
assert.match(onlinePage, /optimisticPlayPreview/);
assert.match(onlinePage, /pendingPlay/);
assert.match(onlinePage, /roundBanner/);
assert.match(onlinePage, /pendingPlay\.roundIdentity === roundIdentity/);
assert.match(hook, /shouldRefreshViewerAfterRealtime/);
assert.doesNotMatch(hook, /MOTION\.celebrationMs/);
assert.doesNotMatch(hook, /from ["'].*motion/);
assert.match(hook, /roundAdvanceAtVersionRef/);
assert.match(hook, /isRoundOverView/);
assert.match(hook, /forfeitOnlineMatch/);
assert.match(hook, /clearOnlineSession/);
assert.match(hook, /ONLINE_ACTION_TIMEOUT_MS/);
assert.match(hook, /STALE_VERSION/);
assert.doesNotMatch(onlinePage, /pointercancel", onUp/);

assert.match(gamePage, /useMatch\(/);
assert.doesNotMatch(gamePage, /useOnlineMatch|enterOnlineMatch|getGameView|submitGameAction/);
assert.doesNotMatch(gamePage, /setDragLock|mergeRealtimeSessionView/);

assert.doesNotMatch(matchHook, /enterOnlineMatch|getGameView|game_sessions/);

assert.match(hook, /enterOnlineMatch/);
assert.match(hook, /getGameView/);
assert.match(hook, /submitGameAction/);
assert.match(hook, /subscribeGameSession/);
assert.match(hook, /stop\(\)/);
assert.match(hook, /keepAuthoritativeView|applyView/);
assert.match(hook, /onlineErrorKey\(error\)/);
assert.match(hook, /refreshView/);
assert.match(hook, /advanceOnlineRound/);
assert.match(hook, /resolveTurnTimeout/);
assert.match(hook, /TIMEOUT_NOT_DUE/);
assert.match(onlinePage, /remainingTurnMs/);
assert.match(onlinePage, /timeoutStrike/);
assert.match(onlinePage, /youLostTimeout|matchLostTimeout/);
assert.match(hook, /isRoundOverView/);
assert.match(hook, /mergeRealtimeSessionView/);
assert.match(hook, /setDragLock/);
assert.match(hook, /dragLockRef/);
assert.match(hook, /force: true/);
assert.match(hook, /preferIncoming/);
assert.match(hook, /shouldFlushPendingView/);
assert.match(hook, /shouldReleaseBusy/);
assert.match(hook, /asViewerSnapshot/);
assert.match(hook, /refreshInFlightRef/);
assert.match(hook, /refreshQueuedRef/);
assert.doesNotMatch(hook, /, 40\)/);
assert.doesNotMatch(hook, /window\.setTimeout\(timer/);
assert.doesNotMatch(hook, /sanitizeGameView/);
assert.doesNotMatch(hook, /from ["'].*useMatch/);
assert.doesNotMatch(hook, /from\("game_secrets"\)/);
assert.match(hook, /type: "play"/);
assert.match(hook, /type: "draw"/);
assert.match(hook, /type: "pass"/);
assert.doesNotMatch(hook, /tileId: .*draw/);

assert.match(client, /functions\.invoke\("online-game"/);

console.log("  ✓ online table UI wiring");
