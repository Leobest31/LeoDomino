import { useEffect, useId, useMemo, useRef } from "react";
import { useI18n } from "../i18n";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import { formatMatchDuration } from "../utils/formatMatchDuration.js";
import "./MatchOverModal.css";

/**
 * Official end-of-match screen — blocks play until the player chooses an action.
 * Supports 2–4 player final score lines.
 */
function MatchOverModal({
  open,
  humanWon = false,
  winnerName = "",
  scores = [],
  roundsPlayed = 1,
  durationSeconds = 0,
  onNewMatch,
  onStatistics,
  onMainMenu,
}) {
  const { t, formatNumber } = useI18n();
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const panelRef = useRef(null);
  const primaryRef = useRef(null);

  const confetti = useMemo(() => {
    if (!open || !humanWon || reduced) return [];
    return Array.from({ length: 36 }, (_, index) => ({
      id: index,
      left: `${4 + ((index * 17) % 92)}%`,
      delay: `${(index % 12) * 0.05}s`,
      duration: `${1.8 + (index % 5) * 0.25}s`,
      hue: index % 3 === 0 ? "gold" : index % 3 === 1 ? "cream" : "amber",
      drift: `${(index % 2 === 0 ? -1 : 1) * (12 + (index % 7) * 4)}px`,
      size: `${6 + (index % 4) * 2}px`,
    }));
  }, [humanWon, open, reduced]);

  const scoreText = scores.map((value) => formatNumber(value)).join(" – ");

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryRef.current?.focus?.();

    const onKey = (event) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const durationLabel = formatMatchDuration(durationSeconds);

  return (
    <div
      className={`match-over${reduced ? " match-over--reduced" : ""}${
        humanWon ? " match-over--victory" : " match-over--defeat"
      }`}
      role="presentation"
    >
      <div className="match-over__backdrop" aria-hidden="true" />

      {confetti.length ? (
        <div className="match-over__confetti" aria-hidden="true">
          {confetti.map((piece) => (
            <span
              key={piece.id}
              className={`match-over__confetti-piece match-over__confetti-piece--${piece.hue}`}
              style={{
                left: piece.left,
                width: piece.size,
                height: piece.size,
                animationDelay: piece.delay,
                animationDuration: piece.duration,
                "--drift": piece.drift,
              }}
            />
          ))}
        </div>
      ) : null}

      <div
        className="match-over__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <div className="match-over__trophy-wrap" aria-hidden="true">
          <span className="match-over__trophy-glow" />
          <span className="match-over__trophy">{t("matchOver.trophy")}</span>
        </div>

        <h2 id={titleId} className="match-over__title">
          {t("matchOver.title")}
        </h2>

        <dl className="match-over__stats">
          <div className="match-over__stat">
            <dt>{t("matchOver.winner")}</dt>
            <dd className="match-over__winner">{winnerName}</dd>
          </div>
          <div className="match-over__stat">
            <dt>{t("matchOver.finalScore")}</dt>
            <dd>{t("matchOver.scoreLine", { scores: scoreText })}</dd>
          </div>
          <div className="match-over__stat">
            <dt>{t("matchOver.roundsPlayed")}</dt>
            <dd>{roundsPlayed}</dd>
          </div>
          <div className="match-over__stat">
            <dt>{t("matchOver.duration")}</dt>
            <dd>{durationLabel}</dd>
          </div>
        </dl>

        <div className="match-over__actions">
          <button
            ref={primaryRef}
            type="button"
            className="match-over__btn match-over__btn--primary"
            onClick={onNewMatch}
          >
            {t("matchOver.newMatch")}
          </button>
          {typeof onStatistics === "function" ? (
            <button
              type="button"
              className="match-over__btn match-over__btn--secondary"
              onClick={onStatistics}
            >
              {t("matchOver.statistics")}
            </button>
          ) : null}
          <button
            type="button"
            className="match-over__btn match-over__btn--ghost"
            onClick={onMainMenu}
          >
            {t("matchOver.mainMenu")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MatchOverModal;
