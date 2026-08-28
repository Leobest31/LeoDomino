import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import BrandLogo from "../components/BrandLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import {
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconLock,
  IconMail,
  IconShield,
  IconUser,
  IconUserPlus,
} from "../components/Icon";
import { AUTH_ERROR, DEFAULT_AVATAR_ID, PASSWORD_MIN_LENGTH, isCloudAuth, useAuth } from "../auth";
import { PLAYER_AVATARS } from "../auth/avatars.media.js";
import CountryPicker from "../components/CountryPicker";
import { authEarthNight, authLeoEmblem } from "../assets";
import { LEGAL_URLS } from "../legal/urls.js";
import "./AuthPage.css";

function errorKey(code) {
  switch (code) {
    case AUTH_ERROR.REQUIRED:
      return "auth.errorRequired";
    case AUTH_ERROR.EMAIL:
      return "auth.errorEmail";
    case AUTH_ERROR.USERNAME:
      return "auth.errorUsername";
    case AUTH_ERROR.USERNAME_TAKEN:
      return "auth.errorUsernameTaken";
    case AUTH_ERROR.DISPLAY_NAME:
      return "auth.errorDisplayName";
    case AUTH_ERROR.EMAIL_TAKEN:
      return "auth.errorEmailTaken";
    case AUTH_ERROR.COUNTRY:
      return "auth.errorCountry";
    case AUTH_ERROR.AGE:
      return "auth.errorAge";
    case AUTH_ERROR.AGE_UNDER:
      return "auth.errorAgeUnder";
    case AUTH_ERROR.PASSWORD_SHORT:
      return "auth.errorPasswordShort";
    case AUTH_ERROR.PASSWORD_WEAK:
      return "auth.errorPasswordWeak";
    case AUTH_ERROR.PASSWORD_MISMATCH:
      return "auth.errorPasswordMismatch";
    case AUTH_ERROR.CREDENTIALS:
      return "auth.errorCredentials";
    case AUTH_ERROR.CRYPTO:
      return "auth.errorCrypto";
    default:
      return "auth.errorGeneric";
  }
}

const EMPTY = {
  email: "",
  username: "",
  displayName: "",
  avatarId: DEFAULT_AVATAR_ID,
  countryCode: "",
  age: "",
  password: "",
  confirmPassword: "",
};

function FieldIcon({ name }) {
  if (name === "email") return <IconMail className="auth__glyph" />;
  if (name === "username" || name === "displayName") return <IconUser className="auth__glyph" />;
  return <IconLock className="auth__glyph" />;
}

