import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { IconHome } from "../components/Icon";
import PlayerAvatar from "../components/PlayerAvatar";
import { countryFlag } from "../auth/countries.js";
import { FRIEND_MESSAGE_MAX } from "../online/friendChat.js";
import { useFriendChat } from "../hooks/useFriendChat.js";
import "./ChatPage.css";

function ConversationRow({ row, onOpen }) {
  const { t } = useI18n();
  const flag = countryFlag(row.countryCode);
  return (
    <li className="chat__row">
      <button
        type="button"
        className="chat__row-btn"
        data-chat-conversation={row.conversationId}
        onClick={() => onOpen(row)}
      >
        <PlayerAvatar avatarId={row.avatarId} size="sm" alt="" />
        <span className="chat__who">
          <span className="chat__name">
            {row.displayName}
            {flag ? (
              <span className="chat__flag" aria-hidden="true">
                {flag}
              </span>
            ) : null}
          </span>
          <span className="chat__preview">
            {row.lastMessagePreview || t("chat.previewEmpty")}
          </span>
        </span>
        {row.unreadCount > 0 ? (
          <span className="chat__unread" data-chat-unread="true">
            {t("chat.unread", { count: row.unreadCount })}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ChatPage({ onBack, onMainMenu, focus, onFocusConsumed }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const chat = useFriendChat();
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef(null);
  const thread = chat.thread;
  const inThread = Boolean(thread.friendId || thread.conversationId);
  const openThread = chat.openThread;

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  useEffect(() => {
    if (!focus) return;
    const target = focus;
    onFocusConsumed?.();
    void openThread(target);
  }, [focus, openThread, onFocusConsumed]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || !inThread) return;
    node.scrollTop = node.scrollHeight;
  }, [inThread, thread.messages.length, thread.conversationId]);

  const handleBack = () => {
    tap(() => {
      if (inThread) {
        setDraft("");
        chat.closeThread();
        return;
      }
      onBack?.();
    });
  };

  const openConversation = (row) => {
    tap(() => {
      setDraft("");
      void chat.openThread({
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
    });
  };

  const submit = (event) => {
    event.preventDefault();
    tap(() => {
      void chat.send(draft).then((ok) => {
        if (ok) setDraft("");
      });
    });
  };

  const title = inThread
    ? thread.person?.displayName || t("chat.title")
    : t("chat.title");
  const screen = chat.state;

  return (
    <main className="chat" data-chat="true" aria-label={t("chat.screenAria")}>
      <div className="chat__atmosphere" aria-hidden="true">
        <div className="chat__wood" />
        <div className="chat__vignette" />
      </div>
      <div className="chat__shell">
        <header className="chat__header">
          <button type="button" className="chat__back" onClick={handleBack} aria-label={t("common.back")}>
            <span className="chat__back-chevron" aria-hidden="true" />
            <span>{t("common.back")}</span>
          </button>
          <h1 className="chat__title">{title}</h1>
          <button type="button" className="chat__menu" onClick={() => tap(onMainMenu)} aria-label={t("common.mainMenu")}>
            <IconHome />
            <span>{t("common.mainMenu")}</span>
          </button>
        </header>

        {screen === "unavailable" ? (
          <p className="chat__note">{t("chat.unavailable")}</p>
        ) : inThread ? (
          <section className="chat__thread" data-chat-thread="true">
            {thread.hasMore ? (
              <button
                type="button"
                className="chat__older"
                disabled={Boolean(chat.busy)}
                onClick={() => tap(() => void chat.loadOlder())}
              >
                {t("chat.loadOlder")}
              </button>
            ) : null}
            <div className="chat__scroller" ref={scrollerRef}>
              {thread.loading ? <p className="chat__hint">{t("chat.loading")}</p> : null}
              {!thread.loading && thread.messages.length === 0 ? (
                <p className="chat__hint">{t("chat.emptyThread")}</p>
              ) : null}
              <ul className="chat__bubbles">
                {thread.messages.map((row) => {
                  const mine = row.senderId === chat.playerId;
                  return (
                    <li
                      key={row.id}
                      className={`chat__bubble${mine ? " chat__bubble--mine" : ""}`}
                      data-chat-message={row.id}
                    >
                      {row.body}
                    </li>
                  );
                })}
              </ul>
            </div>
            {thread.isFriend ? (
              <form className="chat__composer" onSubmit={submit} data-chat-composer="true">
                <label className="chat__composer-label">
                  <span className="visually-hidden">{t("chat.composerPlaceholder")}</span>
                  <textarea
                    value={draft}
                    maxLength={FRIEND_MESSAGE_MAX}
                    rows={2}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={t("chat.composerPlaceholder")}
                    data-chat-input="true"
                  />
                </label>
                <button
                  type="submit"
                  className="chat__send"
                  data-chat-send="true"
                  disabled={Boolean(chat.busy) || !draft.trim()}
                >
                  {t("chat.send")}
                </button>
              </form>
            ) : (
              <p className="chat__note">{t("chat.notFriends")}</p>
            )}
          </section>
        ) : (
          <section className="chat__list" data-chat-list="true">
            {screen === "loading" ? <p className="chat__hint">{t("chat.loading")}</p> : null}
            {screen === "ready" && chat.conversations.length === 0 ? (
              <p className="chat__hint">{t("chat.emptyConversations")}</p>
            ) : null}
            {chat.conversations.length > 0 ? (
              <ul className="chat__conversations">
                {chat.conversations.map((row) => (
                  <ConversationRow key={row.conversationId} row={row} onOpen={openConversation} />
                ))}
              </ul>
            ) : null}
          </section>
        )}

        {chat.errorKey ? (
          <p className="chat__error" role="alert">
            {t(chat.errorKey)}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default ChatPage;
