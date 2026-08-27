import { useI18n } from "../i18n";
import "./AbandonMatchDialog.css";

function AbandonMatchDialog({
  open,
  intent = "home",
  onLeave,
  onCancel,
  busy = false,
  errorKey = "",
}) {
  const { t } = useI18n();
  if (!open) return null;

  const isNewMatch = intent === "new-match";

  const confirmLeave = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (busy) return;
    onLeave?.();
  };

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
        {errorKey ? (
          <p className="abandon-dialog__error" role="alert" data-abandon-error={errorKey}>
            {t(errorKey)}
          </p>
        ) : null}
        <div className="abandon-dialog__actions">
          <button
            type="button"
            className="abandon-dialog__leave"
            data-abandon-leave="true"
            disabled={busy}
            aria-busy={busy ? "true" : undefined}
            onClick={confirmLeave}
          >
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