function AuthPage() {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const { authView, busy, createAccount, login, openCreate, openLogin } = useAuth();
  const isCreate = authView === "create";
  const [values, setValues] = useState(EMPTY);
  const [fieldError, setFieldError] = useState({});
  const [formError, setFormError] = useState("");
  const [reveal, setReveal] = useState({ password: false, confirmPassword: false });

  useEffect(() => {
    setValues(EMPTY);
    setFieldError({});
    setFormError("");
    setReveal({ password: false, confirmPassword: false });
    document.querySelector("[data-auth='true']")?.scrollTo(0, 0);
  }, [authView]);

  const title = isCreate ? t("auth.createTitle") : t("auth.loginTitle");
  const subtitle = isCreate ? t("auth.subtitleCreate") : t("auth.subtitleLogin");
  const ruleLengthMet = values.password.length >= PASSWORD_MIN_LENGTH;
  const ruleMixMet = /[A-Za-z]/.test(values.password) && /\d/.test(values.password);

  const setField = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldError((prev) => ({ ...prev, [name]: "" }));
    setFormError("");
  };

  const applyError = (error) => {
    const code = error?.code;
    if (error?.field) {
      setFieldError({ [error.field]: code });
      setFormError("");
      return;
    }
    setFormError(code || AUTH_ERROR.GENERIC);
  };

  const submit = async (event) => {
    event.preventDefault();
    unlock();
    play("button");
    setFormError("");
    try {
      if (isCreate) {
        await createAccount(values);
      } else {
        await login({ email: values.email, password: values.password });
      }
    } catch (error) {
      applyError(error);
    }
  };

  const goCreate = () => {
    play("button");
    openCreate();
  };

  const goLogin = () => {
    play("button");
    openLogin();
  };

  const fields = useMemo(() => {
    const list = [
      { name: "email", type: "email", autoComplete: "email", label: t("auth.email") },
    ];
    if (isCreate) {
      list.push(
        { name: "username", type: "text", autoComplete: "username", label: t("auth.username") },
        { name: "displayName", type: "text", autoComplete: "nickname", label: t("auth.displayName") },
      );
    }
    list.push({
      name: "password",
      type: "password",
      autoComplete: isCreate ? "new-password" : "current-password",
      label: t("auth.password"),
    });
    if (isCreate) {
      list.push({
        name: "confirmPassword",
        type: "password",
        autoComplete: "new-password",
        label: t("auth.confirmPassword"),
      });
    }
    return list;
  }, [isCreate, t]);

  return (
    <div className="auth" data-auth="true" data-auth-mode={isCreate ? "create" : "login"}>
      <div className="auth__shell">
        <div className="auth__frame">
          <div className="auth__atmosphere" aria-hidden="true">
            <div className="auth__space" />
            <div className="auth__stars" />
            <div className="auth__stars auth__stars--far" />
            <div className="auth__nebula auth__nebula--left" />
            <div className="auth__nebula auth__nebula--right" />
            <div className="auth__horizon" />
            <img className="auth__earth" src={authEarthNight} alt="" draggable={false} />
          </div>
          <div className="auth__stack">
            <div className="auth__brand">
              <img
                className="auth__emblem"
                src={authLeoEmblem}
                alt={t("common.brand")}
                draggable={false}
              />
            </div>
            <main className="auth__card" aria-label={isCreate ? t("auth.ariaCreate") : t("auth.ariaLogin")}>
              <h1 className="auth__title">{title}</h1>
              <p className="auth__lead">{subtitle}</p>
              <div className="auth__mark" aria-hidden="true">
                <span className="auth__mark-line" />
                <BrandLogo size="sm" decorative />
                <span className="auth__mark-line" />
              </div>
              <div className="auth__locale">
                <div className="auth__locale-control">
                  <span className="auth__locale-icon" aria-hidden="true">
                    <IconGlobe className="auth__glyph" />
                  </span>
                  <LanguageSwitcher />
                </div>
              </div>
              <form className="auth__form" onSubmit={submit} noValidate>
                {fields.map((field) => {
                  const isSecret = field.name === "password" || field.name === "confirmPassword";
                  const shown = Boolean(reveal[field.name]);
                  const errCode = fieldError[field.name];
                  return (
                    <Fragment key={field.name}>
                    <label className="auth__field">
                      <span className="auth__label">{field.label}</span>
                      <span className="auth__control">
                        <span className="auth__icon" aria-hidden="true">
                          <FieldIcon name={field.name} />
                        </span>
                        <input
                          className={`auth__input${errCode ? " auth__input--error" : ""}`}
                          name={field.name}
                          type={isSecret && shown ? "text" : field.type}
                          autoComplete={field.autoComplete}
                          inputMode={field.name === "email" ? "email" : undefined}
                          placeholder={field.name === "email" ? t("auth.emailPlaceholder") : undefined}
                          value={values[field.name]}
                          aria-invalid={errCode ? true : undefined}
                          aria-describedby={errCode ? `auth-err-${field.name}` : undefined}
                          onChange={(event) => setField(field.name, event.target.value)}
                        />
                        {isSecret ? (
                          <button
                            type="button"
                            className="auth__reveal"
                            aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
                            onClick={() =>
                              setReveal((prev) => ({ ...prev, [field.name]: !prev[field.name] }))
                            }
                          >
                            {shown ? <IconEyeOff className="auth__glyph" /> : <IconEye className="auth__glyph" />}
                          </button>
                        ) : null}
                      </span>
                      {errCode ? (
                        <span className="auth__error" id={`auth-err-${field.name}`} role="alert">
                          {t(errorKey(errCode))}
                        </span>
                      ) : null}
                    </label>
                    {isCreate && field.name === "username" ? (
                      <p className="auth__hint">{t("auth.usernameHint")}</p>
                    ) : null}
                    {isCreate && field.name === "displayName" ? (
                      <>
                      <p className="auth__hint">{t("auth.displayNameHint")}</p>
                      <div className="auth__avatar-field">
                        <span className="auth__label">{t("auth.avatar")}</span>
                        <div className="auth__avatars" role="listbox" aria-label={t("auth.avatar")}>
                          {PLAYER_AVATARS.map((avatar) => {
                            const selected = values.avatarId === avatar.id;
                            return (
                              <button
                                key={avatar.id}
                                type="button"
                                className={`auth__avatar${selected ? " is-selected" : ""}`}
                                role="option"
                                aria-selected={selected}
                                aria-label={t("auth.avatarChoice")}
                                onClick={() => setField("avatarId", avatar.id)}
                              >
                                <img src={avatar.src} alt="" draggable={false} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="auth__field">
                        <span className="auth__label">{t("auth.country")}</span>
                        <CountryPicker
                          value={values.countryCode}
                          onChange={(code) => setField("countryCode", code)}
                          error={Boolean(fieldError.country)}
                        />
                        {fieldError.country ? (
                          <span className="auth__error" role="alert">
                            {t(errorKey(fieldError.country))}
                          </span>
                        ) : null}
                      </label>
                      <label className="auth__field">
                        <span className="auth__label">{t("auth.age")}</span>
                        <span className="auth__control">
                          <span className="auth__icon" aria-hidden="true">
                            <IconShield className="auth__glyph" />
                          </span>
                          <input
                            className={`auth__input${fieldError.age ? " auth__input--error" : ""}`}
                            name="age"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={3}
                            data-auth-age="true"
                            value={values.age}
                            aria-invalid={fieldError.age ? true : undefined}
                            aria-describedby={fieldError.age ? "auth-err-age" : "auth-age-hint"}
                            onChange={(event) => setField("age", event.target.value)}
                          />
                        </span>
                        {fieldError.age ? (
                          <span className="auth__error" id="auth-err-age" role="alert">
                            {t(errorKey(fieldError.age))}
                          </span>
                        ) : (
                          <p className="auth__hint" id="auth-age-hint">
                            {t("auth.ageHint")}
                          </p>
                        )}
                      </label>
                      </>
                    ) : null}
                    </Fragment>
                  );
                })}
                {isCreate ? (
                  <ul className="auth__rules" aria-label={t("auth.passwordRules")}>
                    <li className={`auth__rule${ruleLengthMet ? " is-met" : ""}`}>
                      <span className="auth__check" aria-hidden="true" />
                      <span>{t("auth.ruleMinLength")}</span>
                    </li>
                    <li className={`auth__rule${ruleMixMet ? " is-met" : ""}`}>
                      <span className="auth__check" aria-hidden="true" />
                      <span>{t("auth.ruleLetterNumber")}</span>
                    </li>
                  </ul>
                ) : (
                  <p className="auth__forgot" aria-disabled="true">
                    {t("auth.forgot")}
                  </p>
                )}
                {formError ? (
                  <p className="auth__error auth__error--form" role="alert">
                    {t(errorKey(formError))}
                  </p>
                ) : null}
                <button type="submit" className="auth__submit" disabled={busy}>
                  {isCreate ? t("auth.createCta") : t("auth.loginCta")}
                </button>
              </form>
              <div className="auth__divider">
                <span className="auth__divider-line" aria-hidden="true" />
                <span className="auth__divider-text">{t("auth.divider")}</span>
                <span className="auth__divider-line" aria-hidden="true" />
              </div>
              {isCreate ? (
                <p className="auth__switch">
                  <span>{t("auth.haveAccount")}</span>
                  {" "}
                  <button type="button" className="auth__link" onClick={goLogin}>
                    {t("auth.switchToLogin")}
                  </button>
                </p>
              ) : (
                <button type="button" className="auth__secondary" onClick={goCreate}>
                  <IconUserPlus className="auth__cta-icon" />
                  <span>{t("auth.createCta")}</span>
                </button>
              )}
              <p className="auth__secure">
                <IconShield className="auth__secure-icon" />
                <span>{t(isCloudAuth() ? "auth.securityNote" : "auth.localNote")}</span>
              </p>
              <p className="auth__legal">
                <span>{t("auth.legalLead")}</span>
                {" "}
                <a href={LEGAL_URLS.terms} target="_blank" rel="noopener noreferrer">
                  {t("legal.terms")}
                </a>
                {" "}
                <span>{t("auth.legalAnd")}</span>
                {" "}
                <a href={LEGAL_URLS.privacy} target="_blank" rel="noopener noreferrer">
                  {t("legal.privacy")}
                </a>
              </p>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthPage;
