/**
 * Tap-select → tap-end + drag ownership contracts.
 * Run: node src/ui/endpointPlay.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyHandPointerGesture, TILE_DRAG_ROOT_CLASS } from "./handTilePointer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const online = read("pages/OnlineGamePage.jsx");
const game = read("pages/GamePage.jsx");
const board = read("board/BoardContainer.jsx");
const dest = read("game/destinationTarget.js");
const hand = read("ui/handTilePointer.js");
const panelCss = read("components/PlayerPanel.css");
const ghostCss = read("components/DragGhost.css");
const classicCss = read("components/Domino.css");
const timeout = read("online/actionTimeout.js");

assert.match(online, /setSelectedId\(\(current\) => \(current === tileId \? null : tileId\)\)/);
assert.doesNotMatch(
  online.slice(online.indexOf("const handleTileSelect"), online.indexOf("const handleTilePointerDown")),
  /placeTile\(/
);
assert.match(online, /handleEndpointActivate/);
assert.match(online, /onEndpointActivate=\{handleEndpointActivate\}/);
assert.match(online, /legalDropEnds=\{dropLegalEnds\}/);
assert.match(online, /placeTile\(selectedId, end\)/);
assert.match(game, /handleEndpointActivate/);
assert.match(game, /placeTileOnBoard\(selectedId, end\)/);
assert.doesNotMatch(
  game.slice(game.indexOf("const handleTileSelect"), game.indexOf("const handleEndpointActivate")),
  /placeTileOnBoard\(/
);

assert.match(board, /data-endpoint-hit/);
assert.match(board, /pickTargetDestination\(event\.clientX, event\.clientY/);
assert.match(dest, /endpointDropRect/);
assert.match(dest, /endpointAnchorPoint/);

assert.match(hand, /captureTileDragPointer/);
assert.match(hand, /releaseTileDragPointer/);
assert.match(hand, /TILE_DRAG_ROOT_CLASS/);
assert.match(online, /captureTileDragPointer/);
assert.match(online, /lostpointercapture/);
assert.match(game, /lostpointercapture/);
assert.match(panelCss, /html\.is-tile-dragging \.player-panel__tray/);
assert.equal(TILE_DRAG_ROOT_CLASS, "is-tile-dragging");
assert.equal(classifyHandPointerGesture(24, 4), "scroll");
assert.equal(classifyHandPointerGesture(4, -24), "drag");

assert.match(ghostCss, /position:\s*absolute/);
assert.match(classicCss, /\.domino--dragging[\s\S]*?pointer-events:\s*auto/);
assert.match(online, /ghostPositionInRoot/);
assert.match(game, /ghostPositionInRoot/);
assert.match(online, /pointerClientPoint/);

assert.match(timeout, /ONLINE_ACTION_TIMEOUT_MS = 15000/);
assert.match(online, /playTile\(tileId, chosen\.end\)/);

console.log("  ✓ tap-select → tap-end, drag ownership, same play pipeline");
