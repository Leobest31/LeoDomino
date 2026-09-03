import { useMemo } from "react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import LeoPipsCoin from "./LeoPipsCoin.jsx";
import { LEOPIPS_COPY } from "./leopipsCopy.js";
import { LEOPIPS_STAKE_TIERS, isLeoPipsBigWin } from "./leopipsEconomy.js";
import { leoPipsCoinSrc } from "./leopipsAssets.js";
import "./LeoPipsWinOverlay.css";

/**
 * Isolated LeoPips win overlay. Not mounted on the live online table.
 * Visual preview only. LeoPips coins, not real-money symbols. No hosted payout.
 */
function LeoPipsWinOverlay({
  open = false,
  payout = 0,
  stake = 100,
  onContinue,
}) {
  const reduced = usePrefersReducedMotion();
  const bigWin = isLeoPipsBigWin(payout);
  const rain = useMemo(() => {
    if (!open || reduced) return [];
    const count = bigWin ? 22 : 10;
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      left: `${4 + ((index * 17) % 90)}%`,
      delay: `${(index % 11) * 0.07}s`,
      duration: `${1.45 + (index % 5) * 0.18}s`,
      size: bigWin ? 36 + (index % 3) * 8 : 40,
      src: leoPipsCoinSrc(LEOPIPS_STAKE_TIERS[index % LEOPIPS_STAKE_TIERS.length]),
    }));
  }, [bigWin, open, reduced]);

  if (!open) return null;

  return (
    <div
      className={`leopips-win${bigWin ? " is-big" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={LEOPIPS_COPY.congratulations}
      data-leopips-win={bigWin ? "big" : "standard"}
    >
      {rain.map((drop) => (
        <img
          key={drop.id}
          className="leopips-win__drop"
          src={drop.src}
          alt=""
          width={drop.size}
          height={drop.size}
          style={{
            left: drop.left,
            width: drop.size,
            height: drop.size,
            animationDelay: drop.delay,
            animationDuration: drop.duration,
          }}
        />
      ))}
      <div className={`leopips-win__panel${bigWin ? " is-big" : ""}`}>
        <LeoPipsCoin stake={stake} size={bigWin ? 132 : 96} />
        <p className="leopips-win__hello">{LEOPIPS_COPY.congratulations}</p>
        {bigWin ? <p className="leopips-win__big">{LEOPIPS_COPY.bigWin}</p> : null}
        <p className="leopips-win__amount">{LEOPIPS_COPY.youWon(payout)}</p>
        <button type="button" onClick={onContinue}>
          {LEOPIPS_COPY.continue}
        </button>
      </div>
    </div>
  );
}

export default LeoPipsWinOverlay;
