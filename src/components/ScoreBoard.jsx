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

/**
 * Table HUD scores — one horizontal strip (round, seats, target).
 * scoreFormat "ofTarget" shows Haitian-style "X / 4" per seat.
 */
function ScoreBoard({
  scores = [],
  names = [],
  humanIndex = 0,
  target = 100,
  round = 1,
  scoreFormat = "absolute",
  hideSeatNames = false,
  metaOnly = false,
}) {
  const { t, formatNumber } = useI18n();
  const ofTarget = scoreFormat === "ofTarget";
  const rows =
    metaOnly || scores.length === 0
      ? []
      : scores.map((score, index) => ({
          score,
          name: names[index] ?? t("game.playerN", { n: index + 1 }),
          isHuman: index === humanIndex,
        }));

  return (
    <aside
      className={`scoreboard scoreboard--table scoreboard--inline${
        metaOnly ? " scoreboard--meta" : ""
      }`}
      aria-label={t("game.scoreboard")}
    >
      <div className="scoreboard__line">
        <span className="scoreboard__label scoreboard__label--gold">
          <span className="scoreboard__icon" aria-hidden="true">
            🏆
          </span>
          {t("game.round")}
        </span>
        <span className="scoreboard__value">{formatNumber(round)}</span>
      </div>

      {rows.map((row, index) => (
        <div className="scoreboard__line" key={`score-${index}`} aria-label={t("game.scoreAria", { name: row.name })}>
          <span
            className={`scoreboard__label${
              row.isHuman ? " scoreboard__label--you" : " scoreboard__label--rival"
            }`}
          >
            <span className="scoreboard__icon" aria-hidden="true">
              {row.isHuman ? "👤" : "🤖"}
            </span>
            {hideSeatNames ? null : row.name}
          </span>
          {ofTarget ? (
            <span
              className="scoreboard__of-target"
              aria-label={`${formatNumber(row.score)} / ${formatNumber(target)}`}
            >
              <AnimatedValue value={row.score} />
              <span className="scoreboard__of-target-sep" aria-hidden="true">
                {" "}
                / {formatNumber(target)}
              </span>
            </span>
          ) : (
            <AnimatedValue value={row.score} />
          )}
        </div>
      ))}

      <div className="scoreboard__line scoreboard__line--target">
        <span className="scoreboard__label scoreboard__label--gold">
          <span className="scoreboard__icon" aria-hidden="true">
            🎯
          </span>
          {ofTarget ? t("game.matchPointsLabel") : t("game.playToLabel")}
        </span>
        <span className="scoreboard__value scoreboard__value--target">{formatNumber(target)}</span>
      </div>
    </aside>
  );
}

/**
 * Seat point value glued to a HUD avatar. The display name sits beside it
 * in the HUD identity cluster.
 */
export function SeatScore({
  value = 0,
  name = "",
  ofTarget = false,
  target = 0,
}) {
  const { t, formatNumber } = useI18n();
  return (
    <div
      className="scoreboard__seat-score"
      aria-label={t("game.scoreAria", { name })}
    >
      {ofTarget ? (
        <span className="scoreboard__of-target">
          <AnimatedValue value={value} />
          <span className="scoreboard__of-target-sep" aria-hidden="true">
            {" "}
            / {formatNumber(target)}
          </span>
        </span>
      ) : (
        <AnimatedValue value={value} />
      )}
    </div>
  );
}

export default ScoreBoard;
