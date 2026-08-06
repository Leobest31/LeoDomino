import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import DominoTile from "./DominoTile";
import "./Reserve.css";

function Reserve({ count = 0, label }) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("game.reserve");
  const visibleStack = Math.min(count, 3);
  const prevCount = useRef(count);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prevCount.current === count) return undefined;
    prevCount.current = count;
    setPulse(true);
    const id = window.setTimeout(() => setPulse(false), 420);
    return () => window.clearTimeout(id);
  }, [count]);

  return (
    <aside
      className={`reserve${pulse ? " reserve--pulse" : ""}`}
      aria-label={t("game.reserveAria", { label: resolvedLabel, count })}
      data-reserve-root="true"
    >
      <div className="reserve__well">
        <div className="reserve__stack" aria-hidden="true">
          {Array.from({ length: visibleStack }, (_, index) => (
            <div
              key={index}
              className="reserve__card"
              data-reserve-top={index === visibleStack - 1 ? "true" : undefined}
              style={{
                transform: `translate(${index * 3}px, ${index * -2}px)`,
                zIndex: index,
              }}
            >
              <DominoTile faceDown orientation="vertical" size="sm" />
            </div>
          ))}
          {count === 0 && <div className="reserve__empty-slot" data-reserve-top="true" />}
        </div>
      </div>

      <div className="reserve__info">
        <span className="reserve__label">{resolvedLabel}</span>
        <span className={`reserve__count${pulse ? " reserve__count--tick" : ""}`}>{count}</span>
      </div>
    </aside>
  );
}

export default Reserve;
