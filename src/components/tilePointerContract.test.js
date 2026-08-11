/**
 * Appearance-independent hand-tile pointer contract.
 * Classic (ivory) and Premium (walnut) must share the same drag hit-target rules.
 *
 * Run: node src/components/tilePointerContract.test.js
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TILE_SKINS } from "../persistence/prefs.js";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(here, rel), "utf8");
}

function assertRuleHasDecl(css, selectorFragment, declaration) {
  const idx = css.indexOf(selectorFragment);
  assert.ok(idx >= 0, `missing selector fragment: ${selectorFragment}`);
  const after = css.slice(idx, idx + 800);
  assert.ok(
    after.includes(declaration),
    `expected "${declaration}" near "${selectorFragment}"`,
  );
}

const classicCss = read("Domino.css");
const premiumCss = read("LeoDominoPremium.css");
const canvasCss = read("CanvasDominoSurface.css");
const classicJsx = read("DominoTileClassic.jsx");
const premiumJsx = read("LeoDominoPremium.jsx");
const tileRouter = read("DominoTile.jsx");

assert.deepEqual([...TILE_SKINS].sort(), ["classic", "premium"]);

assert.ok(tileRouter.includes('tileSkin === "premium"'));
assert.ok(tileRouter.includes("LeoDominoPremium"));
assert.ok(tileRouter.includes("DominoTileClassic"));

/* Interactive wrappers own touch-action: none (not manipulation). */
assertRuleHasDecl(classicCss, ".domino--interactive", "touch-action: none");
assertRuleHasDecl(
  premiumCss,
  ".leo-domino-premium.is-interactive",
  "touch-action: none",
);

/* Outer button receives onPointerDown for both appearances. */
for (const [name, jsx] of [
  ["classic", classicJsx],
  ["premium", premiumJsx],
]) {
  assert.ok(jsx.includes("<button"), `${name}: interactive root must be <button>`);
  assert.ok(
    jsx.includes("onPointerDown={"),
    `${name}: onPointerDown must attach to interactive root`,
  );
  const buttonBlock = jsx.slice(jsx.indexOf("<button"), jsx.indexOf("</button>"));
  assert.ok(
    buttonBlock.includes("onPointerDown="),
    `${name}: onPointerDown must be on the <button>, not an inner visual layer`,
  );
}

/* Visual-only layers must not intercept pointer input. */
const classicDecor = [
  ".domino__base",
  ".domino__face",
  ".domino__half",
  ".domino__pips",
  ".domino__pip",
  ".domino__divider",
];
for (const sel of classicDecor) {
  assert.ok(
    classicCss.includes(sel),
    `classic CSS missing ${sel}`,
  );
}
assert.ok(classicCss.includes("pointer-events: none"));
assert.match(
  classicCss,
  /\.domino__half,\s*\n\.domino__pips,\s*\n\.domino__pip,\s*\n\.domino__divider/,
);

const premiumDecor = [
  ".leo-premium__body",
  ".leo-premium__face",
  ".leo-premium__gold-frame",
  ".leo-premium__half",
  ".leo-premium__pip",
  ".leo-premium__side",
  ".leo-premium__shadow",
];
for (const sel of premiumDecor) {
  assert.ok(premiumCss.includes(sel), `premium CSS missing ${sel}`);
}
assert.match(
  premiumCss,
  /\.leo-premium__body,\s*\n\.leo-premium__face,\s*\n\.leo-premium__gold-frame[\s\S]*?pointer-events:\s*none/,
);

assertRuleHasDecl(canvasCss, ".canvas-domino-surface", "pointer-events: none");

/**
 * Regression: Premium must not leave interactive tiles on touch-action:
 * manipulation (that path fails continuous finger-follow on Samsung WebView).
 */
const interactiveBlock = premiumCss.slice(
  premiumCss.indexOf(".leo-domino-premium.is-interactive"),
  premiumCss.indexOf(".leo-domino-premium.is-interactive") + 500,
);
assert.ok(interactiveBlock.includes("touch-action: none"));
assert.equal(interactiveBlock.includes("touch-action: manipulation"), false);

console.log("Tile pointer contract tests passed (classic + premium).");
