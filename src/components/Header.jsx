import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome } from "./Icon";
import BrandLogo from "./BrandLogo";
import "./Header.css";

function Header({
  startBelow = null,
  centerBelow = null,
  endBefore = null,
  compact = false,
  showBrand = true,
  onMainMenu = null,
}) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const stacked = Boolean(startBelow || centerBelow || compact);

  return (
    <header className={`header${stacked ? " header--stacked" : ""}`}>
      <div className="header__inner">
        <div className="header__side header__side--start">
          {startBelow}
        </div>

        <div className="header__brand">
          {showBrand ? <BrandLogo size="md" title={t("common.brand")} /> : null}
          {centerBelow}
        </div>

        <div className="header__side header__side--end">
          <div className="header__end-tools">
            {endBefore}
            {typeof onMainMenu === "function" ? (
              <button
                type="button"
                className="header__icon-btn header__home-btn"
                onMouseEnter={() => play("button", { gain: 0.35 })}
                onClick={async () => {
                  await unlock();
                  play("button");
                  onMainMenu();
                }}
                aria-label={t("common.home")}
              >
                <IconHome />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="header__rail" aria-hidden="true" />
    </header>
  );
}

export default Header;
