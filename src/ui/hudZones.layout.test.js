/**
 * Portrait HUD: Human score | MATCH POINTS | LeoBest score never collide.
 * Run: node src/ui/hudZones.layout.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUD_SCORE_MIN_PX,
  rectsOverlap,
  resolveGameplayLayout,
  resolveHudZoneGeometry,
} from "./gameplayLayout.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const PORTRAIT_WIDTHS = [
  { name: "narrow-360", width: 360, height: 640 },
  { name: "iphone-390", width: 390, height: 844 },
  { name: "android-412", width: 412, height: 915 },
  { name: "iphone-430", width: 430, height: 932 },
];

const headerCss = read("components/Header.css");
const gameCss = read("pages/GamePage.css");
const gamePage = read("pages/GamePage.jsx");
const scoreJsx = read("components/ScoreBoard.jsx");

assert.match(
  headerCss,
  /\.header--stacked \.header__inner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
  "stacked HUD is a 3-zone grid that cannot overlap"
);
assert.match(gamePage, /data-hud-zone="human"/, "human HUD zone is marked");
assert.match(gamePage, /data-hud-zone="match-points"/, "MATCH POINTS zone is marked");
assert.match(gamePage, /data-hud-zone="rival"/, "LeoBest HUD zone is marked");
assert.match(gamePage, /hideRound=\{Boolean\(vsHud && americanHud\)\}/, "American 1v1 center is MATCH POINTS only");
assert.match(gamePage, /ofTarget=\{seatOfTarget\}/, "American seats do not reprint /150");
assert.match(gamePage, /seatOfTarget = ofTargetHud && !americanHud/, "Haitian ofTarget seats stay ofTarget");
assert.match(scoreJsx, /hideRound/, "scoreboard can hide the ROUND line");
assert.doesNotMatch(
  headerCss,
  /\.header--stacked[\s\S]{0,240}transform:\s*scale\(/,
  "stacked header is not globally scaled"
);
assert.doesNotMatch(
  gameCss,
  /\.game-page__chrome[\s\S]{0,280}transform:\s*scale\(/,
  "gameplay chrome is not globally scaled"
);
assert.match(gameCss, /--game-hud-score/, "seat scores stay on the viewport score token");
assert.match(headerCss, /header__home-btn|--game-hud-home/, "Home control stays in the HUD");

for (const vp of PORTRAIT_WIDTHS) {
  const L = resolveGameplayLayout(vp, { playerCount: 2, rulesetId: "american" });
  assert.equal(L.orientation, "portrait", `${vp.name} is portrait`);
  const zones = resolveHudZoneGeometry(L, {
    target: 150,
    humanScore: 150,
    rivalScore: 150,
  });
  assert.equal(
    rectsOverlap(zones.human, zones.matchPoints),
    false,
    `${vp.name} human score overlaps MATCH POINTS`
  );
  assert.equal(
    rectsOverlap(zones.matchPoints, zones.rival),
    false,
    `${vp.name} MATCH POINTS overlaps LeoBest score`
  );
  assert.equal(
    rectsOverlap(zones.human, zones.rival),
    false,
    `${vp.name} player scores overlap each other`
  );
  assert.equal(
    rectsOverlap(zones.matchPoints, zones.homeBox),
    false,
    `${vp.name} MATCH POINTS overlaps Home`
  );
  assert.ok(zones.human.right <= zones.matchPoints.left + 0.01, `${vp.name} human stays left of center`);
  assert.ok(zones.matchPoints.right <= zones.rival.left + 0.01, `${vp.name} center stays left of LeoBest`);
  assert.ok(zones.rival.right <= zones.homeBox.left + 0.51, `${vp.name} LeoBest stays left of Home`);
  const mid = (zones.matchPoints.left + zones.matchPoints.right) / 2;
  assert.ok(
    Math.abs(mid - L.safeW / 2) <= 1,
    `${vp.name} MATCH POINTS is centered (${mid.toFixed(1)} vs ${L.safeW / 2})`
  );
  assert.ok(L.hudAvatar >= 44, `${vp.name} avatars stay intact (${L.hudAvatar})`);
  assert.ok(
    L.hudScore >= HUD_SCORE_MIN_PX,
    `${vp.name} scores stay readable (${L.hudScore})`
  );
  const humanNeed = zones.avatar + zones.clusterGap + zones.scoreW;
  const rivalNeed = zones.avatar + zones.clusterGap + zones.scoreW;
  assert.ok(
    humanNeed <= zones.human.right - zones.human.left + 0.51,
    `${vp.name} human cluster ${humanNeed.toFixed(1)}px overflows ${zones.sideCol.toFixed(1)}px`
  );
  assert.ok(
    rivalNeed <= zones.rival.right - zones.rival.left + 0.51,
    `${vp.name} LeoBest cluster ${rivalNeed.toFixed(1)}px overflows rival column`
  );
}

{
  const haitian = read("pages/GamePage.jsx");
  assert.match(haitian, /seatOfTarget = ofTargetHud && !americanHud/);
  const L = resolveGameplayLayout({ width: 390, height: 844 }, { playerCount: 2, rulesetId: "haitian" });
  assert.equal(L.orientation, "portrait");
  const zones = resolveHudZoneGeometry(L, { target: 4, humanScore: 1, rivalScore: 2 });
  assert.equal(rectsOverlap(zones.human, zones.matchPoints), false);
}

console.log("Portrait HUD zone tests passed.");
