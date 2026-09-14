import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import { formatMatchDuration } from "../utils/formatMatchDuration.js";
import LeoPipsCoin from "../leopips/LeoPipsCoin.jsx";
import { LEOPIPS_STAKE_TIERS } from "../leopips/leopipsEconomy.js";
import { leoPipsCoinSrc } from "../leopips/leopipsAssets.js";
import { formatLeoPipsPayout, formatSignedLeoPips } from "../online/matchPipsResult.js";
import "./LeoPipsVictoryOverlay.css";

const LEOPIPS_VICTORY_COIN_COUNT = 60;
const LEOPIPS_VICTORY_DURATION_S = 6;
const LEOPIPS_VICTORY_COIN_DURATION_MIN = 1.6;
const LEOPIPS_VICTORY_COIN_DURATION_MAX = 2.2;
const LEOPIPS_VICTORY_FOREGROUND_Z = 2147483000;
const LEOPIPS_VICTORY_WAVES = [
  [0.0, 0.2],
  [1.0, 1.2],
  [2.0, 2.2],
  [3.0, 3.2],
  [4.0, 4.2],
];
const LEOPIPS_VICTORY_CARD_PATHS = [
  { id: "ul-center-bottom", left: 10, startTop: 5, dx0: 10, dx1: 40, dx2: 18 },
  { id: "uc-center-br", left: 48, startTop: 3, dx0: 2, dx1: 8, dx2: 22 },
  { id: "ur-center-bl", left: 88, startTop: 5, dx0: -10, dx1: -38, dx2: -20 },
  { id: "cl-payout-bottom", left: 12, startTop: 34, dx0: 16, dx1: 38, dx2: 14 },
  { id: "cr-across-bottom", left: 86, startTop: 32, dx0: -16, dx1: -36, dx2: -12 },
];

function coinRain(open, reduced, stake) {
  if (!open || reduced) return [];
  const srcs = LEOPIPS_STAKE_TIERS.map((tier) => leoPipsCoinSrc(tier));
  const preferred = leoPipsCoinSrc(stake);
  return Array.from({ length: LEOPIPS_VICTORY_COIN_COUNT }, (_, index) => {
    const wave = Math.floor(index / 12);
    const inWave = index % 12;
    const [start, end] = LEOPIPS_VICTORY_WAVES[wave];
    const delay = start + (inWave / 11) * (end - start);
    const span = LEOPIPS_VICTORY_COIN_DURATION_MAX - LEOPIPS_VICTORY_COIN_DURATION_MIN;
    const rawDuration =
      LEOPIPS_VICTORY_COIN_DURATION_MIN + ((index * 3 + wave) % 7) * (span / 6);
    const duration = Math.min(rawDuration, LEOPIPS_VICTORY_DURATION_S - delay);
    const depth = 0.36 + (index % 6) * 0.12;
    const path = LEOPIPS_VICTORY_CARD_PATHS[index % LEOPIPS_VICTORY_CARD_PATHS.length];
    const jitter = (index % 3 - 1) * 3;
    const edgeOn = index % 5 === 0;
    return {
      id: index,
      wave,
      path: path.id,
      left: `${path.left + jitter}%`,
      startTop: `${path.startTop + (index % 2)}%`,
      delay: `${delay.toFixed(2)}s`,
      duration: `${duration.toFixed(2)}s`,
      size: Math.round(20 + depth * 30),
      depth,
      spinZ: `${140 + (index % 11) * 28}deg`,
      spinX: `${edgeOn ? 82 : 96 + (index % 7) * 22}deg`,
      spinY: `${edgeOn ? 88 : 108 + (index % 8) * 26}deg`,
      dx0: `${path.dx0}vw`,
      dx1: `${path.dx1}vw`,
      dx2: `${path.dx2}vw`,
      z0: `${Math.round(36 + depth * 48)}px`,
      z1: `${Math.round(140 + depth * 180)}px`,
      z2: `${Math.round(28 + depth * 36)}px`,
      src: index % 3 === 0 ? preferred : srcs[index % srcs.length],
    };
  });
}

/**
 * Live LeoPips winner celebration. Mounted only after an authoritative
 * staked public match result. Does not invent wallet balances or XP/Level.
 */
