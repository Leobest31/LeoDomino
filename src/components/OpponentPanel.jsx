import { useI18n } from "../i18n";
import Domino from "./Domino";
import Avatar from "./Avatar";
import "./OpponentPanel.css";

function OpponentPanel({
  name,
  status,
  tileCount = 7,
  thinking = false,
  isTurn = false,
}) {
  const { t } = useI18n();
  const resolvedName = name ?? t("game.rival");
  const resolvedStatus = status ?? t("game.waiting");
  const tiles = Array.from({ length: tileCount }, (_, index) => `opp-${index}`);

  return (
    <section
      className={`opponent-panel${thinking ? " opponent-panel--thinking" : ""}${
        isTurn && !thinking ? " opponent-panel--turn" : ""
      }`}
      aria-label={t("game.handAria", { name: resolvedName })}
    >
      <div className="opponent-panel__meta">
        <div className="opponent-panel__identity">
          <Avatar
            label={resolvedName}
            tone="rival"
            size="sm"
            active={thinking || isTurn}
          />
          <div className="opponent-panel__text">
            <span className="opponent-panel__name">{resolvedName}</span>
            <span
              className={
                thinking
                  ? "opponent-panel__status opponent-panel__status--thinking"
                  : isTurn
                    ? "opponent-panel__status opponent-panel__status--turn"
                    : "opponent-panel__status"
              }
            >
              {resolvedStatus}
            </span>
          </div>
        </div>
        <span
          className="opponent-panel__count"
          aria-label={t("game.tilesCount", { count: tileCount })}
        >
          {t("game.tilesCount", { count: tileCount })}
        </span>
      </div>

      <div className="opponent-panel__tray" data-opponent-origin="true">
        <ul className="opponent-panel__hand">
          {tiles.map((id, index) => (
            <li
              key={id}
              className="opponent-panel__tile opponent-panel__tile--enter"
              style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
            >
              <Domino faceDown orientation="vertical" size="sm" label={t("game.opponentTile")} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default OpponentPanel;
