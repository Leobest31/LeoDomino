/**
 * Public Challenge schedule client contract. No network.
 * Run: node src/online/challengeSchedule.test.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "url";
import {
  CHALLENGE_SCHEDULE_ERROR,
  ChallengeScheduleError,
  challengeClockHeadlineKey,
  challengeClockPresentation,
  challengeClockSubKey,
  challengeCountdownParts,
  challengeHomePresentation,
  challengeStatusI18nKey,
  fetchPublicChallengeSchedule,
  normalizeChallengeSchedule,
  padCountdownPart,
  remainingCountdownParts,
  ZERO_COUNTDOWN,
} from "./challengeSchedule.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(root, "src/online/challengeSchedule.js"), "utf8");
const hook = readFileSync(join(root, "src/hooks/usePublicChallengeSchedule.js"), "utf8");
const home = readFileSync(join(root, "src/pages/HomePage.jsx"), "utf8");

assert.match(source, /rpc\("get_public_challenge_schedule"/);
assert.doesNotMatch(source, /rpc\("admin_get_challenge"|rpc\("admin_update_challenge"/);
assert.doesNotMatch(source, /from "\.\/adminV1|from "\.\.\/online\/adminV1/);
assert.doesNotMatch(source, /\.from\(/);
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(/);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role/);
assert.match(source, /cpEarningEnabled: false/);
assert.doesNotMatch(source, /cpEarningEnabled: true/);
assert.match(hook, /visibilitychange/);
assert.match(hook, /pageshow/);
assert.match(hook, /CHALLENGE_HOME_REFRESH_MS/);
assert.match(hook, /document\.visibilityState === "visible"/);
assert.doesNotMatch(hook, /\.channel\(|subscribeMatch|\.on\("postgres_changes"/);
assert.match(source, /get:\s*false/);
assert.match(home, /usePublicChallengeSchedule/);
assert.doesNotMatch(home, /HOME_PREVIEW\.countdown/);

{
  const row = normalizeChallengeSchedule({
    status: "scheduled",
    starts_at: "2026-09-01T12:00:00.000Z",
    ends_at: "2026-12-31T22:00:00.000Z",
    qualification_cp: 5000,
    first_prize_usd: "300.00",
    second_prize_usd: "200.00",
    cp_earning_enabled: true,
    email: "hidden@example.com",
    qualified_players: [{ player_id: "x" }],
  });
  assert.equal(row.status, "scheduled");
  assert.equal(row.startsAt, "2026-09-01T12:00:00.000Z");
  assert.equal(row.endsAt, "2026-12-31T22:00:00.000Z");
  assert.equal(row.qualificationCp, 5000);
  assert.equal(row.firstPrizeUsd, 300);
  assert.equal(row.secondPrizeUsd, 200);
  assert.equal(row.cpEarningEnabled, false);
  assert.equal("email" in row, false);
  assert.equal("qualifiedPlayers" in row, false);
}

assert.equal(normalizeChallengeSchedule(null), null);
assert.equal(normalizeChallengeSchedule({ status: "nope" }).status, "coming_soon");
assert.equal(padCountdownPart(4), "04");

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const start = Date.parse("2026-08-30T16:00:00.000Z");
  const parts = challengeCountdownParts(start, now);
  assert.deepEqual(parts, { days: "02", hours: "00", minutes: "00", seconds: "00" });
}

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const pastTarget = Date.parse("2026-08-01T16:00:00.000Z");
  assert.deepEqual(remainingCountdownParts(pastTarget, now), ZERO_COUNTDOWN);
  assert.equal(challengeCountdownParts(pastTarget, now), null);
}

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const upcoming = challengeClockPresentation(
    {
      status: "scheduled",
      startsAt: "2026-09-01T16:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    now
  );
  assert.equal(upcoming.status, "scheduled");
  assert.equal(upcoming.clockPhase, "upcoming");
  assert.deepEqual(upcoming.countdown, remainingCountdownParts(Date.parse(upcoming.startsAt), now));
  assert.equal(upcoming.cpEarningEnabled, false);
  assert.equal(challengeClockHeadlineKey(upcoming.clockPhase), "challenge.clockComingSoon");
  assert.equal(challengeClockSubKey(upcoming.clockPhase), "challenge.startsIn");
}

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const running = challengeClockPresentation(
    {
      status: "coming_soon",
      startsAt: "2026-06-08T10:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    now
  );
  const endMs = Date.parse(running.endsAt);
  assert.equal(running.status, "coming_soon");
  assert.equal(running.clockPhase, "running");
  assert.notEqual(running.status, "live");
  assert.deepEqual(running.countdown, remainingCountdownParts(endMs, now));
  assert.ok(Number(running.countdown.days) >= 0);
  assert.ok(Number(running.countdown.hours) >= 0);
  assert.equal(challengeClockHeadlineKey("running"), "challenge.clockLive");
  assert.equal(challengeClockSubKey("running"), "challenge.timeRemaining");
}

{
  const now = Date.parse("2027-01-01T00:00:00.000Z");
  const ended = challengeClockPresentation(
    {
      status: "completed",
      startsAt: "2026-06-08T10:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    now
  );
  assert.equal(ended.clockPhase, "ended");
  assert.deepEqual(ended.countdown, ZERO_COUNTDOWN);
  assert.equal(challengeClockHeadlineKey("ended"), "challenge.clockCompleted");
  assert.equal(challengeClockSubKey("ended"), "challenge.ended");
}

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const future = challengeHomePresentation(
    {
      status: "scheduled",
      startsAt: "2026-09-01T16:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    now
  );
  assert.equal(future.status, "scheduled");
  assert.equal(future.showCountdown, true);
  assert.ok(future.countdown);
  assert.equal(future.cpEarningEnabled, false);
}

{
  const now = Date.parse("2026-08-28T16:00:00.000Z");
  const past = challengeHomePresentation(
    {
      status: "scheduled",
      startsAt: "2026-06-08T10:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    now
  );
  assert.equal(past.status, "scheduled");
  assert.equal(past.clockPhase, "running");
  assert.equal(past.showCountdown, true);
  assert.ok(past.countdown);
  assert.notEqual(past.status, "live");
}

{
  const soon = challengeHomePresentation({
    status: "coming_soon",
    startsAt: null,
    endsAt: null,
    qualificationCp: 5000,
    firstPrizeUsd: 300,
    secondPrizeUsd: 200,
    cpEarningEnabled: false,
  });
  assert.equal(soon.status, "coming_soon");
  assert.equal(soon.clockPhase, "upcoming");
  assert.equal(soon.showCountdown, false);
  assert.deepEqual(soon.countdown, ZERO_COUNTDOWN);
}

{
  const hostedSoon = challengeHomePresentation(
    {
      status: "coming_soon",
      startsAt: "2026-06-08T10:00:00.000Z",
      endsAt: "2026-12-31T22:00:00.000Z",
      qualificationCp: 5000,
      firstPrizeUsd: 300,
      secondPrizeUsd: 200,
      cpEarningEnabled: false,
    },
    Date.parse("2026-08-28T16:00:00.000Z")
  );
  assert.equal(hostedSoon.status, "coming_soon");
  assert.equal(hostedSoon.startsAt, "2026-06-08T10:00:00.000Z");
  assert.equal(hostedSoon.endsAt, "2026-12-31T22:00:00.000Z");
  assert.equal(hostedSoon.qualificationCp, 5000);
  assert.equal(hostedSoon.clockPhase, "running");
  assert.notEqual(hostedSoon.status, "scheduled");
}

{
  const missing = challengeHomePresentation(null);
  assert.equal(missing.status, "coming_soon");
  assert.equal(missing.showCountdown, false);
  assert.equal(missing.qualificationCp, null);
  assert.deepEqual(missing.countdown, ZERO_COUNTDOWN);
}

assert.equal(challengeStatusI18nKey("scheduled"), "home.challengeStatusScheduled");
assert.equal(challengeStatusI18nKey("coming_soon"), "home.challengeStatusComingSoon");

{
  await assert.rejects(
    () => fetchPublicChallengeSchedule({ rpc: async () => ({ data: null, error: { message: "authentication required", code: "28000" } }) }),
    (error) => error instanceof ChallengeScheduleError && error.code === CHALLENGE_SCHEDULE_ERROR.AUTH
  );
}

{
  const loaded = await fetchPublicChallengeSchedule({
    rpc: async (name, _args, options) => {
      assert.equal(name, "get_public_challenge_schedule");
      assert.equal(options?.get, false);
      return {
        data: {
          status: "scheduled",
          starts_at: "2026-06-08T10:00:00.000Z",
          ends_at: "2026-12-31T22:00:00.000Z",
          qualification_cp: 5000,
          first_prize_usd: 300,
          second_prize_usd: 200,
          cp_earning_enabled: false,
        },
        error: null,
      };
    },
  });
  assert.equal(loaded.status, "scheduled");
  assert.equal(loaded.cpEarningEnabled, false);
}

console.log("  ✓ public challenge schedule client contract");
