import { useI18n } from "../i18n";
import "./CrashFallback.css";

export function CrashFallback({ onReload }) {
  const { t } = useI18n();
  return (
    <main className="crash-fallback" role="alert">
      <div className="crash-fallback__panel">
        <h1 className="crash-fallback__title">{t("common.crashTitle")}</h1>
        <p className="crash-fallback__body">{t("common.crashBody")}</p>
        <button type="button" className="crash-fallback__reload" onClick={onReload}>
          {t("common.crashReload")}
        </button>
      </div>
    </main>
  );
}
