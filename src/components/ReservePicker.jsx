import { useI18n } from "../i18n";
import DominoTile from "./DominoTile";
import "./ReservePicker.css";

/**
 * Temporary centered face-down reserve selection — only while the human
 * has no legal play and drawing is allowed. Never left on the felt.
 */
function ReservePicker({ tileIds = [], onPick, disabled = false }) {
  const { t } = useI18n();
  const count = tileIds.length;

  return (
    <div
      className="reserve-picker"
      role="dialog"
      aria-modal="false"
      aria-label={t("game.reservePickAria", { count })}
    >
      <div className="reserve-picker__well">
        <p className="reserve-picker__title">{t("game.reservePickTitle")}</p>
        <p className="reserve-picker__count">
          {t("game.reserveCount", { label: t("game.reserve"), count })}
        </p>
        <ul className="reserve-picker__grid">
          {tileIds.map((id) => (
            <li key={id} className="reserve-picker__cell">
              <button
                type="button"
                className="reserve-picker__tile"
                disabled={disabled}
                data-reserve-pick={id}
                onClick={() => onPick?.(id)}
                aria-label={t("game.faceDown")}
              >
                <DominoTile faceDown orientation="vertical" size="sm" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ReservePicker;
