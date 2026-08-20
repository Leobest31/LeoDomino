import { useI18n } from "../i18n";
import "./AbandonMatchDialog.css";

function AbandonMatchDialog({ open, onLeave, onCancel }) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="abandon-dialog" role="dialog" aria-modal="true" aria-labelledby="abandon-title">
      <button type="button" className="abandon-dialog__backdrop" aria-label={t("common.cancel")} onClick={onCancel} />
      <div className="abandon-dialog__panel">
        <h2 id="abandon-title" className="abandon-dialog__title">
          {t("game.abandonTitle")}
        </h2>
        <p className="abandon-dialog__body">{t("game.abandonBody")}</p>
        <div className="abandon-dialog__actions">
          <button type="button" className="abandon-dialog__leave" onClick={onLeave}>
            {t("game.leaveMatch")}
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
