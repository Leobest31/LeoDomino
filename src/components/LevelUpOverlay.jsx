import { useEffect } from "react";
import { useI18n } from "../i18n";
import { homeLeoBestLion } from "../assets";
import "./LevelUpOverlay.css";

/**
 * Owner-approved premium Level-Up celebration.
 * Shown once per newly achieved Level after Victory sequencing.
 */
export default function LevelUpOverlay({
  open,
  level,
  rank,
  maxLevel = false,
  title,
  congratulations,
  welcome,
  maxLabel,
  continueLabel,
  onContinue,
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") onContinue?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onContinue]);

  if (!open || level == null) return null;

  return (
    <div
      className="level-up-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-level-up-overlay="true"
      data-level-up-level={level}
      data-level-up-rank={rank || "none"}
      data-level-up-max={maxLevel ? "true" : "false"}
    >
      <div className="level-up-overlay__backdrop" aria-hidden="true" />
      <div className="level-up-overlay__card">
        <div className="level-up-overlay__sparkles" aria-hidden="true" />
        <svg className="level-up-overlay__crown" viewBox="0 0 48 28" width="42" height="24" aria-hidden="true">
          <path
            d="M4 22 L8 8 L16 16 L24 4 L32 16 L40 8 L44 22 Z"
            fill="#f5c542"
            stroke="#8a6508"
            strokeWidth="1.4"
          />
          <rect x="6" y="22" width="36" height="4" rx="1" fill="#d4a017" />
        </svg>
        <p className="level-up-overlay__kicker">{title}</p>
        <h2 className="level-up-overlay__congrats">{congratulations}</h2>
        <div className="level-up-overlay__badge-wrap">
          <div className="level-up-overlay__shield" data-level-up-shield="true">
            <span className="level-up-overlay__shield-sheen" aria-hidden="true" />
            {rank ? (
              <img
                className="level-up-overlay__rank-lion"
                src={homeLeoBestLion}
                alt=""
                draggable={false}
              />
            ) : (
              <span className="level-up-overlay__shield-fallback" aria-hidden="true" />
            )}
          </div>
          <span className="level-up-overlay__lvl-label">
            <span className="level-up-overlay__lvl-tag">{t("home.lvlTag")}</span>
            <span className="level-up-overlay__lvl-number">{level}</span>
          </span>
        </div>
        {rank ? (
          <>
            <span className="level-up-overlay__divider" aria-hidden="true" />
            <p className="level-up-overlay__nameplate" data-level-up-rank-name="true">
              {rank}
            </p>
          </>
        ) : null}
        <p className="level-up-overlay__welcome">{maxLevel ? maxLabel : welcome}</p>
        <button
          type="button"
          className="level-up-overlay__continue"
          data-level-up-continue="true"
          onClick={() => onContinue?.()}
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
