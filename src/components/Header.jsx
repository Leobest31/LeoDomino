import { useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome, IconMute, IconSettings, IconUnmute } from "./Icon";
import BrandLogo from "./BrandLogo";
import SettingsPanel from "./SettingsPanel";
import "./Header.css";

function Header({
  difficulty,
  onDifficultyChange,
  settingsOpen: settingsOpenProp,
  onSettingsOpenChange,
  startBelow = null,
  centerBelow = null,
  endBefore = null,
  compact = false,
  onMainMenu = null,
}) {
  const { t } = useI18n();
  const { muted, toggleMute, play, unlock } = useAudio();
  const [settingsOpenInternal, setSettingsOpenInternal] = useState(false);
  const controlled = typeof onSettingsOpenChange === "function";
  const settingsOpen = controlled ? Boolean(settingsOpenProp) : settingsOpenInternal;
  const setSettingsOpen = controlled ? onSettingsOpenChange : setSettingsOpenInternal;
  const stacked = Boolean(startBelow || centerBelow || compact);

  return (
    <>
      <header className={`header${stacked ? " header--stacked" : ""}`}>
        <div className="header__inner">
          <div className="header__side header__side--start">
            {startBelow}
          </div>

          <div className="header__brand">
            <BrandLogo size="md" title={t("common.brand")} />
            {centerBelow}
          </div>

          <div className="header__side header__side--end">
            <div className="header__end-tools">
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
              {endBefore}
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
            {typeof onMainMenu === "function" ? (
              <button
                type="button"
                className="header__menu-btn"
                onMouseEnter={() => play("button", { gain: 0.35 })}
                onClick={async () => {
                  await unlock();
                  play("button");
                  onMainMenu();
                }}
                aria-label={t("common.mainMenu")}
              >
                <IconHome />
                <span>{t("common.mainMenu")}</span>
              </button>
            ) : null}
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
