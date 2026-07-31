import { useI18n } from "../i18n";
import { DIFFICULTY_ORDER } from "../game/ai/difficulties.js";
import "./DifficultySwitcher.css";

/**
 * Compact difficulty control — same interaction pattern as language switcher.
 */
function DifficultySwitcher({ value, onChange, className = "" }) {
  const { t } = useI18n();

  return (
    <label className={`difficulty-switcher ${className}`.trim()}>
      <span className="sr-only">{t("ai.switcherAria")}</span>
      <select
        className="difficulty-switcher__select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t("ai.switcherAria")}
      >
        {DIFFICULTY_ORDER.map((id) => (
          <option key={id} value={id}>
            {t(`ai.difficulty.${id}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default DifficultySwitcher;
