/**
 * Player-hand rack: one row, scroll between Pass / New Match, no shrink-to-fit.
 * Run: node src/ui/playerHandScroll.layout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGameplayLayout } from "./gameplayLayout.js";
import {
  classifyHandPointerGesture,
  HAND_GESTURE_DECIDE_PX,
  handTrayCanScroll,
  shouldDeferHandDrag,
} from "./handTilePointer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const panelCss = read("components/PlayerPanel.css");
const panelJsx = read("components/PlayerPanel.jsx");
const gameCss = read("pages/GamePage.css");
const bottomCss = read("components/BottomBar.css");
const gamePage = read("pages/GamePage.jsx");
const onlinePage = read("pages/OnlineGamePage.jsx");

assert.match(panelJsx, /data-hand-scroll/, "tray is the named scrollport");
assert.match(panelCss, /\.player-panel__tray[\s\S]*?overflow-x:\s*auto/, "tray scrolls horizontally");
assert.match(panelCss, /\.player-panel__tray[\s\S]*?overflow-y:\s*hidden/, "tray does not wrap vertically");
assert.match(panelCss, /\.player-panel__tray[\s\S]*?width:\s*100%/, "tray fills the middle dock column");
assert.match(panelCss, /\.player-panel__tray[\s\S]*?min-width:\s*0/, "tray can shrink inside the grid");
assert.doesNotMatch(
  panelCss,
  /\.player-panel__tray[\s\S]*?width:\s*fit-content/,
  "tray must not grow to the full tile row"
);
assert.match(panelCss, /\.player-panel__hand[\s\S]*?flex-wrap:\s*nowrap/, "one horizontal row");
assert.match(panelCss, /\.player-panel__hand[\s\S]*?width:\s*max-content/, "tiles keep their laid-out size");
assert.match(panelCss, /\.player-panel__hand[\s\S]*?min-width:\s*100%/, "short hands stay centered");
assert.match(panelCss, /\.player-panel__hand[\s\S]*?white-space:\s*nowrap/, "row does not wrap text/tiles");
assert.match(panelCss, /touch-action:\s*pan-x/, "touch can pan the overflowing rack");
assert.match(panelCss, /scrollbar-width:\s*none/, "visual scrollbar is hidden");
assert.match(panelCss, /\.player-panel__tray::-webkit-scrollbar/, "webkit scrollbar is hidden");
assert.match(panelCss, /-webkit-overflow-scrolling:\s*touch/, "iOS momentum scrolling");
assert.match(panelCss, /overscroll-behavior-x:\s*contain/, "horizontal overscroll stays in the rack");
assert.match(panelCss, /scroll-padding-inline/, "first/last tiles stay fully reachable");
assert.match(panelCss, /\.player-panel__hand > \*[\s\S]*?flex:\s*0 0 auto/, "tiles do not shrink in the row");

assert.match(
  gameCss,
  /\.game-page\[data-orientation="portrait"\][\s\S]*?\.player-panel__tray[\s\S]*?overflow-y:\s*hidden/,
  "portrait tray clips vertically so overflow-x can scroll"
);
assert.doesNotMatch(
  gameCss,
  /\.game-page\[data-orientation="portrait"\][\s\S]*?\.player-panel__tray[\s\S]{0,180}overflow-y:\s*visible/,
  "portrait must not reset overflow-y to visible"
);
assert.match(
  gameCss,
  /\.game-page\[data-orientation="portrait"\][\s\S]*?\.bottom-bar__center[\s\S]*?overflow:\s*hidden/,
  "portrait center column clips under Pass / New Match"
);
assert.match(bottomCss, /\.bottom-bar__center[\s\S]*?overflow:\s*hidden/, "center column is the clip bounds");
assert.match(bottomCss, /\.bottom-bar__center[\s\S]*?min-width:\s*0/, "center column can shrink");

assert.match(gamePage, /shouldDeferHandDrag/, "offline table defers touch drag while the rack can scroll");
assert.match(gamePage, /watchHandScrollOrDrag/, "offline table watches pan vs drag");
assert.match(onlinePage, /shouldDeferHandDrag/, "online table defers touch drag while the rack can scroll");
assert.match(onlinePage, /watchHandScrollOrDrag/, "online table watches pan vs drag");
assert.match(gamePage, /setPointerCapture/, "offline drag still captures after a vertical move");
assert.match(onlinePage, /setPointerCapture/, "online drag still captures after a vertical move");

{
  const L = resolveGameplayLayout({ width: 360, height: 640 });
  const twelve =
    12 * L.playerHandShort + 11 * (L.playerHandGap + L.playerHandOverlap);
  assert.ok(
    twelve > L.handBudget + 8,
    `12 tiles must overflow the 360px rack (${twelve.toFixed(1)} vs budget ${L.handBudget.toFixed(1)})`
  );
  assert.equal(L.playerHandOverlap, 0, "portrait still does not overlap tiles to fake a fit");
}

assert.equal(classifyHandPointerGesture(0, 0), "undecided");
assert.equal(classifyHandPointerGesture(4, 3), "undecided");
assert.equal(classifyHandPointerGesture(24, 4), "scroll");
assert.equal(classifyHandPointerGesture(4, 24), "drag");
assert.equal(classifyHandPointerGesture(-30, 8), "scroll");
assert.equal(classifyHandPointerGesture(8, -30), "drag");
assert.equal(HAND_GESTURE_DECIDE_PX, 10);

{
  const tight = {
    closest() {
      return { scrollWidth: 200, clientWidth: 200 };
    },
  };
  const wide = {
    closest() {
      return { scrollWidth: 480, clientWidth: 220 };
    },
  };
  assert.equal(handTrayCanScroll(tight), false);
  assert.equal(handTrayCanScroll(wide), true);
  assert.equal(shouldDeferHandDrag({ pointerType: "mouse", currentTarget: wide }), false);
  assert.equal(shouldDeferHandDrag({ pointerType: "touch", currentTarget: wide }), true);
  assert.equal(shouldDeferHandDrag({ pointerType: "touch", currentTarget: tight }), false);
}

console.log("Player-hand scroll layout tests passed.");
