import { useI18n } from "../i18n";
import "./AbandonMatchDialog.css";

function AbandonMatchDialog({ open, intent = "home", onLeave, onCancel }) {
  const { t } = useI18n();
  if (!open) return null;

  const isNewMatch = intent === "new-match";

  return (
    <div
      className="abandon-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="abandon-title"
      data-abandon-intent={intent || "home"}
    >
      <button type="button" className="abandon-dialog__backdrop" aria-label={t("common.cancel")} onClick={onCancel} />
      <div className="abandon-dialog__panel">
        <h2 id="abandon-title" className="abandon-dialog__title">
          {isNewMatch ? t("game.abandonNewMatchTitle") : t("game.abandonTitle")}
        </h2>
        <p className="abandon-dialog__body">
          {isNewMatch ? t("game.abandonNewMatchBody") : t("game.abandonBody")}
        </p>
        <div className="abandon-dialog__actions">
          <button type="button" className="abandon-dialog__leave" onClick={onLeave}>
            {isNewMatch ? t("game.abandonStartNewMatch") : t("game.leaveMatch")}
          </button>
          <button type="button" className="abandon-dialog__cancel" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AbandonMatchDialog;
