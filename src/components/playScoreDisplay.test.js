/**
 * All Fives felt +N then HUD scoreboard hold.
 * Run: node src/components/playScoreDisplay.test.js
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  PLAY_SCORE_HOLD_MS,
  hudScoresDuringHold,
  shouldShowPlayScorePopup,
} from "../game/rules/allFivesSpinner.js";
import { MOTION } from "../utils/motion.js";

function section(title) {
  console.log(`✓ ${title}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const tableJsx = readFileSync(join(here, "GameTable.jsx"), "utf8");
const tableCss = readFileSync(join(here, "GameTable.css"), "utf8");
const gamePage = readFileSync(join(here, "../pages/GamePage.jsx"), "utf8");

{
  assert.equal(PLAY_SCORE_HOLD_MS, 2000);
  assert.equal(MOTION.playScoreHoldMs, 2000);
  for (const pts of [5, 10, 15, 20, 25]) {
    assert.equal(shouldShowPlayScorePopup(pts), true, `+${pts} uses the same popup`);
    const during = hudScoresDuringHold({
      scores: [20 + pts, 0],
      lastPlayPoints: pts,
      lastPlayPointsSeat: 0,
      holdElapsedMs: 0,
      holdMs: 2000,
    });
    assert.deepEqual(during, [20, 0], `+${pts} felt first; HUD still 20`);
    const mid = hudScoresDuringHold({
      scores: [20 + pts, 0],
      lastPlayPoints: pts,
      lastPlayPointsSeat: 0,
      holdElapsedMs: 1999,
      holdMs: 2000,
    });
    assert.deepEqual(mid, [20, 0], `+${pts} HUD still held just before 2s`);
    const after = hudScoresDuringHold({
      scores: [20 + pts, 0],
      lastPlayPoints: pts,
      lastPlayPointsSeat: 0,
      holdElapsedMs: 2000,
      holdMs: 2000,
    });
    assert.deepEqual(after, [20 + pts, 0], `+${pts} HUD after 2s`);
  }
  assert.equal(shouldShowPlayScorePopup(0), false);
  assert.equal(shouldShowPlayScorePopup(7), false);
  section("J/K. valid +5/+10/+15/+20/+25 share felt +N then 2s HUD; non-multiples have no popup");
}

{
  assert.match(tableJsx, /playScore && !roundSummary/);
  assert.match(tableJsx, /game-table__play-score/);
  assert.match(tableJsx, /game\.playScore/);
  assert.match(tableCss, /\.game-table__play-score/);
  assert.match(gamePage, /setTablePlayScore\(pts\)/);
  assert.match(gamePage, /hudScoresDuringHold/);
  assert.match(gamePage, /MOTION\.playScoreHoldMs/);
  assert.match(gamePage, /setHudScores\(state\.scores\)/);
  assert.match(gamePage, /setScoreHighlights/);
  assert.match(gamePage, /lastPlayScoreTerminals/);
  assert.match(gamePage, /MOTION\.playScoreHoldMs/);
  const boardJsx = readFileSync(join(here, "../board/BoardContainer.jsx"), "utf8");
  const boardCss = readFileSync(join(here, "../board/BoardContainer.css"), "utf8");
  assert.match(tableJsx, /scoreHighlights/);
  assert.match(boardJsx, /board-container__score-glow/);
  assert.match(boardJsx, /mergeScoreHighlights\(scoreHighlights\)/);
  assert.match(boardCss, /prefers-reduced-motion/);
  assert.match(boardCss, /\.board-container__score-glow \{/);
  section("felt +N is rendered on the table before the HUD hold ends");
}

{
  const during = hudScoresDuringHold({
    scores: [35, 10],
    lastPlayPoints: 15,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
    holdMs: 2000,
  });
  assert.deepEqual(during, [20, 10], "scoreboard still 20 while felt shows +15");
  const after = hudScoresDuringHold({
    scores: [35, 10],
    lastPlayPoints: 15,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 2000,
    holdMs: 2000,
  });
  assert.deepEqual(after, [35, 10], "scoreboard reflects +15 after ~2s");
  section("scoreboard updates after the ~2s felt hold");
}

{
  const first = hudScoresDuringHold({
    scores: [25, 0],
    lastPlayPoints: 5,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(first, [20, 0]);
  const second = hudScoresDuringHold({
    scores: [35, 0],
    lastPlayPoints: 10,
    lastPlayPointsSeat: 0,
    holdElapsedMs: 0,
  });
  assert.deepEqual(second, [25, 0], "consecutive scoring uses the latest award once");
  assert.match(gamePage, /scoreHoldGenRef/);
  assert.match(gamePage, /scoreHoldGenRef\.current !== gen/);
  assert.match(gamePage, /window\.setTimeout/);
  section("L. consecutive scoring moves do not let a stale timer clear the new glow");
}

console.log("\nPlay-score display tests passed.");
