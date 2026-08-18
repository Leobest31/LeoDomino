import { useI18n } from "../i18n";
import "./LandscapePrompt.css";

/**
 * Opaque rotate-to-landscape overlay. Parent keeps the match mounted.
 */
function LandscapePrompt() {
  const { t } = useI18n();
  return (
    <div className="landscape-prompt" role="dialog" aria-modal="true" aria-labelledby="landscape-prompt-title">
      <div className="landscape-prompt__card">
        <div className="landscape-prompt__glyph" aria-hidden="true" />
        <h2 id="landscape-prompt-title" className="landscape-prompt__title">
          {t("game.rotateTitle")}
        </h2>
        <p className="landscape-prompt__body">{t("game.rotateBody")}</p>
      </div>
    </div>
  );
}

export default LandscapePrompt;
