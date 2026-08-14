/**
 * Main Menu navigation contract: leave the table without wiping the save.
 * Run: node src/pages/mainMenuNavigation.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMatch } from "../game/index.js";
import {
  clearMatchSave,
  loadMatch,
  MATCH_SAVE_KEY,
  saveMatch,
} from "../persistence/matchSave.js";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(here, rel), "utf8");
}

/** Minimal localStorage so save/load round-trips work in Node. */
function installMemoryStorage() {
  const map = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => {
        map.set(key, String(value));
      },
      removeItem: (key) => {
        map.delete(key);
      },
    },
  };
  return map;
}

const gamePage = read("GamePage.jsx");
const header = read("../components/Header.jsx");
const app = read("../App.jsx");
const useMatch = read("../hooks/useMatch.js");

// Chrome control is wired on the active match Header.
assert.ok(header.includes("onMainMenu"), "Header accepts onMainMenu");
assert.ok(header.includes("game.mainMenuAria"), "Header uses accessible Main Menu label");
assert.ok(header.includes("game.mainMenu"), "Header exposes localized Main Menu text");
assert.ok(header.includes("IconMenu"), "Header uses hamburger IconMenu");
assert.ok(
  gamePage.includes("onMainMenu={handleMainMenu}"),
  "GamePage passes handleMainMenu into Header"
);

// Leaving to Main Menu must persist and must not restart (which clears+rewrites).
{
  const fnStart = gamePage.indexOf("const handleMainMenu");
  assert.ok(fnStart >= 0, "GamePage defines handleMainMenu");
  const fnBody = gamePage.slice(fnStart, fnStart + 220);
  assert.ok(fnBody.includes("persist()"), "Main Menu persists before leaving");
  assert.ok(fnBody.includes("onMainMenu?.()"), "Main Menu calls App onMainMenu");
  assert.ok(!fnBody.includes("restart("), "Main Menu must not call restart()");
}

// App returns to Setup without starting a new match.
{
  const fnStart = app.indexOf("const handleMainMenu");
  assert.ok(fnStart >= 0, "App defines handleMainMenu");
  const fnBody = app.slice(fnStart, fnStart + 180);
  assert.ok(fnBody.includes('setPhase("setup")'), "Main Menu returns to setup");
  assert.ok(!fnBody.includes("skipResume: true"), "Main Menu must not force a fresh match");
  assert.ok(!fnBody.includes("clearMatchSave"), "App Main Menu must not clear the save");
}

// restart (New Match) still clears; Main Menu path uses persist export only.
assert.ok(useMatch.includes("clearMatchSave()"), "restart path still clears save");
assert.ok(
  /persist,\s*\n\s*setMotionLock/.test(useMatch) || useMatch.includes("persist,"),
  "useMatch exports persist for Main Menu flush"
);

// Persistence: save → leave (no clear) → load restores scores/ruleset/round.
{
  const store = installMemoryStorage();
  const state = startMatch({
    seed: 4242,
    playerCount: 2,
    targetScore: 100,
    rulesetId: "haitian",
  });
  state.scores = [35, 20];
  state.round = 3;

  saveMatch({
    state,
    difficulty: "hard",
    selectedId: null,
    matchStartedAt: 1_700_000_000_000,
  });
  assert.ok(store.has(MATCH_SAVE_KEY), "match was saved");

  // Main Menu contract: persist flush only — do not clearMatchSave.
  const before = store.get(MATCH_SAVE_KEY);
  // Re-save as GamePage.handleMainMenu does via persist().
  saveMatch({
    state,
    difficulty: "hard",
    selectedId: null,
    matchStartedAt: 1_700_000_000_000,
  });
  assert.equal(store.has(MATCH_SAVE_KEY), true, "leave must keep save key");
  assert.ok(store.get(MATCH_SAVE_KEY), "leave must keep save payload");

  const resumed = loadMatch();
  assert.ok(resumed, "Resume must load saved match");
  assert.equal(resumed.state.rulesetId, "haitian");
  assert.deepEqual(resumed.state.scores, [35, 20]);
  assert.equal(resumed.state.round, 3);
  assert.equal(resumed.difficulty, "hard");
  assert.notEqual(before, null);

  // Contrast: clearing (New Match / fresh Play) removes the prior snapshot.
  clearMatchSave();
  assert.equal(loadMatch(), null);
}

console.log("Main Menu navigation tests passed.");
