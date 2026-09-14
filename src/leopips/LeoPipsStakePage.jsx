import { useEffect, useMemo, useRef, useState } from "react";
import { homeDominos } from "../assets";
import BrandLogo from "../components/BrandLogo";
import { gameStyleFlagDataUrl, getGameStyle } from "../data/gameStyles.js";
import LeoPipsCoin from "./LeoPipsCoin.jsx";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import {
  LEOPIPS_STAKE_TIERS,
  LEOPIPS_STYLE_IDS,
  canEnterLeoPipsFindMatch,
  clampLeoPipsBalance,
  formatLeoPipsAmount,
  leoPipsStakeCardModel,
  leoPipsStyleTitle,
} from "./leopipsEconomy.js";
import {
  emptyLeoPipsStakeCounts,
  formatLeoPipsRequestCountLabel,
} from "./leopipsStakeRequestCounts.js";
import "./LeoPipsStakePage.css";

function stakeWalletLabel(isolated, walletStatus, balance) {
  if (isolated) return formatLeoPipsAmount(clampLeoPipsBalance(balance));
  if (walletStatus === "loading") return LEOPIPS_COPY.walletLoading;
  if (walletStatus === "ready") return formatLeoPipsAmount(clampLeoPipsBalance(balance));
  return LEOPIPS_COPY.walletUnavailable;
}

function stakeEnterState(isolated, walletStatus, balance) {
  if (!isolated && walletStatus === "loading") return "loading";
  if (!isolated && walletStatus !== "ready") return "blocked";
  return canEnterLeoPipsFindMatch(balance) ? "ready" : "blocked";
}

/**
 * LeoPips stake picker. Isolated preview uses local fixtures.
 * Authenticated testers pass a hosted read-only wallet. PLAY does not debit.
 * CHANGE STYLE opens a Classic / Haitian / American selector. It does not cycle.
 */
function LeoPipsStakePage({
  isolated = true,
  styleId = "classic",
  balance = 0,
  walletStatus = "ready",
  onBack,
  onChangeStyle,
  onFindMatch,
  onPlayWithFriends,
  requestCounts,
  requestCountsStatus = "ready",
}) {
  const walletReady = isolated || walletStatus === "ready";
  const available = walletReady ? clampLeoPipsBalance(balance) : 0;
  const walletLabel = stakeWalletLabel(isolated, walletStatus, balance);
  const enter = stakeEnterState(isolated, walletStatus, available);
  const canEnter = enter === "ready";
  const [style, setStyle] = useState(styleId);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const styleButtonRef = useRef(null);
  const styleMenuRef = useRef(null);
  const styleTitle = leoPipsStyleTitle(style);
  const styleFlag = gameStyleFlagDataUrl(getGameStyle(style));

  useEffect(() => {
    setStyle(styleId);
  }, [styleId]);

  const cards = useMemo(
    () => LEOPIPS_STAKE_TIERS.map((stake) => leoPipsStakeCardModel(stake, available, styleTitle)),
    [available, styleTitle]
  );
  const liveCounts = requestCounts || emptyLeoPipsStakeCounts();

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
    if (!canEnter || !canAffordCard(cards, stake)) return;
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
    <section
      className="leopips-stake"
      data-leopips-isolated={isolated ? "true" : "false"}
      data-leopips-enter={enter}
      data-leopips-wallet={walletStatus}
    >
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

          <div className="leopips-stake__wallet" data-leopips-balance={walletReady ? available : walletStatus}>
            <LeoPipsCoin stake={100} size={28} className="leopips-stake__wallet-coin" />
            <div className="leopips-stake__wallet-copy">
              <span className="leopips-stake__wallet-label">{LEOPIPS_COPY.currency}</span>
              <strong>{walletLabel}</strong>
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
              className={`leopips-stake__card leopips-stake__card--${card.stake}${
                card.popular ? " is-popular" : ""
              }${card.disabled ? " is-disabled" : ""}`}
              data-leopips-card={card.stake}
              data-leopips-tier-color={stakeTierColor(card.stake)}
              data-leopips-pot={card.pot}
              data-leopips-popular={card.popular ? "true" : "false"}
            >
              {card.popular ? <span className="leopips-stake__badge">{LEOPIPS_COPY.mostPopular}</span> : null}
              <StakeRequestBadge
                count={liveCounts[card.stake]}
                status={isolated ? "ready" : requestCountsStatus}
                stake={card.stake}
              />
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

        {enter === "blocked" && walletReady ? (
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

        {!isolated && walletStatus === "error" ? (
          <div className="leopips-stake__blocked" data-leopips-wallet-error="true">
            <p>{LEOPIPS_COPY.walletReadFailed}</p>
          </div>
        ) : null}

        {!isolated && walletStatus === "missing" ? (
          <div className="leopips-stake__blocked" data-leopips-wallet-missing="true">
            <p>{LEOPIPS_COPY.walletMissing}</p>
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

function StakeRequestBadge({ count, status, stake }) {
  const confirmed = status === "ready";
  const label = confirmed ? formatLeoPipsRequestCountLabel(count) : "";
  return (
    <span
      className="leopips-stake__requests"
      data-leopips-requests={stake}
      data-leopips-requests-count={confirmed ? String(Math.max(0, Number(count) || 0)) : ""}
      data-leopips-requests-status={status}
      aria-hidden={!confirmed}
      aria-busy={status === "loading" ? "true" : undefined}
    >
      <RequestsPeopleIcon />
      {confirmed ? <span className="leopips-stake__requests-label">{label}</span> : null}
    </span>
  );
}

function RequestsPeopleIcon() {
  return (
    <svg className="leopips-stake__requests-icon" viewBox="0 0 16 12" aria-hidden="true">
      <circle cx="5.6" cy="3.2" r="2" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M1.7 10.6c.25-2.15 1.65-3.35 3.9-3.35s3.65 1.2 3.9 3.35"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="11.4" cy="3.55" r="1.65" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M9.55 10.6c.2-1.55 1.05-2.45 2.5-2.45 1.4 0 2.25.9 2.45 2.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function stakeTierColor(stake) {
  if (stake === 20) return "green";
  if (stake === 50) return "blue";
  if (stake === 100) return "purple";
  if (stake === 150) return "gold";
  return "green";
}

function canAffordCard(cards, stake) {
  const card = cards.find((entry) => entry.stake === stake);
  return Boolean(card && !card.disabled);
}

export default LeoPipsStakePage;
