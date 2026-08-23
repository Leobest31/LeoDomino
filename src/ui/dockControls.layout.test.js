/**
 * PASS / NEW MATCH stay anchored while the player hand shrinks.
 * Run: node src/ui/dockControls.layout.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  rectsOverlap,
  resolveDockControlGeometry,
  resolveGameplayLayout,
} from "./gameplayLayout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const TOL = 0.51;
const HAND_COUNTS = [7, 5, 3, 2, 1];
const PORTRAITS = [
  { name: "iphone", width: 390, height: 844 },
  { name: "android-small", width: 360, height: 640 },
  { name: "android-tall", width: 412, height: 915 },
];

const bottomCss = read("components/BottomBar.css");
const gameCss = read("pages/GamePage.css");
const bottomBar = read("components/BottomBar.jsx");

assert.match(bottomCss, /width:\s*100%/, "dock bar spans the gameplay width");
assert.match(
  bottomCss,
  /grid-template-columns:[\s\S]*minmax\(0,\s*1fr\)/,
  "hand column is the flexible middle region"
);
const dockGrids = bottomCss.match(/grid-template-columns:\s*[^;]+/g) || [];
assert.ok(dockGrids.length > 0, "dock declares independent columns");
for (const grid of dockGrids) {
  assert.doesNotMatch(grid, /\bauto\b/, `outer columns must not collapse: ${grid}`);
}
assert.doesNotMatch(
  bottomCss,
  /\.bottom-bar__inner[\s\S]{0,180}margin:\s*0 auto/,
  "inner dock is not a content-sized centered row"
);
assert.match(
  gameCss,
  /\.game-page\[data-orientation="portrait"\][\s\S]*?\.bottom-bar__inner[\s\S]*?minmax\(0,\s*1fr\)/,
  "portrait dock uses a 3-region grid"
);
const portraitBar = gameCss.match(
  /\.game-page\[data-orientation="portrait"\] \.game-page__dock \.bottom-bar \{[^}]+\}/
);
assert.ok(portraitBar, "portrait dock bar rule exists");
assert.match(portraitBar[0], /width:\s*100%/, "portrait dock bar is full width, not a centered cluster");
assert.doesNotMatch(
  portraitBar[0],
  /justify-content:\s*center/,
  "portrait dock is not a single centered flex group"
);
assert.match(bottomBar, /data-dock-pass/, "PASS is measurable");
assert.match(bottomBar, /data-dock-new-match/, "NEW MATCH is measurable");

function sameBox(a, b, label) {
  assert.ok(Math.abs(a.left - b.left) <= TOL, `${label} left drifted ${a.left} → ${b.left}`);
  assert.ok(Math.abs(a.right - b.right) <= TOL, `${label} right drifted ${a.right} → ${b.right}`);
  assert.ok(Math.abs(a.top - b.top) <= TOL, `${label} top drifted ${a.top} → ${b.top}`);
  assert.ok(Math.abs(a.bottom - b.bottom) <= TOL, `${label} bottom drifted ${a.bottom} → ${b.bottom}`);
}

for (const vp of PORTRAITS) {
  const L = resolveGameplayLayout(vp, { playerCount: 2, rulesetId: "legacy" });
  const baseline = resolveDockControlGeometry(L, 7);

  assert.ok(baseline.pass.left <= TOL, `${vp.name} PASS stays on the left edge`);
  assert.ok(
    Math.abs(baseline.newMatch.right - L.safeW) <= TOL,
    `${vp.name} NEW MATCH stays on the right edge`
  );

  for (const count of HAND_COUNTS) {
    const geo = resolveDockControlGeometry(L, count);
    sameBox(geo.pass, baseline.pass, `${vp.name} PASS @ ${count} tiles`);
    sameBox(geo.newMatch, baseline.newMatch, `${vp.name} NEW MATCH @ ${count} tiles`);

    assert.ok(geo.hand.left >= geo.handRegion.left - TOL, `${vp.name} ${count} hand stays in middle`);
    assert.ok(geo.hand.right <= geo.handRegion.right + TOL, `${vp.name} ${count} hand stays in middle`);
    assert.ok(
      geo.hand.left >= geo.pass.right - TOL,
      `${vp.name} ${count} hand is to the right of PASS`
    );
    assert.ok(
      geo.hand.right <= geo.newMatch.left + TOL,
      `${vp.name} ${count} hand is to the left of NEW MATCH`
    );
    assert.equal(
      rectsOverlap(geo.hand, geo.pass, TOL),
      false,
      `${vp.name} ${count} hand overlaps PASS`
    );
    assert.equal(
      rectsOverlap(geo.hand, geo.newMatch, TOL),
      false,
      `${vp.name} ${count} hand overlaps NEW MATCH`
    );

    const regionMid = (geo.handRegion.left + geo.handRegion.right) / 2;
    const handMid = (geo.hand.left + geo.hand.right) / 2;
    assert.ok(
      Math.abs(handMid - regionMid) <= TOL,
      `${vp.name} ${count} hand recenters in the middle region`
    );
  }

  const seven = resolveDockControlGeometry(L, 7);
  const one = resolveDockControlGeometry(L, 1);
  assert.ok(
    one.hand.right - one.hand.left < seven.hand.right - seven.hand.left - 1,
    `${vp.name} shrinking the hand does not move the outer buttons`
  );
}

console.log("Dock control layout tests passed.");
