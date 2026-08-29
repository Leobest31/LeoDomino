/**
 * Dedicated Challenge page UI contract. Informational only.
 * Run: node src/ui/challenge.ui.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const app = read("App.jsx");
const page = read("pages/ChallengePage.jsx");
const home = read("pages/HomePage.jsx");
const source = read("online/challengeSchedule.js");
const hook = read("hooks/usePublicChallengeSchedule.js");

assert.match(app, /<ChallengePage/);
assert.match(app, /phase === "challenge" && playable/);
assert.match(app, /onOpenChallenge=\{\(\) => setPhase\("challenge"\)\}/);
assert.match(app, /onBack=\{\(\) => setPhase\("home"\)\}/);
assert.match(page, /data-challenge-page="true"/);
assert.match(page, /data-challenge-hosted-status/);
assert.match(page, /data-challenge-clock/);
assert.match(page, /data-challenge-countdown/);
assert.match(page, /data-challenge-facts/);
assert.match(page, /usePublicChallengeSchedule/);
assert.match(page, /challengeStatusI18nKey/);
assert.match(page, /challengeClockHeadlineKey/);
assert.match(page, /challengeClockSubKey/);
assert.match(page, /challenge\.startsAt/);
assert.match(page, /challenge\.endsAt/);
assert.match(page, /challenge\.qualification/);
assert.match(page, /challenge\.firstPrize/);
assert.match(page, /challenge\.secondPrize/);
assert.match(page, /challenge\.cpOff/);
assert.match(page, /home\.countdownDays/);
assert.doesNotMatch(page, /enterChallenge|playChallenge|onEnterChallenge/);
assert.doesNotMatch(page, /cpEarningEnabled:\s*true/);
assert.doesNotMatch(page, /admin_update_challenge|admin_get_challenge/);
assert.match(home, /onOpenChallenge/);
assert.doesNotMatch(home, /data-home-challenge-facts/);
assert.doesNotMatch(home, /home\.viewAll/);
assert.match(source, /remainingCountdownParts/);
assert.match(source, /Math\.max\(0,/);
assert.match(source, /clockPhase/);
assert.doesNotMatch(source, /cpEarningEnabled: true/);
assert.match(hook, /CHALLENGE_HOME_REFRESH_MS/);
assert.match(hook, /visibilitychange/);
assert.match(hook, /pageshow/);
assert.match(hook, /setNowMs\(Date\.now\(\)\)/);
assert.match(hook, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);

console.log("  ✓ challenge page UI contract");
