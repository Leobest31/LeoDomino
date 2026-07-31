/**
 * Audio preference / catalog verification.
 * Run: npm run test:audio
 */

import assert from "node:assert/strict";
import {
  DEFAULT_AUDIO_PREFS,
  SOUND_IDS,
  normalizeAudioPrefs,
} from "./constants.js";

assert.equal(SOUND_IDS.includes("place"), true);
assert.equal(SOUND_IDS.includes("ambient"), true);
assert.equal(SOUND_IDS.length >= 12, true);

assert.deepEqual(normalizeAudioPrefs(null), DEFAULT_AUDIO_PREFS);
assert.equal(normalizeAudioPrefs({ volume: 2 }).volume, 1);
assert.equal(normalizeAudioPrefs({ volume: -1 }).volume, 0);
assert.equal(normalizeAudioPrefs({ muted: 1 }).muted, true);
assert.equal(normalizeAudioPrefs({ ambient: true }).ambient, true);

console.log("Phase 7 audio tests passed.");
