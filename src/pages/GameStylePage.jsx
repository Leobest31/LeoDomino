import { useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome } from "../components/Icon";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import { V1_PLAYER_COUNT } from "../game/v1Product.js";
import {
  DEFAULT_GAME_STYLE_ID,
  DEFAULT_RULESET_ID,
  RULESET_STORAGE_KEY,
  gameStyleFlagDataUrl,
  gameStyleFlagEmoji,
  gameStyleToRulesetId,
  listV1GameStyles,
  normalizeGameStyleId,
  normalizeRulesetId,
} from "../data/gameStyles.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import "./GameStylePage.css";

const GAME_STYLES = listV1GameStyles();

/**
 * Game Style picker for Play vs LeoBest.
 * Select a style, then PLAY to start Human vs LeoBest.
 * No player-count selector — V1 is permanently 1v1.
 */
function GameStylePage({ onBack, onMainMenu, onPlay }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const [selectedId, setSelectedId] = useState(() => {
    const stored = normalizeGameStyleId(
      readStorage(RULESET_STORAGE_KEY, DEFAULT_GAME_STYLE_ID)
    );
    return GAME_STYLES.some((style) => style.id === stored)
      ? stored
      : DEFAULT_GAME_STYLE_ID;
  });

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const persistStyle = (styleId) => {
    const id = normalizeGameStyleId(styleId);
    const rulesetId = normalizeRulesetId(
      gameStyleToRulesetId(id) ?? DEFAULT_RULESET_ID
    );
    writeStorage(RULESET_STORAGE_KEY, rulesetId);
    setSelectedId(id);
    return rulesetId;
  };

  const handleSelect = (styleId) => {
    tap(() => persistStyle(styleId));
  };

  const handlePlay = () => {
    tap(() => {
      const rulesetId = persistStyle(selectedId);
      onPlay?.({
        playerCount: V1_PLAYER_COUNT,
        difficulty: normalizeDifficulty(
          readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY)
        ),
        rulesetId,
      });
    });
  };

  const handleBack = () => {
    tap(() => onBack?.());
  };

  const handleMainMenu = () => {
    tap(() => onMainMenu?.());
  };

  const selectedStyle = GAME_STYLES.find((style) => style.id === selectedId);
  const playReady = Boolean(selectedStyle) && selectedStyle.enabled !== false && selectedStyle.available;

  return (
    <main className="game-style" aria-label={t("setup.gameStyle.screenAria")}>
      <div className="game-style__atmosphere" aria-hidden="true">
        <div className="game-style__wood" />
        <div className="game-style__vignette" />
      </div>

      <div className="game-style__shell">
        <header className="game-style__header">
          <button
            type="button"
            className="game-style__back"
            onClick={handleBack}
            aria-label={t("common.back")}
          >
            <span className="game-style__back-chevron" aria-hidden="true" />
            <span className="game-style__back-label">{t("common.back")}</span>
          </button>
          <h1 className="game-style__title">{t("setup.gameStyle.label")}</h1>
          <button
            type="button"
            className="game-style__menu"
            onClick={handleMainMenu}
            aria-label={t("common.mainMenu")}
          >
            <IconHome />
            <span className="game-style__menu-label">{t("common.mainMenu")}</span>
          </button>
        </header>

        <p className="game-style__hint">{t("setup.gameStyle.chooseThenPlay")}</p>

        <section
          className="game-style__panel"
          role="listbox"
          aria-label={t("setup.gameStyle.aria")}
          aria-activedescendant={
            selectedId ? `game-style-option-${selectedId}` : undefined
          }
        >
          {GAME_STYLES.map((style) => {
            const selected = style.id === selectedId;
            const flagImg = gameStyleFlagDataUrl(style);
            const flag = gameStyleFlagEmoji(style);
            const disabled = style.enabled === false || !style.available;
            return (
              <button
                key={style.id}
                id={`game-style-option-${style.id}`}
                type="button"
                role="option"
                className={`game-style__card${selected ? " game-style__card--selected" : ""}${
                  disabled ? " game-style__card--disabled" : ""
                }`}
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  handleSelect(style.id);
                }}
              >
                <div className="game-style__card-main">
                  <div className="game-style__card-title-row">
                    {flagImg ? (
                      <img
                        className="game-style__flag"
                        src={flagImg}
                        alt=""
                        draggable={false}
                        aria-hidden="true"
                      />
                    ) : flag ? (
                      <span className="game-style__flag" aria-hidden="true">
                        {flag}
                      </span>
                    ) : null}
                    <span className="game-style__card-name">{t(style.nameKey)}</span>
                  </div>
                  {style.descriptionKey ? (
                    <p className="game-style__card-desc">{t(style.descriptionKey)}</p>
                  ) : null}
                </div>
                <span
                  className={`game-style__mark${selected ? " game-style__mark--on" : ""}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </section>
      </div>

      <div className="game-style__playbar">
        <button
          type="button"
          className="game-style__play"
          data-game-style-play="true"
          onClick={handlePlay}
          disabled={!playReady}
          aria-disabled={!playReady}
        >
          {t("game.play")}
        </button>
      </div>
    </main>
  );
}

export default GameStylePage;