function LeoPipsVictoryOverlay({
  open = false,
  winnerName = "",
  payout = null,
  balance = null,
  stake = 20,
  roundsPlayed = 1,
  durationSeconds = 0,
  finishReason = "completed",
  matchKind = "public",
  onBackHome,
  onMainMenu,
}) {
  void finishReason;
  void matchKind;
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const panelRef = useRef(null);
  const primaryRef = useRef(null);
  const rain = useMemo(() => coinRain(open, reduced, stake), [open, reduced, stake]);
  const payoutLabel = formatLeoPipsPayout(payout);
  const balanceLabel = formatSignedLeoPips(balance);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryRef.current?.focus?.();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const overlay = (
    <div
      className={`leopips-victory${reduced ? " leopips-victory--reduced" : ""}`}
      role="presentation"
      data-leopips-victory="winner"
      data-leopips-victory-xp="no"
      data-leopips-victory-level="no"
    >
      <div className="leopips-victory__backdrop" aria-hidden="true" />
      <div
        className="leopips-victory__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <LeoPipsCoin stake={stake} size={108} className="leopips-victory__medallion" />
        <p className="leopips-victory__kicker">{t("matchOver.congratulations")}</p>
        <h2 id={titleId} className="leopips-victory__title">
          {t("matchOver.youWonTheMatch")}
        </h2>

        <dl className="leopips-victory__stats">
          <div className="leopips-victory__stat">
            <dt>{t("matchOver.winner")}</dt>
            <dd data-leopips-winner-name="true">{winnerName}</dd>
          </div>
          <div className="leopips-victory__stat leopips-victory__stat--gold">
            <dt>{t("matchOver.leopipsWon")}</dt>
            <dd data-leopips-payout={payout ?? undefined}>{payoutLabel ?? "—"}</dd>
          </div>
          <div className="leopips-victory__stat">
            <dt>{t("matchOver.yourTotalBalance")}</dt>
            <dd data-leopips-balance={balance ?? undefined}>{balanceLabel ?? "—"}</dd>
          </div>
          <div className="leopips-victory__stat">
            <dt>{t("matchOver.roundsPlayed")}</dt>
            <dd data-leopips-rounds="true">{roundsPlayed}</dd>
          </div>
          <div className="leopips-victory__stat">
            <dt>{t("matchOver.duration")}</dt>
            <dd data-leopips-duration="true">{formatMatchDuration(durationSeconds)}</dd>
          </div>
        </dl>

        <p className="leopips-victory__note">{t("matchOver.greatPlay")}</p>

        <div className="leopips-victory__actions">
          <button
            ref={primaryRef}
            type="button"
            className="leopips-victory__btn leopips-victory__btn--primary"
            data-leopips-victory-home="true"
            onClick={onBackHome}
          >
            {t("findMatch.backHome")}
          </button>
          <button
            type="button"
            className="leopips-victory__btn leopips-victory__btn--ghost"
            data-leopips-victory-menu="true"
            onClick={onMainMenu}
          >
            {t("matchOver.mainMenu")}
          </button>
        </div>
      </div>
    </div>
  );

  const celebration =
    rain.length && typeof document !== "undefined"
      ? createPortal(
          <div
            className="leopips-victory__rain"
            aria-hidden="true"
            data-leopips-coin-rain="true"
            data-leopips-coin-layer="foreground"
            data-leopips-coin-portal="document.body"
            style={{ zIndex: LEOPIPS_VICTORY_FOREGROUND_Z }}
          >
            {rain.map((drop) => (
              <img
                key={drop.id}
                className="leopips-victory__coin"
                src={drop.src}
                alt=""
                width={drop.size}
                height={drop.size}
                data-leopips-cross-card="true"
                data-leopips-path={drop.path}
                style={{
                  left: drop.left,
                  top: drop.startTop,
                  width: drop.size,
                  height: drop.size,
                  animationDelay: drop.delay,
                  animationDuration: drop.duration,
                  "--spin-x": drop.spinX,
                  "--spin-y": drop.spinY,
                  "--spin-z": drop.spinZ,
                  "--dx0": drop.dx0,
                  "--dx1": drop.dx1,
                  "--dx2": drop.dx2,
                  "--z0": drop.z0,
                  "--z1": drop.z1,
                  "--z2": drop.z2,
                  "--depth": drop.depth,
                }}
              />
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {overlay}
      {celebration}
    </>
  );
}

export default LeoPipsVictoryOverlay;
