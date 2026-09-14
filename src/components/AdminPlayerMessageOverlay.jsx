import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import "./AdminPlayerMessageOverlay.css";

/**
 * Premium Admin message modal. Presentation only — does not touch match/game state.
 * z-index sits above Level-Up and below LeoPips Victory (queues behind victory).
 */
export default function AdminPlayerMessageOverlay({ open, messageText, onClose }) {
  const { t } = useI18n();
  const title = t("adminMessage.title");
  const closeLabel = t("adminMessage.close");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="admin-player-message-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-admin-player-message-overlay="true"
    >
      <div className="admin-player-message-overlay__backdrop" aria-hidden="true" />
      <div className="admin-player-message-overlay__card">
        <p className="admin-player-message-overlay__kicker">{t("common.brand")}</p>
        <h2 className="admin-player-message-overlay__title">{title}</h2>
        <p className="admin-player-message-overlay__body" data-admin-player-message-body="true">
          {messageText}
        </p>
        <button
          type="button"
          className="admin-player-message-overlay__close"
          data-admin-player-message-close="true"
          onClick={() => onClose?.()}
        >
          {closeLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}
