/**
 * V1 plays in portrait without a rotate-to-landscape blocker.
 * Run: node src/ui/gameplayOrientation.test.js
 */

import assert from "node:assert/strict";
import {
  shouldPromptLandscape,
  estimateFeltHeight,
  TABLET_LANDSCAPE_CHROME_BEFORE,
  TABLET_LANDSCAPE_CHROME_AFTER,
} from "./gameplayOrientation.js";
import { isPortraitBox, resolveGameplayLayout } from "./gameplayLayout.js";

assert.equal(
  shouldPromptLandscape({ width: 800, height: 1280, coarsePointer: true }),
  false,
  "tablet portrait must play"
);
assert.equal(
  shouldPromptLandscape({ width: 1280, height: 800, coarsePointer: true }),
  false,
  "tablet landscape must play"
);
assert.equal(
  shouldPromptLandscape({ width: 390, height: 844, coarsePointer: true }),
  false,
  "phone portrait must play"
);
assert.equal(
  shouldPromptLandscape({ width: 844, height: 390, coarsePointer: true }),
  false,
  "phone landscape must play"
);
assert.equal(
  shouldPromptLandscape({ width: 900, height: 1400, coarsePointer: false }),
  false,
  "desktop tall window must not prompt"
);
assert.equal(
  shouldPromptLandscape({ width: 1440, height: 900, coarsePointer: false }),
  false,
  "desktop landscape must not prompt"
);

assert.equal(isPortraitBox(390, 844), true);
assert.equal(isPortraitBox(844, 390), false);

const phonePortrait = resolveGameplayLayout({ width: 390, height: 844 });
assert.equal(phonePortrait.orientation, "portrait");
assert.ok(phonePortrait.feltHeight > phonePortrait.chromeHeight, "portrait felt dominates chrome");
assert.ok(phonePortrait.feltHeight > phonePortrait.dockHeight, "portrait felt dominates dock");
assert.ok(phonePortrait.handTop >= phonePortrait.feltBottom - 0.5, "portrait hand sits at the bottom of the felt");
assert.ok(phonePortrait.opponentRailHeight >= 32, "portrait reserves LeoBest hidden tiles");
assert.ok(
  phonePortrait.feltTop >= phonePortrait.opponentTop + phonePortrait.opponentRailHeight - 0.5,
  "portrait felt starts under the opponent rail"
);
assert.ok(
  phonePortrait.handTop - phonePortrait.feltBottom <= 4.5,
  "portrait hand sits flush under the felt"
);
assert.ok(phonePortrait.playedShort >= 44, `portrait tiles stay readable (${phonePortrait.playedShort})`);

const tabletH = 800;
const feltBefore = estimateFeltHeight(tabletH, TABLET_LANDSCAPE_CHROME_BEFORE);
const feltAfter = estimateFeltHeight(tabletH, TABLET_LANDSCAPE_CHROME_AFTER);
assert.ok(feltAfter > feltBefore, `felt must remain playable ${feltBefore} → ${feltAfter}`);
assert.ok(
  TABLET_LANDSCAPE_CHROME_AFTER.bottom > 0,
  "hand dock must reserve real height outside the felt"
);
assert.ok(
  TABLET_LANDSCAPE_CHROME_AFTER.player === 0,
  "hand height is folded into the dock band, not a second overlay"
);
assert.ok(
  feltAfter < tabletH - TABLET_LANDSCAPE_CHROME_AFTER.header,
  "felt must not consume the hand dock"
);

console.log("Gameplay orientation tests passed.");
