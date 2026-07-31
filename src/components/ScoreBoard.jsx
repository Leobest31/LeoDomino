import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import { MOTION, easeOutCubic } from "../utils/motion.js";
import "./ScoreBoard.css";

function AnimatedValue({ value }) {
  const { formatNumber } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const [bump, setBump] = useState(false);
  const displayRef = useRef(value);

  useEffect(() => {
    if (displayRef.current === value) return undefined;

    if (reduced) {
      displayRef.current = value;
      setDisplay(value);
      return undefined;
    }

    const from = displayRef.current;
    const to = value;
    const start = performance.now();
    let raf = 0;
    setBump(true);

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / MOTION.scoreMs);
      const next = Math.round(from + (to - from) * easeOutCubic(progress));
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) {
        raf = window.requestAnimationFrame(tick);
      } else {
        displayRef.current = to;
        setDisplay(to);
        setBump(false);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      displayRef.current = value;
      setDisplay(value);
      setBump(false);
    };
  }, [reduced, value]);

  return (
    <span className={`scoreboard__points${bump ? " scoreboard__points--bump" : ""}`}>
      {formatNumber(display)}
    </span>
  );
}

function ScoreBoard({
  playerScore = 0,
  opponentScore = 0,
  target = 100,
  round = 1,
  playerName,
  opponentName,
}) {
  const { t, formatNumber } = useI18n();
  const resolvedPlayer = playerName ?? t("game.you");
  const resolvedOpponent = opponentName ?? t("game.rival");
  const playerPct = Math.min(100, (playerScore / target) * 100);
  const opponentPct = Math.min(100, (opponentScore / target) * 100);

  return (
    <aside className="scoreboard" aria-label={t("game.scoreboard")}>
      <div className="scoreboard__round">
        <span className="scoreboard__round-label">{t("game.round")}</span>
        <span className="scoreboard__round-value">{formatNumber(round)}</span>
      </div>

      <div className="scoreboard__rows">
        <div className="scoreboard__row">
          <div className="scoreboard__row-top">
            <span className="scoreboard__name">{resolvedPlayer}</span>
            <AnimatedValue value={playerScore} />
          </div>
          <div
            className="scoreboard__track"
            role="progressbar"
            aria-valuenow={playerScore}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-label={t("game.scoreAria", { name: resolvedPlayer })}
          >
            <span className="scoreboard__fill scoreboard__fill--player" style={{ width: `${playerPct}%` }} />
          </div>
        </div>

        <div className="scoreboard__row">
          <div className="scoreboard__row-top">
            <span className="scoreboard__name">{resolvedOpponent}</span>
            <AnimatedValue value={opponentScore} />
          </div>
          <div
            className="scoreboard__track"
            role="progressbar"
            aria-valuenow={opponentScore}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-label={t("game.scoreAria", { name: resolvedOpponent })}
          >
            <span className="scoreboard__fill scoreboard__fill--opponent" style={{ width: `${opponentPct}%` }} />
          </div>
        </div>
      </div>

      <p className="scoreboard__target">
        {t("game.playToLabel")} <strong>{formatNumber(target)}</strong>
      </p>
    </aside>
  );
}

export default ScoreBoard;
