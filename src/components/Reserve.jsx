import { useI18n } from "../i18n";
import Domino from "./Domino";
import "./Reserve.css";

function Reserve({ count = 0, label }) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("game.reserve");
  const visibleStack = Math.min(count, 4);

  return (
    <aside
      className="reserve"
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
              <Domino faceDown orientation="vertical" size="sm" />
            </div>
          ))}
          {count === 0 && <div className="reserve__empty-slot" data-reserve-top="true" />}
        </div>
      </div>

      <div className="reserve__info">
        <span className="reserve__label">{resolvedLabel}</span>
        <span className="reserve__count">{count}</span>
      </div>
    </aside>
  );
}

export default Reserve;
