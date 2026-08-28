import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconClose } from "./Icon";
import PlayerAvatar from "./PlayerAvatar";
import FriendButton from "./FriendButton";
import { formatInboxBadge, unreadConversations } from "../online/friendChat.js";
import "./NotificationsPanel.css";

function NotificationsPanel({
  open,
  onClose,
  friends,
  invites,
  conversations = [],
  onOpenChat,
  onOpenFriends,
}) {
  const { t } = useI18n();
  const { play } = useAudio();
  if (!open) return null;

  const tap = (fn) => {
    play("button");
    fn?.();
  };

  const incoming = friends?.board?.incoming || [];
  const matchInvites = invites?.incoming || [];
  const chats = unreadConversations(conversations);
  const empty = incoming.length === 0 && matchInvites.length === 0 && chats.length === 0;

  return (
    <div className="inbox-panel" role="dialog" aria-modal="true" aria-label={t("inbox.title")} data-inbox="true">
      <button type="button" className="inbox-panel__backdrop" aria-label={t("common.close")} onClick={onClose} />
      <section className="inbox-panel__sheet">
        <header className="inbox-panel__header">
          <h2>{t("inbox.title")}</h2>
          <button type="button" className="inbox-panel__close" onClick={onClose} aria-label={t("common.close")}>
            <IconClose />
          </button>
        </header>

        {friends?.errorKey || invites?.errorKey ? (
          <p className="inbox-panel__error" role="alert">
            {t(friends?.errorKey || invites?.errorKey || "inbox.error")}
          </p>
        ) : null}

        {empty ? <p className="inbox-panel__empty">{t("inbox.empty")}</p> : null}

        {incoming.length > 0 ? (
          <section className="inbox-panel__section" aria-label={t("inbox.friendRequest")}>
            <h3>{t("inbox.friendRequest")}</h3>
            <ul className="inbox-panel__list">
              {incoming.map((row) => (
                <li key={row.id} className="inbox-panel__row" data-inbox-friend-request={row.id}>
                  <PlayerAvatar avatarId={row.sender?.avatarId} size="sm" alt="" />
                  <div className="inbox-panel__copy">
                    <p className="inbox-panel__name">{row.sender?.displayName}</p>
                    <p className="inbox-panel__body">
                      {t("inbox.friendRequestBody", { name: row.sender?.displayName || "" })}
                    </p>
                  </div>
                  <FriendButton
                    relation="incoming"
                    busy={Boolean(friends.busy)}
                    onAccept={() => tap(() => friends.accept(row.id))}
                    onDecline={() => tap(() => friends.decline(row.id))}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {matchInvites.length > 0 ? (
          <section className="inbox-panel__section" aria-label={t("inbox.matchInvite")}>
            <h3>{t("inbox.matchInvite")}</h3>
            <ul className="inbox-panel__list">
              {matchInvites.map((row) => (
                <li key={row.id} className="inbox-panel__row" data-inbox-match-invite={row.id}>
                  <PlayerAvatar avatarId={row.creator?.avatarId} size="sm" alt="" />
                  <div className="inbox-panel__copy">
                    <p className="inbox-panel__name">{row.creator?.displayName}</p>
                    <p className="inbox-panel__body">
                      {t("inbox.matchInviteBody", {
                        name: row.creator?.displayName || t("findMatch.host"),
                      })}
                    </p>
                  </div>
                  <span className="inbox-panel__actions">
                    <button
                      type="button"
                      className="friend-btn friend-btn--accept"
                      data-inbox-invite-accept="true"
                      disabled={Boolean(invites.busy)}
                      onClick={() => tap(() => invites.accept(row))}
                    >
                      {t("friends.accept")}
                    </button>
                    <button
                      type="button"
                      className="friend-btn friend-btn--ghost"
                      data-inbox-invite-decline="true"
                      disabled={Boolean(invites.busy)}
                      onClick={() => tap(() => invites.decline(row.id))}
                    >
                      {t("friends.decline")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {chats.length > 0 ? (
          <section className="inbox-panel__section" aria-label={t("inbox.unreadChat")}>
            <h3>{t("inbox.unreadChat")}</h3>
            <ul className="inbox-panel__list">
              {chats.map((row) => (
                <li key={row.conversationId} className="inbox-panel__row">
                  <button
                    type="button"
                    className="inbox-panel__open"
                    data-inbox-chat={row.conversationId}
                    onClick={() =>
                      tap(() => {
                        onOpenChat?.({
                          conversationId: row.conversationId,
                          friendId: row.otherPlayerId,
                          isFriend: row.isFriend,
                          person: {
                            playerId: row.otherPlayerId,
                            displayName: row.displayName,
                            avatarId: row.avatarId,
                            countryCode: row.countryCode,
                          },
                        });
                        onClose?.();
                      })
                    }
                  >
                    <PlayerAvatar avatarId={row.avatarId} size="sm" alt="" />
                    <span className="inbox-panel__copy">
                      <span className="inbox-panel__name">{row.displayName}</span>
                      <span className="inbox-panel__body">
                        {row.lastMessagePreview
                          ? t("inbox.unreadChatBody", {
                              name: row.displayName,
                              preview: row.lastMessagePreview,
                            })
                          : t("inbox.unreadChatCount", { count: row.unreadCount })}
                      </span>
                    </span>
                    <span className="inbox-panel__badge">{formatInboxBadge(row.unreadCount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {onOpenFriends ? (
          <button
            type="button"
            className="inbox-panel__friends"
            data-inbox-open-friends="true"
            onClick={() =>
              tap(() => {
                onOpenFriends();
                onClose?.();
              })
            }
          >
            {t("inbox.openFriends")}
          </button>
        ) : null}
      </section>
    </div>
  );
}

export default NotificationsPanel;
