import { useI18n } from "../i18n";
import "./GameBanner.css";

/**
 * Lightweight event banner for round / match transitions (no layout redesign).
 */
function GameBanner({ title, subtitle, variant = "round", visible }) {
  const { t } = useI18n();
  if (!visible) return null;

  return (
    <div
      className={`game-banner game-banner--${variant}`}
      role="status"
      aria-live="polite"
    >
      <p className="game-banner__title">{title}</p>
      {subtitle ? <p className="game-banner__subtitle">{subtitle}</p> : null}
      <span className="sr-only">{t("dialog.title")}</span>
    </div>
  );
}

export default GameBanner;
