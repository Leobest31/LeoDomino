import { useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { AUTH_ERROR, useAuth } from "../auth";
import "./AccountDeletionPending.css";

function deletionErrorKey(code) {
  if (code === AUTH_ERROR.INVALID_PASSWORD || code === AUTH_ERROR.CREDENTIALS) {
    return "auth.errorDeletePassword";
  }
  if (code === AUTH_ERROR.DELETE_PENDING) return "auth.errorDeletePending";
  if (code === AUTH_ERROR.DELETE_UNAVAILABLE) return "auth.errorDeleteUnavailable";
  return "auth.errorDeleteFailed";
}

function AccountDeletionPending() {
  const { t } = useI18n();
  const { play } = useAudio();
  const { deleteAccount, logout, busy } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const retry = async () => {
    play("button");
    setError("");
    if (!password) {
      setError("auth.errorDeletePassword");
      return;
    }
    try {
      await deleteAccount(password);
    } catch (err) {
      setError(deletionErrorKey(err?.code));
    }
  };

  const signOut = async () => {
    play("button");
    await logout();
  };

  return (
    <div className="deletion-pending" data-account-deletion-pending="true" role="alertdialog" aria-labelledby="deletion-pending-title">
      <section className="deletion-pending__card">
        <h1 id="deletion-pending-title">{t("auth.deletionPendingTitle")}</h1>
        <p>{t("auth.deletionPendingBody")}</p>
        <form
          className="deletion-pending__form"
          onSubmit={(event) => {
            event.preventDefault();
            void retry();
          }}
        >
          <label className="deletion-pending__label" htmlFor="deletion-pending-password">
            {t("auth.deleteAccountPassword")}
          </label>
          <input
            id="deletion-pending-password"
            className="deletion-pending__password"
            type="password"
            name="delete-account-password"
            value={password}
            autoComplete="current-password"
            spellCheck={false}
            aria-label={t("auth.deleteAccountPassword")}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="deletion-pending__error" role="alert">
              {t(error)}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy || !password}>
            {t("auth.deletionPendingRetry")}
          </button>
        </form>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void signOut()}>
          {t("auth.logout")}
        </button>
      </section>
    </div>
  );
}

export default AccountDeletionPending;
