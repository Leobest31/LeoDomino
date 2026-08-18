/**
 * Hand-to-board play flight contract.
 * Source/destination selectors + transition path; not millisecond-brittle.
 * Run: node src/ui/playFlight.ui.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOTION } from "../utils/motion.js";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(here, rel), "utf8");
}

function section(title) {
  console.log(`✓ ${title}`);
}

const gamePage = read("../pages/GamePage.jsx");
const flightDirector = read("../hooks/useFlightDirector.js");
const board = read("../board/BoardContainer.jsx");
const table = read("../components/GameTable.jsx");
const flying = read("../components/FlyingDomino.jsx");
const flyingCss = read("../components/FlyingDomino.css");
const motionCss = read("../styles/motion.css");
const opponent = read("../components/OpponentPanel.jsx");

{
  assert.match(gamePage, /fromSelector: `\[data-tile-id="\$\{tileId\}"\]`/);
  assert.match(gamePage, /toSelector: `\[data-board-tile="\$\{tileId\}"\]`/);
  assert.match(gamePage, /toFallbackSelector/);
  assert.match(gamePage, /destinationTileId\(chosen\.end/);
  assert.match(gamePage, /commitPlay\(tileId, chosen\.end\)/);
  assert.match(gamePage, /endOrientation: chosen\.orientation/);
  section("human play identifies hand source and real board destination slot");
}

{
  assert.match(flightDirector, /hideTile\(spec\.tileId\)/);
  assert.match(flightDirector, /spec\.apply\?\.\(\)/);
  assert.match(flightDirector, /setFlight\(/);
  assert.match(flightDirector, /finishWithoutFlight/);
  assert.match(flightDirector, /reduced/);
  assert.match(flying, /data-flight-path/);
  assert.match(flyingCss, /flying-domino-slide/);
  assert.match(flying, /--from-x/);
  assert.match(flying, /--to-x/);
  section("move uses a measured from→to transition path");
}

{
  assert.match(gamePage, /commitPlay\(tileId, chosen\.end\)/);
  assert.match(flightDirector, /onLanded/);
  assert.match(gamePage, /hiddenIds=\{hiddenIds\}/);
  assert.match(table, /hiddenIds=\{hiddenIds\}/);
  assert.match(board, /hidden=\{Boolean\(hiddenIds\?\.has\(tile\.id\)\)\}/);
  assert.match(board, /data-board-tile=\{tile\.id\}/);
  assert.doesNotMatch(
    gamePage,
    /Safety: every board tile must remain visible/
  );
  section("board copy stays hidden until landing; engine commit is authoritative");
}

{
  assert.match(
    gamePage,
    /\[data-opponent-origin\]\[data-seat-index="\$\{fromSeat\}"\]/
  );
  assert.match(gamePage, /hideTile\(tileId\)/);
  assert.match(gamePage, /toSelector: `\[data-board-tile="\$\{tileId\}"\]`/);
  assert.match(gamePage, /endOrientation: placed\.orientation/);
  assert.match(opponent, /data-opponent-origin/);
  assert.match(opponent, /faceDown/);
  assert.match(opponent, /real tile id, which the UI must never learn/);
  assert.doesNotMatch(gamePage, /Board tiles stay visible always/);
  section("AI/opponent play flies from seat origin to the real board slot");
}

{
  assert.ok(MOTION.tileFlightMs >= 250 && MOTION.tileFlightMs <= 400);
  assert.match(motionCss, /prefers-reduced-motion: reduce/);
  assert.match(motionCss, /\.flying-domino/);
  section("flight duration in 250–400ms; reduced-motion still disables flight CSS");
}

console.log("\nPlay-flight UI contract tests passed.");
