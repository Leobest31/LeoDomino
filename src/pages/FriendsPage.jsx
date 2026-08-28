import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome } from "../components/Icon";
import PlayerAvatar from "../components/PlayerAvatar";
import FriendButton from "../components/FriendButton";
import { countryFlag, countryName } from "../auth/countries.js";
import { canSearchPlayers, FRIEND_RELATIONS, FRIEND_STATUSES } from "../online/friends.js";
import { useFriendsBoard } from "../hooks/useFriends.js";
import { useFriendMatchInvites } from "../hooks/useFriendMatchInvites.js";
import "./FriendsPage.css";

function PersonRow({ person, status, relation, actions }) {
  const { t, locale } = useI18n();
  const flag = countryFlag(person?.countryCode);
  const country = countryName(person?.countryCode, locale);
  const isFriend = relation === FRIEND_RELATIONS.friends || relation === "friends";
  return (
    <li className="friends__row" data-friend-id={person?.playerId}>
      <PlayerAvatar avatarId={person?.avatarId} size="sm" alt="" />
      <div className="friends__who">
        <p className="friends__name">{person?.displayName}</p>
        {person?.username ? (
          <p className="friends__handle" data-friend-username={person.username}>
            {`@${person.username}`}
          </p>
        ) : null}
        {flag || country ? (
          <p className="friends__meta" data-friend-country={person?.countryCode || ""}>
            {flag ? <span aria-hidden="true">{flag}</span> : null}
            {country ? <span>{country}</span> : null}
          </p>
        ) : null}
        {isFriend || status ? (
          <div className="friends__who-status">
            {isFriend ? (
              <span className="friends__rel" data-friend-relation="friends">
                {t("friends.friends")}
              </span>
            ) : null}
            {status ? <StatusChip status={status} /> : null}
          </div>
        ) : null}
      </div>
      <div className="friends__actions">{actions}</div>
    </li>
  );
}

