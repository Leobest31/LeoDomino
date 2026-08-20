import { useI18n } from "../i18n";
import DominoTile from "./DominoTile";
import "./ReservePicker.css";

/**
 * Temporary centered face-down reserve presentation.
 * Human pick: choose a tile. AI watch: the engine's real draw tile is
 * highlighted, still face-down, and is not player-selectable.
 */
function ReservePicker({
  tileIds = [],
  onPick,
  disabled = false,
  watch = false,
  highlightedId = null,
  hiddenId = null,
}) {
  const { t } = useI18n();
  const count = tileIds.length;

  return (
    <div
      className={`reserve-picker${watch ? " reserve-picker--watch" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={
        watch ? t("game.leoBestDrawing") : t("game.reservePickAria", { count })
      }
      data-reserve-watch={watch ? "true" : undefined}
    >
      <div className="reserve-picker__well">
        <p className="reserve-picker__title">
          {watch ? t("game.leoBestDrawing") : t("game.reservePickTitle")}
        </p>
        <p className="reserve-picker__count">
          {t("game.reserveCount", { label: t("game.reserve"), count })}
        </p>
        <ul className="reserve-picker__grid">
          {tileIds.map((id) => {
            const highlighted = highlightedId === id;
            const hidden = hiddenId === id;
            return (
              <li key={id} className="reserve-picker__cell">
                <button
                  type="button"
                  className={`reserve-picker__tile${
                    highlighted ? " reserve-picker__tile--selected" : ""
                  }${hidden ? " reserve-picker__tile--hidden" : ""}`}
                  disabled={disabled || watch}
                  data-reserve-pick={id}
                  data-reserve-draw-source={highlighted ? "true" : undefined}
                  onClick={() => {
                    if (watch) return;
                    onPick?.(id);
                  }}
                  aria-label={t("game.faceDown")}
                >
                  <DominoTile faceDown orientation="vertical" size="md" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default ReservePicker;
