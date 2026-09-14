import { Component } from "react";
import { useI18n } from "../i18n";
import { reportError } from "../monitoring";
import "./AdminPage.css";

function isDevRuntime() {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function safeCrashDetail(error) {
  const raw = String(error?.message || error || "").slice(0, 180);
  if (!raw) return "";
  if (/token|jwt|password|secret|email|phone|service.?role/i.test(raw)) return "";
  return raw;
}

export function AdminBackBar({ onBack }) {
  const { t } = useI18n();
  return (
    <header className="admin-page__topbar">
      <button
        type="button"
        className="admin-page__back"
        data-admin-back="true"
        onClick={() => onBack?.()}
        aria-label={t("common.back")}
      >
        <span className="admin-page__back-chevron" aria-hidden="true" />
        <span>{t("common.back")}</span>
      </button>
    </header>
  );
}

/**
 * Visible /admin states before AdminPage may mount (session restore, signed-out).
 * Never returns null.
 */
export function AdminSessionPage({ boot, onBack, onRetry }) {
  const { t } = useI18n();
  const title =
    boot === "unauthenticated"
      ? t("admin.notAuthenticated")
      : boot === "expired"
        ? t("admin.sessionExpired")
        : t("admin.checkingSession");
  const body =
    boot === "unauthenticated"
      ? t("admin.notAuthenticatedBody")
      : boot === "expired"
        ? t("admin.sessionExpiredBody")
        : t("admin.checkingSessionBody");
  const showRetry = boot === "expired" || boot === "unauthenticated";
  return (
    <main className="admin-page" data-admin="true" data-admin-boot={boot} aria-label={t("admin.aria")}>
      <AdminBackBar onBack={onBack} />
      <div className="admin-page__gate" data-admin-gate={boot}>
        <h1>{title}</h1>
        <p>{body}</p>
        {showRetry && onRetry ? (
          <div className="admin-page__gate-actions">
            <button type="button" className="admin-page__btn" onClick={() => onRetry()}>
              {boot === "expired" ? t("admin.signInAgain") : t("admin.retry")}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, error: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, error };
  }

  componentDidCatch(error) {
    reportError(error, {
      screen: "admin",
      backendErrorCode: "REACT_RENDER_CRASH",
    });
    if (isDevRuntime()) {
      console.error("[admin-render]", error);
    }
  }

  handleRetry() {
    this.setState({ crashed: false, error: null });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <AdminCrashFallback
        detail={isDevRuntime() ? safeCrashDetail(this.state.error) : ""}
        onBack={this.props.onBack}
        onRetry={this.handleRetry}
      />
    );
  }
}

function AdminCrashFallback({ detail, onBack, onRetry }) {
  const { t } = useI18n();
  return (
    <main className="admin-page" data-admin="true" data-admin-crash="true" role="alert">
      <AdminBackBar onBack={onBack} />
      <div className="admin-page__gate" data-admin-gate="crash">
        <h1>{t("admin.renderError")}</h1>
        <p>{t("admin.renderErrorBody")}</p>
        {detail ? <p data-admin-crash-dev="true">{detail}</p> : null}
        <div className="admin-page__gate-actions">
          <button type="button" className="admin-page__btn" onClick={() => onRetry?.()}>
            {t("admin.retry")}
          </button>
        </div>
      </div>
    </main>
  );
}

export class AdminPanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, error: null, resetKey: props.resetKey };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) {
      return { crashed: false, error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error) {
    reportError(error, {
      screen: "admin-panel",
      backendErrorCode: "REACT_RENDER_CRASH",
    });
    if (isDevRuntime()) {
      console.error("[admin-panel-render]", error);
    }
  }

  handleRetry() {
    this.setState({ crashed: false, error: null });
    this.props.onRetry?.();
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return <AdminPanelCrashFallback detail={isDevRuntime() ? safeCrashDetail(this.state.error) : ""} onRetry={this.handleRetry} />;
  }
}

function AdminPanelCrashFallback({ detail, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="admin-page__gate" data-admin-panel-error="true" role="alert">
      <h1>{t("admin.renderError")}</h1>
      <p>{t("admin.panelRenderError")}</p>
      {detail ? <p data-admin-crash-dev="true">{detail}</p> : null}
      <div className="admin-page__gate-actions">
        <button type="button" className="admin-page__btn" onClick={() => onRetry?.()}>
          {t("admin.retry")}
        </button>
      </div>
    </div>
  );
}
