import { useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconMute, IconSettings, IconUnmute } from "./Icon";
import BrandLogo from "./BrandLogo";
import SettingsPanel from "./SettingsPanel";
import "./Header.css";

function Header({ difficulty, onDifficultyChange }) {
  const { t } = useI18n();
  const { muted, toggleMute, play, unlock } = useAudio();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="header">
        <div className="header__inner">
          <div className="header__side header__side--start">
            <button
              type="button"
              className="header__icon-btn"
              onMouseEnter={() => play("button", { gain: 0.35 })}
              onClick={async () => {
                await unlock();
                if (muted) {
                  toggleMute();
                  play("button");
                } else {
                  play("button");
                  toggleMute();
                }
              }}
            >
              {muted ? <IconMute /> : <IconUnmute />}
              <span className="sr-only">{muted ? t("audio.unmute") : t("audio.mute")}</span>
            </button>
          </div>

          <div className="header__brand">
            <BrandLogo size="md" title={t("common.brand")} />
          </div>

          <div className="header__side header__side--end">
            <button
              type="button"
              className="header__icon-btn"
              onMouseEnter={() => play("button", { gain: 0.35 })}
              onClick={async () => {
                await unlock();
                play("button");
                setSettingsOpen(true);
              }}
            >
              <IconSettings />
              <span className="sr-only">{t("common.settings")}</span>
            </button>
          </div>
        </div>
        <div className="header__rail" aria-hidden="true" />
      </header>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        difficulty={difficulty}
        onDifficultyChange={onDifficultyChange}
      />
    </>
  );
}

export default Header;
