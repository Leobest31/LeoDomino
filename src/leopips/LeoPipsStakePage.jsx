import { useEffect, useMemo, useRef, useState } from "react";
import { homeDominos } from "../assets";
import BrandLogo from "../components/BrandLogo";
import { gameStyleFlagDataUrl, getGameStyle } from "../data/gameStyles.js";
import LeoPipsCoin from "./LeoPipsCoin.jsx";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import {
  LEOPIPS_PROGRESS_STEPS,
  LEOPIPS_STAKE_TIERS,
  LEOPIPS_STYLE_IDS,
  canEnterLeoPipsFindMatch,
  clampLeoPipsBalance,
  formatLeoPipsAmount,
  leoPipsStakeCardModel,
  leoPipsStyleTitle,
} from "./leopipsEconomy.js";
import "./LeoPipsStakePage.css";

/**
 * Isolated LeoPips stake picker. Not imported by App.jsx.
 * Local mock balance only — no matchmaking, no SQL, no hosted writes.
 * CHANGE STYLE opens a local Classic / Haitian / American selector.
 * Local preview state only — does not persist live Game Style storage.
 */
function LeoPipsStakePage({
  styleId = "classic",
  balance = 0,
  onBack,
  onChangeStyle,
  onFindMatch,
  onPlayWithFriends,
}) {
  const available = clampLeoPipsBalance(balance);
  const [style, setStyle] = useState(styleId);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const styleButtonRef = useRef(null);
  const styleMenuRef = useRef(null);
  const styleTitle = leoPipsStyleTitle(style);
  const canEnter = canEnterLeoPipsFindMatch(available);
  const styleFlag = gameStyleFlagDataUrl(getGameStyle(style));

  const cards = useMemo(
    () => LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, available, styleTitle)),
    [available, styleTitle]
  );

  const closeStyleMenu = () => {
    setStyleMenuOpen(false);
    styleButtonRef.current?.focus();
  };

  const handleToggleStyleMenu = () => {
    setStyleMenuOpen((open) => !open);
  };

  const handleSelectStyle = (next) => {
    setStyle(next);
    onChangeStyle?.(next);
    setStyleMenuOpen(false);
    styleButtonRef.current?.focus();
  };

  const handlePlay = (stake) => {
    if (!canAffordCard(cards, stake)) return;
    onFindMatch?.({ styleId: style, stake });
  };

  useEffect(() => {
    if (!styleMenuOpen) return undefined;
    const selected = styleMenuRef.current?.querySelector("[aria-pressed='true']");
    selected?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setStyleMenuOpen(false);
        styleButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [styleMenuOpen]);

  return (
    <section className="leopips-stake" data-leopips-isolated="true" data-leopips-enter={canEnter ? "ready" : "blocked"}>
      <div className="leopips-stake__atmosphere" aria-hidden="true">
        <div className="leopips-stake__wood" />
        <div className="leopips-stake__vignette" />
      </div>

      <div className="leopips-stake__shell">
        <header className="leopips-stake__header">
          <button
            type="button"
            className="leopips-stake__back"
            onClick={onBack}
            aria-label="Back"
          >
            <span className="leopips-stake__back-chevron" aria-hidden="true" />
          </button>

          <div className="leopips-stake__brand">
            <BrandLogo size="sm" className="leopips-stake__crest" title={LEOPIPS_COPY.brand} decorative />
            <span className="leopips-stake__wordmark">{LEOPIPS_COPY.brand}</span>
          </div>

          <div className="leopips-stake__wallet" data-leopips-balance={available}>
            <LeoPipsCoin stake={100} size={28} className="leopips-stake__wallet-coin" />
            <div className="leopips-stake__wallet-copy">
              <span className="leopips-stake__wallet-label">{LEOPIPS_COPY.currency}</span>
              <strong>{formatLeoPipsAmount(available)}</strong>
            </div>
            <button
              type="button"
              className="leopips-stake__plus"
              data-leopips-plus="visual-only"
              aria-label="LeoPips"
              onClick={(event) => event.preventDefault()}
            >
              +
            </button>
          </div>
        </header>

        <ol className="leopips-stake__progress" aria-label="LeoPips match flow">
          {LEOPIPS_PROGRESS_STEPS.map((step) => (
            <li
              key={step.id}
              className={`leopips-stake__step is-${step.state}`}
              data-leopips-step={step.id}
              data-leopips-step-state={step.state}
            >
              <span className="leopips-stake__step-dot" aria-hidden="true" />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>

        <section className="leopips-stake__style" data-leopips-style={style}>
          <div className="leopips-stake__style-copy">
            <h1>{styleTitle}</h1>
            <p>{LEOPIPS_COPY.chooseStake}</p>
            <button
              ref={styleButtonRef}
              type="button"
              className="leopips-stake__change"
              aria-expanded={styleMenuOpen}
              aria-haspopup="dialog"
              aria-controls="leopips-style-menu"
              onClick={handleToggleStyleMenu}
            >
              {LEOPIPS_COPY.changeStyle}
            </button>
          </div>
          <div className="leopips-stake__style-art">
            <img className="leopips-stake__dominos" src={homeDominos} alt="" draggable={false} />
            {styleFlag ? (
              <img
                className="leopips-stake__style-flag"
                src={styleFlag}
                alt=""
                draggable={false}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </section>

        <div className="leopips-stake__grid">
          {cards.map((card) => (
            <article
              key={card.stake}
              className={`leopips-stake__card${card.popular ? " is-popular" : ""}${
                card.disabled ? " is-disabled" : ""
              }`}
              data-leopips-card={card.stake}
              data-leopips-pot={card.pot}
              data-leopips-popular={card.popular ? "true" : "false"}
            >
              {card.popular ? <span className="leopips-stake__badge">{LEOPIPS_COPY.mostPopular}</span> : null}
              <LeoPipsCoin stake={card.stake} size={92} />
              <p className="leopips-stake__denom">{card.label}</p>
              <p className="leopips-stake__meta">
                {LEOPIPS_COPY.players} • {card.equation}
              </p>
              <p className="leopips-stake__pot-kicker">{LEOPIPS_COPY.potentialPot}</p>
              <p className="leopips-stake__pot">{card.potLabel}</p>
              <button
                type="button"
                className="leopips-stake__play"
                data-leopips-play={card.stake}
                disabled={card.disabled}
                onClick={() => handlePlay(card.stake)}
              >
                {LEOPIPS_COPY.play}
              </button>
            </article>
          ))}
        </div>

        {!canEnter ? (
          <div className="leopips-stake__blocked" data-leopips-insufficient="true">
            <p>{LEOPIPS_COPY.insufficient}</p>
            <p>{LEOPIPS_COPY.friendsNote}</p>
            <button
              type="button"
              className="leopips-stake__friends"
              data-leopips-friends="true"
              onClick={() => onPlayWithFriends?.()}
            >
              {LEOPIPS_COPY.friendsAction}
            </button>
          </div>
        ) : null}

        <p className="leopips-stake__rules">{LEOPIPS_COPY.rulesNote}</p>

        <div className="leopips-stake__info">
          <div>
            <strong>{LEOPIPS_COPY.fairPlayTitle}</strong>
            <span>{LEOPIPS_COPY.fairPlayBody}</span>
          </div>
          <div>
            <strong>{LEOPIPS_COPY.winBigTitle}</strong>
            <span>{LEOPIPS_COPY.winBigBody}</span>
          </div>
          <div>
            <strong>{LEOPIPS_COPY.playEarnTitle}</strong>
            <span>{LEOPIPS_COPY.playEarnBody}</span>
          </div>
        </div>
      </div>

      {styleMenuOpen ? (
        <div className="leopips-stake__style-layer" data-leopips-style-menu="true">
          <button
            type="button"
            className="leopips-stake__style-scrim"
            aria-label={LEOPIPS_COPY.closeStyleMenu}
            onClick={closeStyleMenu}
          />
          <div
            ref={styleMenuRef}
            id="leopips-style-menu"
            className="leopips-stake__style-menu"
            role="dialog"
            aria-label={LEOPIPS_COPY.chooseStyleAria}
          >
            {LEOPIPS_STYLE_IDS.map((id) => {
              const selected = style === id;
              const optionFlag = gameStyleFlagDataUrl(getGameStyle(id));
              return (
                <button
                  key={id}
                  type="button"
                  className={`leopips-stake__style-option${selected ? " is-selected" : ""}`}
                  data-leopips-style-option={id}
                  aria-pressed={selected}
                  onClick={() => handleSelectStyle(id)}
                >
                  {optionFlag ? (
                    <img
                      className="leopips-stake__style-option-flag"
                      src={optionFlag}
                      alt=""
                      draggable={false}
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="leopips-stake__style-option-mark" aria-hidden="true" />
                  )}
                  <span>{leoPipsStyleTitle(id)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function canAffordCard(cards, stake) {
  const card = cards.find((entry) => entry.stake === stake);
  return Boolean(card && !card.disabled);
}

export default LeoPipsStakePage;
