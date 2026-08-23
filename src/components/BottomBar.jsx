import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconPass } from "./Icon";
import "./BottomBar.css";

function BottomBar({ canPass = false, onPass, onNewGame, children = null }) {
  const { t } = useI18n();
  const { play } = useAudio();

  const tap = (enabled, action) => {
    if (!enabled) {
      play("error");
      return;
    }
    play("button");
    action?.();
  };

  return (
    <footer className="bottom-bar">
      <div className="bottom-bar__rail" aria-hidden="true" />
      <div className="bottom-bar__inner">
        <div className="bottom-bar__actions">
          <button
            type="button"
            className="btn btn--pass bottom-bar__btn"
            data-dock-pass="true"
            aria-disabled={!canPass}
            onClick={() => tap(canPass, onPass)}
          >
            <IconPass />
            <span>{t("game.pass")}</span>
          </button>
        </div>

        <div className="bottom-bar__center">{children}</div>

        <div className="bottom-bar__end">
          <button
            type="button"
            className="btn btn--new bottom-bar__new"
            data-dock-new-match="true"
            onClick={() => {
              play("button");
              onNewGame?.();
            }}
          >
            {t("game.newMatch")}
          </button>
        </div>
      </div>
    </footer>
  );
}

export default BottomBar;
