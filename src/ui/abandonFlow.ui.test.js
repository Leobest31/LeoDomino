/**
 * Shared HOME / NEW MATCH abandon flow contract.
 * Run: node src/ui/abandonFlow.ui.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const gamePage = read("pages/GamePage.jsx");
const dialog = read("components/AbandonMatchDialog.jsx");
const hook = read("hooks/useMatch.js");
const en = read("i18n/locales/en.js");
const ht = read("i18n/locales/ht.js");

assert.match(gamePage, /const \[abandonIntent, setAbandonIntent\]/, "one shared abandon intent");
assert.match(gamePage, /requestLeave\("home"\)/, "HOME uses requestLeave");
assert.match(gamePage, /requestLeave\("new-match"\)/, "NEW MATCH uses requestLeave");
assert.match(gamePage, /onNewGame=\{handleNewMatchTap\}/, "dock NEW MATCH is gated");
assert.doesNotMatch(gamePage, /onNewGame=\{restart\}/, "dock NEW MATCH does not restart immediately");
assert.match(gamePage, /if \(!isMatchForfeitable\(state\)\)/, "warning only for a real active match");
assert.match(
  gamePage,
  /if \(intent === "new-match"\) restart\(\);\s*else onMainMenu/,
  "non-forfeitable NEW MATCH starts fresh; HOME leaves"
);
assert.match(gamePage, /abandonMatch\(\);/, "confirm records the forfeit once");
assert.match(
  gamePage,
  /if \(intent === "new-match"\) restart\(\);\s*else onMainMenu/,
  "confirm then runs the requested post-action"
);
assert.match(gamePage, /setAbandonIntent\(null\)/, "cancel closes the warning");
assert.doesNotMatch(
  gamePage.slice(gamePage.indexOf("handleAbandonCancel"), gamePage.indexOf("handleAbandonLeave")),
  /abandonMatch|restart\(|onMainMenu/,
  "cancel does not forfeit, reset, or navigate"
);
assert.match(
  gamePage,
  /<MatchOverModal[\s\S]*onNewMatch=\{handleNewMatch\}[\s\S]*onMainMenu=\{handleMainMenu\}/,
  "finished-match modal starts/leaves without an extra forfeit"
);
assert.match(
  gamePage.slice(gamePage.indexOf("const handleNewMatch"), gamePage.indexOf("const handleMainMenu")),
  /restart\(\)/,
  "completed-match NEW MATCH restarts without abandonMatch"
);
assert.doesNotMatch(
  gamePage.slice(gamePage.indexOf("const handleMainMenu"), gamePage.indexOf("const requestLeave")),
  /abandonMatch/,
  "completed-match HOME does not record another loss"
);

assert.match(dialog, /intent === "new-match"/, "dialog copy depends on intent");
assert.match(dialog, /game\.abandonNewMatchTitle/, "NEW MATCH warning title is localized");
assert.match(dialog, /game\.abandonNewMatchBody/, "NEW MATCH warning body is localized");
assert.match(dialog, /game\.abandonStartNewMatch/, "NEW MATCH confirm is localized");
assert.match(dialog, /game\.abandonTitle/, "HOME warning title is localized");
assert.match(dialog, /game\.leaveMatch/, "HOME confirm is localized");
assert.match(dialog, /common\.cancel/, "cancel stays in the existing locale set");

assert.match(en, /abandonNewMatchBody:/, "English has NEW MATCH abandon copy");
assert.match(ht, /abandonNewMatchBody:/, "Haitian Creole has NEW MATCH abandon copy");

assert.match(hook, /if \(abandonedRef\.current\) return/, "abandonMatch is one-shot");
assert.match(hook, /forfeitFingerprint\(current\)/, "forfeit fingerprint is stable");
assert.doesNotMatch(
  hook.slice(hook.indexOf("const abandonMatch"), hook.indexOf("const continueRound")),
  /Date\.now\(\)/,
  "forfeit fingerprint must not include a unique timestamp"
);
assert.match(
  hook,
  /if \(!abandonedRef\.current\) \{\s*recordMatch\(/,
  "MATCH_OVER does not add a second loss after a forfeit"
);
assert.match(hook, /abandonedRef\.current = false/, "a confirmed new match can be forfeited later");

console.log("Abandon flow UI contract tests passed.");
