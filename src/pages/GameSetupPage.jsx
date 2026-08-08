import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import BrandLogo from "../components/BrandLogo";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import {
  SETUP_DIFFICULTY_ORDER,
  setupDifficultyLabelKey,
  toSetupDifficulty,
} from "../game/ai/setupDifficulties.js";
import {
  PLAYER_COUNT_STORAGE_KEY,
  normalizePlayerCount,
} from "../game/players.js";
import {
  DEFAULT_GAME_STYLE_ID,
  DEFAULT_RULESET_ID,
  RULESET_STORAGE_KEY,
  gameStyleToRulesetId,
  listAvailableGameStyles,
  normalizeGameStyleId,
  normalizeRulesetId,
} from "../game/rulesets/index.js";
import { loadMatch } from "../persistence/index.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import "./GameSetupPage.css";

const PLAYER_COUNTS = Object.freeze([2, 3, 4]);
const GAME_STYLES = listAvailableGameStyles();

/** Shorter native labels for the setup language row (codes unchanged). */
const SETUP_LOCALE_LABEL = Object.freeze({
  ht: "Kreyòl",
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
});

/**
 * Pre-game configuration — language, seats, sound, AI.
 * Table composition is always 1 human + (N−1) AI.
 */
function GameSetupPage({ onPlay, onResume }) {
  const { t, locale, setLocale, locales } = useI18n();
  const { muted, setMuted, play, unlock } = useAudio();

  const [playerCount, setPlayerCountState] = useState(() =>
    normalizePlayerCount(readStorage(PLAYER_COUNT_STORAGE_KEY, 2))
  );
  const [difficulty, setDifficulty] = useState(() =>
    toSetupDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY))
  );
  const [gameStyleId, setGameStyleId] = useState(() =>
    normalizeGameStyleId(readStorage(RULESET_STORAGE_KEY, DEFAULT_GAME_STYLE_ID))
  );

  const canResume = useMemo(() => Boolean(loadMatch()?.state), []);
  const selectedStyle = useMemo(
    () => GAME_STYLES.find((style) => style.id === gameStyleId) ?? GAME_STYLES[0],
    [gameStyleId]
  );

  const setPlayerCount = (count) => {
    setPlayerCountState(normalizePlayerCount(count));
  };

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const handlePlay = () => {
    tap(() => {
      const count = normalizePlayerCount(playerCount);
      const level = normalizeDifficulty(difficulty);
      const styleId = normalizeGameStyleId(gameStyleId);
      const rulesetId = normalizeRulesetId(
        gameStyleToRulesetId(styleId) ?? DEFAULT_RULESET_ID
      );
      writeStorage(PLAYER_COUNT_STORAGE_KEY, count);
      writeStorage(AI_DIFFICULTY_STORAGE_KEY, level);
      writeStorage(RULESET_STORAGE_KEY, rulesetId);
      onPlay?.({
        playerCount: count,
        difficulty: level,
        rulesetId,
        gameStyleId: styleId,
        soundOn: !muted,
        locale,
      });
    });
  };

  const handleResume = () => {
    tap(() => {
      onResume?.();
    });
  };

  const soundOn = !muted;

  return (
    <main className="game-setup" aria-label={t("setup.aria")}>
      <div className="game-setup__atmosphere" aria-hidden="true">
        <div className="game-setup__wood" />
        <div className="game-setup__vignette" />
      </div>

      <div className="game-setup__shell">
        <header className="game-setup__brand">
          <BrandLogo
            size="xl"
            title={t("common.brand")}
            className="game-setup__crest"
          />
          <p className="game-setup__brand-name">{t("common.brand")}</p>
          <h1 className="game-setup__title">{t("setup.title")}</h1>
        </header>

        <section className="game-setup__panel" aria-label={t("setup.title")}>
          <fieldset className="game-setup__field">
            <legend className="game-setup__legend">{t("language.label")}</legend>
            <div
              className="game-setup__segment game-setup__segment--langs"
              role="group"
              aria-label={t("language.switcherAria")}
            >
              {locales.map((entry) => {
                const selected = entry.code === locale;
                return (
                  <button
                    key={entry.code}
                    type="button"
                    className={`game-setup__chip${selected ? " game-setup__chip--on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => tap(() => setLocale(entry.code))}
                  >
                    {SETUP_LOCALE_LABEL[entry.code] ?? entry.nativeName}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="game-setup__field">
            <legend className="game-setup__legend">{t("game.playerCount")}</legend>
            <div
              className="game-setup__segment game-setup__segment--thirds"
              role="group"
              aria-label={t("game.playerCountAria")}
            >
              {PLAYER_COUNTS.map((count) => {
                const selected = count === playerCount;
                return (
                  <button
                    key={count}
                    type="button"
                    className={`game-setup__chip${selected ? " game-setup__chip--on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => tap(() => setPlayerCount(count))}
                  >
                    {t("game.playersN", { n: count })}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="game-setup__field">
            <legend className="game-setup__legend">{t("setup.gameStyle.label")}</legend>
            <div
              className="game-setup__segment game-setup__segment--styles"
              role="group"
              aria-label={t("setup.gameStyle.aria")}
            >
              {GAME_STYLES.map((style) => {
                const selected = style.id === gameStyleId;
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={`game-setup__chip${selected ? " game-setup__chip--on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => tap(() => setGameStyleId(style.id))}
                  >
                    {t(style.nameKey)}
                  </button>
                );
              })}
            </div>
            {selectedStyle ? (
              <p className="game-setup__style-desc">{t(selectedStyle.descriptionKey)}</p>
            ) : null}
          </fieldset>

          <div className="game-setup__teasers" aria-label={t("setup.comingSoonLegend")}>
            <div
              className="game-setup__teaser game-setup__teaser--online"
              aria-disabled="true"
            >
              <div className="game-setup__teaser-head">
                <span className="game-setup__teaser-title">
                  {t("setup.onlineLabel")}
                </span>
                <span className="game-setup__teaser-badge">
                  {t("common.comingSoon")}
                </span>
              </div>
              <p className="game-setup__teaser-sub">{t("setup.onlineSubtitle")}</p>
            </div>
            <div
              className="game-setup__teaser game-setup__teaser--league"
              aria-disabled="true"
            >
              <div className="game-setup__teaser-head">
                <span className="game-setup__teaser-title">
                  {t("setup.leagueLabel")}
                </span>
                <span className="game-setup__teaser-badge game-setup__teaser-badge--gold">
                  {t("common.comingSoon")}
                </span>
              </div>
              <p className="game-setup__teaser-sub">{t("setup.leagueSubtitle")}</p>
            </div>
          </div>

          <fieldset className="game-setup__field">
            <legend className="game-setup__legend">{t("audio.title")}</legend>
            <div className="game-setup__sound-row">
              <span className="game-setup__sound-label" id="setup-sound-label">
                {t("audio.title")}
              </span>
              <button
                type="button"
                className={`game-setup__sound-toggle${soundOn ? " game-setup__sound-toggle--on" : ""}`}
                role="switch"
                aria-checked={soundOn}
                aria-labelledby="setup-sound-label"
                onClick={() => tap(() => setMuted(soundOn))}
              >
                <span className="game-setup__sound-track" aria-hidden="true">
                  <span className="game-setup__sound-thumb" />
                </span>
                <span className="game-setup__sound-state">
                  {soundOn ? t("setup.soundOn") : t("setup.soundOff")}
                </span>
              </button>
            </div>
          </fieldset>

          <fieldset className="game-setup__field">
            <legend className="game-setup__legend">{t("setup.difficulty")}</legend>
            <div
              className="game-setup__segment game-setup__segment--thirds"
              role="group"
              aria-label={t("ai.switcherAria")}
            >
              {SETUP_DIFFICULTY_ORDER.map((id) => {
                const selected = id === difficulty;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`game-setup__chip${selected ? " game-setup__chip--on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => tap(() => setDifficulty(id))}
                  >
                    {t(setupDifficultyLabelKey(id))}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </section>

        <div className="game-setup__actions">
          <button type="button" className="game-setup__play" onClick={handlePlay}>
            {t("game.play")}
          </button>
          {canResume ? (
            <button
              type="button"
              className="game-setup__resume"
              onClick={handleResume}
            >
              {t("setup.resumeMatch")}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default GameSetupPage;
