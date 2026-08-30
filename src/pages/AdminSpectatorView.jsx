import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import GameTable from "../components/GameTable";
import OpponentPanel from "../components/OpponentPanel";
import ScoreBoard, { SeatScore } from "../components/ScoreBoard";
import PlayerAvatar from "../components/PlayerAvatar";
import { tryResolveRuleset, gameStyleForRulesetId } from "../game/rulesets/registry.js";
import {
  applyGameplayLayoutVars,
  gameplayDensityClass,
  measureSafeGameplayBox,
  resolveGameplayLayout,
} from "../ui/gameplayLayout.js";
import {
  ADMIN_SPECTATOR_POLL_MS,
  adminErrorI18nKey,
  fetchAdminLiveMatchView,
  isAdminSpectatorEnded,
  liveMatchStatusKey,
  shouldApplySpectatorSnapshot,
} from "../online/adminDashboard.js";
import {
  formatTurnSeconds,
  remainingTurnMs,
  stampDeadlineReceipt,
  turnTimerTone,
} from "../online/turnTimeout.js";
import "./GamePage.css";
import "./AdminSpectatorView.css";

function useGameplayLayout(layoutOptions = {}) {
  const pageRef = useRef(null);
  const playerCount = Number(layoutOptions.playerCount) || 2;
  const rulesetId = layoutOptions.rulesetId ?? "";

  useLayoutEffect(() => {
    const el = pageRef.current;
    if (!el) return undefined;

    const apply = () => {
      const layout = resolveGameplayLayout(measureSafeGameplayBox(el), {
        playerCount,
        rulesetId,
      });
      applyGameplayLayoutVars(el, layout);
      const stage = el.querySelector(".game-table__felt") || el.querySelector(".game-page__table");
      if (stage) {
        const feltW = Math.max(120, stage.clientWidth || 0);
        const feltH = Math.max(120, stage.clientHeight || 0);
        el.style.setProperty("--felt-width", `${feltW.toFixed(0)}px`);
        el.style.setProperty("--felt-height", `${feltH.toFixed(0)}px`);
      }
      el.dataset.layoutDensity = gameplayDensityClass(layout);
      el.dataset.ruleset = rulesetId;
      el.dataset.orientation = layout.orientation || "";
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const stage = el.querySelector(".game-table__felt") || el.querySelector(".game-page__table");
    if (stage) ro.observe(stage);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, [playerCount, rulesetId]);

  return pageRef;
}

function errorMessageKey(error) {
  return adminErrorI18nKey(error);
}

function playerLabel(player) {
  return player?.displayName || player?.username || "";
}

function AdminSpectatorView({ matchId, seed = null, onClose }) {
  const { t, formatNumber } = useI18n();
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState("");
  const snapshot = view || seed;
  const rulesetId = snapshot?.rulesetId || "";
  const pageRef = useGameplayLayout({ playerCount: 2, rulesetId });
  const ended = isAdminSpectatorEnded(view?.adminStatus || seed?.adminStatus);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;

    const load = async () => {
      try {
        const next = stampDeadlineReceipt(await fetchAdminLiveMatchView(matchId));
        if (cancelled) return;
        setView((prev) => (shouldApplySpectatorSnapshot(prev, next) ? next : prev));
        setLoadError("");
      } catch (error) {
        if (!cancelled) setLoadError(errorMessageKey(error));
      }
    };

    void load();
    if (ended) {
      return () => {
        cancelled = true;
      };
    }
    const handle = window.setInterval(() => {
      void load();
    }, ADMIN_SPECTATOR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [matchId, ended]);

  const nameA = playerLabel(snapshot?.playerA) || t("game.playerN", { n: 1 });
  const nameB = playerLabel(snapshot?.playerB) || t("game.playerN", { n: 2 });
  const ruleset = tryResolveRuleset(rulesetId);
  const style = gameStyleForRulesetId(rulesetId);
  const hudScoreFormat = ruleset?.hudScoreFormat ?? "absolute";
  const targetScore = ruleset?.targetScore ?? 100;
  const americanHud = rulesetId === "american";
  const seatOfTarget = hudScoreFormat === "ofTarget" && !americanHud;
  const scores = [snapshot?.scoreA ?? 0, snapshot?.scoreB ?? 0];
  const currentSeat = snapshot?.currentSeat;
  const turnA = currentSeat === 0 && snapshot?.phase === "playing";
  const turnB = currentSeat === 1 && snapshot?.phase === "playing";
  const handA = Math.max(0, Number(snapshot?.handCountA) || 0);
  const handB = Math.max(0, Number(snapshot?.handCountB) || 0);
  const boardTiles = view?.board ?? [];
  const spinner = view?.spinner || { id: null, north: [], south: [] };
  const statusKey = liveMatchStatusKey(snapshot?.adminStatus);
  const [remainingMs, setRemainingMs] = useState(null);
  useEffect(() => {
    if (ended || snapshot?.phase !== "playing" || !snapshot?.turnDeadlineAt) {
      setRemainingMs(null);
      return undefined;
    }
    const tick = () => setRemainingMs(remainingTurnMs(snapshot));
    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [ended, snapshot]);

  const timerSeconds = formatTurnSeconds(remainingMs);
  const timerTone = turnTimerTone(remainingMs);
  const tableStatus = ended
    ? t("admin.spectatorEnded")
    : !view || snapshot?.adminStatus === "waiting"
      ? t("admin.waitingForTable")
      : turnA || turnB
        ? timerSeconds == null
          ? t("admin.whoseTurn", { name: currentSeat === 0 ? nameA : nameB })
          : timerTone === "pending"
            ? t("online.timeoutPending")
            : `${t("admin.whoseTurn", { name: currentSeat === 0 ? nameA : nameB })} · ${timerSeconds}`
        : t(statusKey);

  const winnerName = useMemo(() => {
    if (snapshot?.matchWinnerSeat === 0) return nameA;
    if (snapshot?.matchWinnerSeat === 1) return nameB;
    return "";
  }, [snapshot?.matchWinnerSeat, nameA, nameB]);

  return (
    <div
      className="admin-spectator"
      data-admin-spectator="true"
      data-admin-spectator-readonly="true"
      aria-label={t("admin.spectatorAria")}
    >
      <header className="admin-spectator__bar">
        <button
          type="button"
          className="admin-page__back"
          data-admin-spectator-close="true"
          onClick={() => onClose?.()}
        >
          <span className="admin-page__back-chevron" aria-hidden="true" />
          <span>{t("admin.closeSpectator")}</span>
        </button>
        <p
          className={`admin-page__pill ${ended ? "" : snapshot?.adminStatus === "live" ? "is-live" : ""}`}
          data-admin-spectator-status={snapshot?.adminStatus || ""}
        >
          {ended ? t("admin.spectatorEnded") : t(statusKey)}
        </p>
        <p className="admin-spectator__hint">{t("admin.spectatorReadonly")}</p>
      </header>

      {ended ? (
        <p className="admin-spectator__ended" data-admin-spectator-ended="true" role="status">
          {winnerName ? t("admin.spectatorWinner", { name: winnerName }) : t("admin.spectatorEnded")}
        </p>
      ) : null}

      {loadError ? (
        <p className="admin-page__error" role="alert">
          {t(loadError)}
        </p>
      ) : null}

      <div
        ref={pageRef}
        className={`game-page game-page--v1 game-page--players-2${ended ? " game-page--match-over" : ""}`}
        data-admin-spectator-table="true"
        data-online-table="true"
        data-online-match-id={matchId}
        data-online-ruleset={rulesetId}
        data-online-version={view?.version ?? ""}
      >
        <div className="game-page__shell">
          <div className="game-page__chrome">
            <div className="admin-spectator__hud">
              <div className="game-page__hud-cluster game-page__hud-cluster--human" data-hud-zone="human">
                <div className="game-page__seat-avatar" aria-label={nameA}>
                  <PlayerAvatar avatarId={snapshot?.playerA?.avatarId} size="lg" alt="" />
                </div>
                <div className="game-page__hud-id">
                  <span className="game-page__hud-name">{nameA}</span>
                  <span className="admin-spectator__rp">
                    {t("admin.rp")} {formatNumber(snapshot?.playerA?.rp ?? 1000)}
                  </span>
                  <SeatScore
                    value={scores[0]}
                    name={nameA}
                    ofTarget={seatOfTarget}
                    target={targetScore}
                  />
                </div>
              </div>
              <div className="game-page__hud-match" data-hud-zone="match-points">
                <ScoreBoard
                  scores={scores}
                  names={[nameA, nameB]}
                  humanIndex={0}
                  target={targetScore}
                  round={snapshot?.round ?? 1}
                  hideSeatNames
                  metaOnly
                  hideRound={americanHud}
                  scoreFormat={hudScoreFormat}
                />
                <div className="game-page__hud-match-tags">
                  {style ? (
                    <p className="game-page__hud-tag">{t(style.nameKey)}</p>
                  ) : null}
                  <p className="game-page__hud-tag">
                    {snapshot?.rated ? t("admin.rated") : t("admin.unrated")}
                  </p>
                  {snapshot?.reserveCount != null ? (
                    <p className="game-page__hud-tag" data-admin-spectator-boneyard="true">
                      {t("admin.boneyardRemaining", { count: formatNumber(snapshot.reserveCount) })}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="game-page__hud-cluster game-page__hud-cluster--rival" data-hud-zone="rival">
                <div className="game-page__hud-id game-page__hud-id--end">
                  <span className="game-page__hud-name">{nameB}</span>
                  <span className="admin-spectator__rp">
                    {t("admin.rp")} {formatNumber(snapshot?.playerB?.rp ?? 1000)}
                  </span>
                  <SeatScore
                    value={scores[1]}
                    name={nameB}
                    ofTarget={seatOfTarget}
                    target={targetScore}
                  />
                </div>
                <div className="game-page__seat-avatar" aria-label={nameB}>
                  <PlayerAvatar avatarId={snapshot?.playerB?.avatarId} size="lg" alt="" />
                </div>
              </div>
            </div>
          </div>

          <div className="game-page__opponent-rail" data-admin-spectator-hand-b="true">
            <OpponentPanel
              name={nameB}
              status={turnB ? t("game.thinking") : t("game.waiting")}
              tileCount={handB}
              thinking={turnB}
              isTurn={turnB}
              position="top"
              seatIndex={1}
              avatarTone="rival"
              tilesOnly
              tileSize="md"
            />
          </div>

          <div className="game-page__table" data-admin-spectator-board="true">
            <GameTable
              tiles={boardTiles}
              centerTileId={spinner.id}
              spinnerId={spinner.id}
              spinnerNorth={spinner.north ?? []}
              spinnerSouth={spinner.south ?? []}
              playScore={view?.lastPlayPoints > 0 && !ended ? view.lastPlayPoints : null}
              scoreHighlights={view?.lastPlayScoreTerminals ?? []}
              playerNames={[nameA, nameB]}
              status={tableStatus}
              statusActive={Boolean(turnA || turnB) && !ended}
              statusTone={!ended && (turnA || turnB) ? timerTone : ""}
              rulesetId={rulesetId}
              dock={
                <div className="game-page__dock" data-admin-spectator-hand-a="true">
                  <OpponentPanel
                    name={nameA}
                    status={turnA ? t("game.thinking") : t("game.waiting")}
                    tileCount={handA}
                    thinking={turnA}
                    isTurn={turnA}
                    position="top"
                    seatIndex={0}
                    avatarTone="rival"
                    tilesOnly
                    tileSize="md"
                  />
                </div>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminSpectatorView;
