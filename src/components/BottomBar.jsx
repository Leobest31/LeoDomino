import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconDraw, IconPass, IconPlay } from "./Icon";
import "./BottomBar.css";

function BottomBar({
  canPlay = false,
  canDraw = false,
  canPass = false,
  onPlay,
  onDraw,
  onPass,
  onNewGame,
}) {
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
            className="btn btn--play bottom-bar__btn"
            aria-disabled={!canPlay}
            onClick={() => tap(canPlay, onPlay)}
          >
            <IconPlay />
            <span>{t("game.play")}</span>
          </button>
          <button
            type="button"
            className="btn btn--draw bottom-bar__btn"
            aria-disabled={!canDraw}
            onClick={() => tap(canDraw, onDraw)}
          >
            <IconDraw />
            <span>{t("game.draw")}</span>
          </button>
          <button
            type="button"
            className="btn btn--pass bottom-bar__btn"
            aria-disabled={!canPass}
            onClick={() => tap(canPass, onPass)}
          >
            <IconPass />
            <span>{t("game.pass")}</span>
          </button>
        </div>

        <button
          type="button"
          className="btn btn--new bottom-bar__new"
          onClick={() => {
            play("button");
            onNewGame?.();
          }}
        >
          {t("game.newMatch")}
        </button>
      </div>
    </footer>
  );
}

export default BottomBar;
