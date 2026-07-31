import { useI18n } from "../i18n";
import "./LanguageSwitcher.css";

/**
 * Compact language selector. Instant switch; preference persisted locally.
 * Safe to place on any screen — does not depend on game state.
 */
function LanguageSwitcher({ className = "" }) {
  const { locale, setLocale, locales, t } = useI18n();

  return (
    <label className={`language-switcher ${className}`.trim()}>
      <span className="sr-only">{t("language.switcherAria")}</span>
      <select
        className="language-switcher__select"
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
        aria-label={t("language.switcherAria")}
      >
        {locales.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

export default LanguageSwitcher;
