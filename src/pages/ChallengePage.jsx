import { useAudio } from "../audio";
import { IconHome } from "../components/Icon";
import { useI18n } from "../i18n";
import { usePublicChallengeSchedule } from "../hooks/usePublicChallengeSchedule.js";
import {
  challengeClockHeadlineKey,
  challengeClockSubKey,
  challengeStatusI18nKey,
} from "../online/challengeSchedule.js";
import "./ChallengePage.css";

const COUNTDOWN_SLOTS = [
  { key: "days", labelKey: "home.countdownDays" },
  { key: "hours", labelKey: "home.countdownHrs" },
  { key: "minutes", labelKey: "home.countdownMin" },
  { key: "seconds", labelKey: "home.countdownSec" },
];

const DATE_TIME = Object.freeze({ dateStyle: "medium", timeStyle: "short" });

function ChallengePage({ onBack, onMainMenu }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { play, unlock } = useAudio();
  const challenge = usePublicChallengeSchedule();
  const view = challenge.presentation;

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const facts = [];
  if (view.startsAt) {
    facts.push({
      key: "start",
      label: t("challenge.startsAt"),
      value: formatDate(view.startsAt, DATE_TIME),
    });
  }
  if (view.endsAt) {
    facts.push({
      key: "end",
      label: t("challenge.endsAt"),
      value: formatDate(view.endsAt, DATE_TIME),
    });
  }
  if (view.qualificationCp != null) {
    facts.push({
      key: "target",
      label: t("challenge.qualification"),
      value: t("challenge.targetAmount", { amount: formatNumber(view.qualificationCp) }),
    });
  }
  if (view.firstPrizeUsd != null) {
    facts.push({
      key: "first",
      label: t("challenge.firstPrize"),
      value: t("challenge.prizeAmount", { amount: formatNumber(view.firstPrizeUsd) }),
    });
  }
  if (view.secondPrizeUsd != null) {
    facts.push({
      key: "second",
      label: t("challenge.secondPrize"),
      value: t("challenge.prizeAmount", { amount: formatNumber(view.secondPrizeUsd) }),
    });
  }
  facts.push({
    key: "cp",
    label: t("challenge.cpEarning"),
    value: t("challenge.cpOff"),
  });

  const showSchedule = Boolean(challenge.schedule) && !challenge.failed;
  const countdown = view.countdown;

  return (
    <main className="challenge-page" data-challenge-page="true" aria-label={t("challenge.aria")}>
      <div className="challenge-page__atmosphere" aria-hidden="true">
        <div className="challenge-page__wood" />
        <div className="challenge-page__vignette" />
      </div>

      <div className="challenge-page__shell">
        <header className="challenge-page__header">
          <button
            type="button"
            className="challenge-page__back"
            onClick={() => tap(() => onBack?.())}
            aria-label={t("common.back")}
          >
            <span className="challenge-page__back-chevron" aria-hidden="true" />
            <span className="challenge-page__back-label">{t("common.back")}</span>
          </button>
          <h1 className="challenge-page__title">{t("challenge.title")}</h1>
          <button
            type="button"
            className="challenge-page__menu"
            onClick={() => tap(() => onMainMenu?.())}
            aria-label={t("common.mainMenu")}
          >
            <IconHome />
            <span className="challenge-page__menu-label">{t("common.mainMenu")}</span>
          </button>
        </header>

        {challenge.loading && !challenge.schedule ? (
          <p className="challenge-page__status">{t("challenge.loading")}</p>
        ) : null}

        {challenge.failed && !challenge.schedule ? (
          <section className="challenge-page__panel">
            <p className="challenge-page__status">{t("challenge.unavailable")}</p>
            <button type="button" className="challenge-page__retry" onClick={() => tap(() => void challenge.refresh())}>
              {t("challenge.retry")}
            </button>
          </section>
        ) : null}

        {showSchedule ? (
          <>
            <section className="challenge-page__panel" data-challenge-hosted-status={view.status}>
              <p className="challenge-page__kicker">{t("challenge.statusLabel")}</p>
              <p className="challenge-page__hosted">{t(challengeStatusI18nKey(view.status))}</p>
            </section>

            <section
              className="challenge-page__panel challenge-page__panel--clock"
              data-challenge-clock={view.clockPhase}
            >
              <p className="challenge-page__clock-head">{t(challengeClockHeadlineKey(view.clockPhase))}</p>
              <p className="challenge-page__clock-sub">{t(challengeClockSubKey(view.clockPhase))}</p>
              <div className="challenge-page__countdown" data-challenge-countdown="true">
                {COUNTDOWN_SLOTS.map((slot) => (
                  <span key={slot.key} className="challenge-page__count">
                    <span className="challenge-page__count-value">{countdown[slot.key]}</span>
                    <span className="challenge-page__count-label">{t(slot.labelKey)}</span>
                  </span>
                ))}
              </div>
            </section>

            <dl className="challenge-page__facts" data-challenge-facts="true">
              {facts.map((row) => (
                <div key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </div>
    </main>
  );
}

export default ChallengePage;
