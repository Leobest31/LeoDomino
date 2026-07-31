/**
 * Fails if UI files contain hardcoded user-visible JSX text.
 * Run: npm run test:i18n:ui
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanDirs = ["components", "pages", "App.jsx"].map((p) => join(root, p));

/** @type {string[]} */
const violations = [];

/**
 * Conservative JSX text detector:
 * only single-line letterful text between tags, with no JS punctuation.
 * @param {string} source
 * @returns {string[]}
 */
function findJsxTextNodes(source) {
  /** @type {string[]} */
  const found = [];
  const pattern = /(?<![=])>\s*([^<{\n]+?)\s*</gu;
  let match;
  while ((match = pattern.exec(source))) {
    const text = match[1].trim();
    if (!text) continue;
    // Skip code crumbs between sibling roots / closes
    if (/[(){};=]/.test(text)) continue;
    if (/^[\d\s.,:;!?+\-–—/\\|]+$/.test(text)) continue;
    if (!/\p{L}/u.test(text)) continue;
    found.push(text);
  }
  return found;
}

function walk(filePath) {
  const stat = statSync(filePath);
  if (stat.isDirectory()) {
    for (const name of readdirSync(filePath)) {
      walk(join(filePath, name));
    }
    return;
  }

  if (!/\.(jsx|tsx)$/.test(filePath)) return;
  if (filePath.replace(/\\/g, "/").includes("/i18n/")) return;

  const source = readFileSync(filePath, "utf8");
  const rel = relative(root, filePath);

  for (const text of findJsxTextNodes(source)) {
    violations.push(`${rel}: hardcoded JSX text "${text}"`);
  }
}

for (const entry of scanDirs) {
  walk(entry);
}

if (violations.length) {
  console.error("Hardcoded UI copy detected:\n");
  for (const line of violations) console.error(`  - ${line}`);
  console.error("\nUse t(\"key\") or <T id=\"key\" /> instead.\n");
  process.exit(1);
}

assert.equal(violations.length, 0);
console.log("UI hardcoded-copy scan passed.\n");