function StatusChip({ status }) {
  const { t } = useI18n();
  const label =
    status === FRIEND_STATUSES.inMatch
      ? t("friends.statusInMatch")
      : status === FRIEND_STATUSES.online
        ? t("friends.statusOnline")
        : t("friends.statusOffline");
  return (
    <span className={`friends__status friends__status--${status}`} data-friend-status={status}>
      <span className="friends__status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function FriendsPage({
  onBack,
  onMainMenu,
  onPlayWithFriend,
  onEnterMatch,
  onOpenChat,
  noticeKey,
  onNoticeConsumed,
}) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const friends = useFriendsBoard();
  const invites = useFriendMatchInvites({ onEnterMatch });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!noticeKey) return;
    setNotice(t(noticeKey));
    onNoticeConsumed?.();
  }, [noticeKey, onNoticeConsumed, t]);

  const searchPlayersByName = friends.search;

  useEffect(() => {
    if (!canSearchPlayers(query)) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchPlayersByName(query)
        .then((rows) => {
          if (!cancelled) {
            setSearchFailed(false);
            setResults(rows);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchFailed(true);
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchPlayersByName]);

  const playFriend = (person) => {
    tap(() => {
      if (!person?.playerId) return;
      if (friends.statusFor(person.playerId) === FRIEND_STATUSES.inMatch) {
        setNotice(t("findMatch.alreadyInMatch"));
        return;
      }
      if (invites.pendingFor(person.playerId)) {
        setNotice(t("friends.inviteAlreadyOpen"));
        return;
      }
      onPlayWithFriend?.(person);
    });
  };

  const confirmRemove = (person) => {
    tap(() => {
      if (!person?.playerId) return;
      setRemoveTarget(person);
    });
  };

  const board = friends.board;
  const screen = friends.state;

  return (
    <main className="friends" data-friends="true" aria-label={t("friends.screenAria")}>
      <div className="friends__atmosphere" aria-hidden="true">
        <div className="friends__wood" />
        <div className="friends__vignette" />
      </div>
      <div className="friends__shell">
        <header className="friends__header">
          <button type="button" className="friends__back" onClick={() => tap(onBack)} aria-label={t("common.back")}>
            <span className="friends__back-chevron" aria-hidden="true" />
            <span>{t("common.back")}</span>
          </button>
          <h1 className="friends__title">{t("home.playFriend")}</h1>
          <button type="button" className="friends__menu" onClick={() => tap(onMainMenu)} aria-label={t("common.mainMenu")}>
            <IconHome />
            <span>{t("common.mainMenu")}</span>
          </button>
        </header>

        {screen === "unavailable" ? (
          <p className="friends__note">{t("friends.unavailable")}</p>
        ) : (
          <>
            <label className="friends__search">
              <span>{t("friends.searchLabel")}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("friends.searchPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                data-friends-search="true"
              />
            </label>
            {query.trim().length > 0 && query.trim().length < 2 ? (
              <p className="friends__hint">{t("friends.searchHint")}</p>
            ) : null}
            {searching ? <p className="friends__hint">{t("friends.loading")}</p> : null}
            {canSearchPlayers(query) && !searching && searchFailed ? (
              <p className="friends__hint">{t("friends.error")}</p>
            ) : null}
            {canSearchPlayers(query) && !searching && !searchFailed && results.length === 0 ? (
              <p className="friends__hint">{t("friends.emptySearch")}</p>
            ) : null}
            {results.length > 0 ? (
              <ul className="friends__list" data-friends-search-results="true">
                {results.map((person) => {
                  const relation = friends.relationFor(person.playerId);
                  return (
                    <PersonRow
                      key={person.playerId}
                      person={person}
                      relation={relation}
                      actions={
                        <FriendButton
                          relation={relation}
                          busy={Boolean(friends.busy)}
                          onAdd={() => friends.sendTo(person.playerId)}
                          onAccept={() => friends.accept(friends.incomingRequestId(person.playerId))}
                          onDecline={() => friends.decline(friends.incomingRequestId(person.playerId))}
                          onCancel={() => friends.cancel(friends.outgoingRequestId(person.playerId))}
                          onRemove={() => confirmRemove(person)}
                        />
                      }
                    />
                  );
                })}
              </ul>
            ) : null}

            {friends.errorKey ? (
              <p className="friends__error" role="alert">
                {t(friends.errorKey)}
              </p>
            ) : null}
            {invites.errorKey ? (
              <p className="friends__error" role="alert" data-friend-invite-error="true">
                {t(invites.errorKey)}
              </p>
            ) : null}

            <section className="friends__panel" aria-label={t("friends.matchInvites")}>
              <h2>{t("friends.matchInvites")}</h2>
              {invites.incoming.length === 0 ? (
                <p className="friends__hint">{t("friends.emptyMatchInvites")}</p>
              ) : (
                <ul className="friends__list" data-friend-match-invites="true">
                  {invites.incoming.map((row) => (
                    <PersonRow
                      key={row.id}
                      person={row.creator}
                      actions={
                        <>
                          <p className="friends__invite-copy">
                            {t("friends.wantsToPlay", {
                              name: row.creator?.displayName || t("findMatch.host"),
                            })}
                          </p>
                          <button
                            type="button"
                            className="friend-btn friend-btn--add"
                            data-friend-invite-accept="true"
                            disabled={Boolean(invites.busy)}
                            onClick={() => tap(() => invites.accept(row))}
                          >
                            {t("friends.accept")}
                          </button>
                          <button
                            type="button"
                            className="friend-btn friend-btn--state"
                            data-friend-invite-decline="true"
                            disabled={Boolean(invites.busy)}
                            onClick={() => tap(() => invites.decline(row.id))}
                          >
                            {t("friends.decline")}
                          </button>
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="friends__panel" aria-label={t("friends.requests")}>
              <h2>{t("friends.incoming")}</h2>
              {board.incoming.length === 0 ? (
                <p className="friends__hint">{t("friends.emptyIncoming")}</p>
              ) : (
                <ul className="friends__list" data-friends-incoming="true">
                  {board.incoming.map((row) => (
                    <PersonRow
                      key={row.id}
                      person={row.sender}
                      actions={
                        <FriendButton
                          relation="incoming"
                          busy={Boolean(friends.busy)}
                          onAccept={() => friends.accept(row.id)}
                          onDecline={() => friends.decline(row.id)}
                        />
                      }
                    />
                  ))}
                </ul>
              )}
              <h2>{t("friends.outgoing")}</h2>
              {board.outgoing.length === 0 ? (
                <p className="friends__hint">{t("friends.emptyOutgoing")}</p>
              ) : (
                <ul className="friends__list" data-friends-outgoing="true">
                  {board.outgoing.map((row) => (
                    <PersonRow
                      key={row.id}
                      person={row.receiver}
                      actions={
                        <FriendButton
                          relation="outgoing"
                          busy={Boolean(friends.busy)}
                          onCancel={() => friends.cancel(row.id)}
                        />
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="friends__panel" aria-label={t("friends.title")}>
              <h2>{t("friends.title")}</h2>
              {screen === "loading" ? <p className="friends__hint">{t("friends.loading")}</p> : null}
              {screen === "ready" && board.friends.length === 0 ? (
                <p className="friends__hint">{t("friends.emptyFriends")}</p>
              ) : (
                <ul className="friends__list" data-friends-list="true">
                  {board.friends.map((person) => (
                    <PersonRow
                      key={person.playerId}
                      person={person}
                      status={friends.statusFor(person.playerId)}
                      relation="friends"
                      actions={
                        <>
                          <FriendButton
                            relation="friends"
                            busy={Boolean(friends.busy)}
                            onRemove={() => confirmRemove(person)}
                          />
                          <button
                            type="button"
                            className="friend-btn friend-btn--ghost"
                            data-friends-message="true"
                            onClick={() =>
                              tap(() =>
                                onOpenChat?.({
                                  friendId: person.playerId,
                                  isFriend: true,
                                  person,
                                })
                              )
                            }
                          >
                            {t("friends.message")}
                          </button>
                          <button
                            type="button"
                            className="friend-btn friend-btn--add"
                            data-friends-play="true"
                            disabled={
                              friends.statusFor(person.playerId) === FRIEND_STATUSES.inMatch ||
                              Boolean(invites.pendingFor(person.playerId)) ||
                              Boolean(invites.busy)
                            }
                            onClick={() => playFriend(person)}
                          >
                            {invites.pendingFor(person.playerId)
                              ? t("friends.invitePending")
                              : t("friends.play")}
                          </button>
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {notice ? (
        <p className="friends__toast" role="status">
          {notice}
        </p>
      ) : null}
      {removeTarget ? (
        <div className="friends__confirm" role="dialog" aria-modal="true" data-friends-remove-confirm="true">
          <div className="friends__confirm-card">
            <p>
              {t("friends.removeConfirm", {
                name: removeTarget.displayName || removeTarget.username || t("friends.title"),
              })}
            </p>
            <div className="friends__confirm-actions">
              <button
                type="button"
                className="friend-btn friend-btn--ghost"
                data-friends-remove-cancel="true"
                onClick={() => tap(() => setRemoveTarget(null))}
              >
                {t("friends.cancel")}
              </button>
              <button
                type="button"
                className="friend-btn friend-btn--remove"
                data-friends-remove-confirm-action="true"
                disabled={Boolean(friends.busy)}
                onClick={() =>
                  tap(() => {
                    const id = removeTarget.playerId;
                    setRemoveTarget(null);
                    friends.removeFriend(id);
                  })
                }
              >
                {t("friends.removeConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default FriendsPage;
