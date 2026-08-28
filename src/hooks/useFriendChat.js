/**
 * Live Chat conversations + thread. Realtime INSERT on friend_messages.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import { subscribeFriendships } from "../online/friends.js";
import {
  chatErrorKey,
  conversationForFriend,
  getMyUnreadMessageCount,
  listFriendMessages,
  listMyFriendConversations,
  markFriendConversationRead,
  sendFriendMessage,
  subscribeFriendMessages,
  validateMessageBody,
} from "../online/friendChat.js";

const EMPTY_THREAD = Object.freeze({
  conversationId: "",
  friendId: "",
  person: null,
  isFriend: false,
  messages: [],
  hasMore: false,
  loading: false,
});

function mergeMessages(current, incoming) {
  const byId = new Map();
  for (const row of current || []) {
    if (row?.id) byId.set(row.id, row);
  }
  for (const row of incoming || []) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => {
    const at = String(a.createdAt || "");
    const bt = String(b.createdAt || "");
    if (at === bt) return String(a.id).localeCompare(String(b.id));
    return at < bt ? -1 : 1;
  });
}

export function useFriendChat() {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const onlineReady = isCloudAuth() && Boolean(playerId);
  const [conversations, setConversations] = useState([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [state, setState] = useState(onlineReady ? "loading" : "unavailable");
  const [errorKey, setErrorKey] = useState("");
  const [busy, setBusy] = useState("");
  const [thread, setThread] = useState(EMPTY_THREAD);
  const threadRef = useRef(EMPTY_THREAD);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  const refresh = useCallback(async () => {
    if (!onlineReady) {
      setConversations([]);
      setUnreadTotal(0);
      setState("unavailable");
      return [];
    }
    try {
      const [rows, unread] = await Promise.all([
        listMyFriendConversations(),
        getMyUnreadMessageCount(),
      ]);
      setConversations(rows);
      setUnreadTotal(unread);
      setErrorKey("");
      setState("ready");
      return rows;
    } catch {
      setErrorKey("chat.error");
      setState("error");
      return [];
    }
  }, [onlineReady]);

  useEffect(() => {
    const friendId = thread.friendId;
    if (!friendId) return;
    const conv = conversationForFriend(conversations, friendId);
    if (!conv) return;
    const next = conv.isFriend === true;
    if (thread.isFriend === next) return;
    setThread((prev) =>
      prev.friendId === friendId ? { ...prev, isFriend: next } : prev
    );
  }, [conversations, thread.friendId, thread.isFriend]);

  useEffect(() => {
    refresh();
    if (!onlineReady) return undefined;
    const stops = [];
    try {
      stops.push(
        subscribeFriendships(() => {
          void refresh();
        })
      );
    } catch {
      /* optional realtime */
    }
    try {
      const stop = subscribeFriendMessages((payload) => {
        const incoming = payload?.new;
        const current = threadRef.current;
        if (
          incoming?.id &&
          current.conversationId &&
          (incoming.conversation_id || incoming.conversationId) === current.conversationId
        ) {
          const next = {
            id: incoming.id,
            conversationId: incoming.conversation_id || incoming.conversationId || current.conversationId,
            senderId: incoming.sender_id || incoming.senderId || "",
            body: typeof incoming.body === "string" ? incoming.body : "",
            createdAt: incoming.created_at || incoming.createdAt || null,
          };
          setThread((prev) => ({
            ...prev,
            messages: mergeMessages(prev.messages, [next]),
          }));
          if (next.senderId && next.senderId !== playerId) {
            markFriendConversationRead(current.conversationId).catch(() => {});
          }
        }
        void refresh();
      });
      stops.push(stop);
    } catch {
      /* optional realtime */
    }
    return () => {
      for (const stop of stops) stop?.();
    };
  }, [onlineReady, playerId, refresh]);

  const closeThread = useCallback(() => {
    setThread(EMPTY_THREAD);
    setBusy("");
  }, []);

  const openThread = useCallback(
    async (target = {}) => {
      if (!onlineReady) return;
      const friendId = target.friendId || target.otherPlayerId || "";
      const wantedId = target.conversationId || "";
      setBusy("open");
      setErrorKey("");
      setThread((prev) => ({
        ...EMPTY_THREAD,
        conversationId: wantedId || prev.conversationId,
        friendId: friendId || prev.friendId,
        person: target.person || prev.person,
        isFriend: target.isFriend === true || target.person?.isFriend === true,
        loading: true,
      }));
      try {
        const rows = await refresh();
        const conv =
          rows.find((row) => wantedId && row.conversationId === wantedId) ||
          conversationForFriend(rows, friendId) ||
          null;
        const conversationId = conv?.conversationId || wantedId || "";
        let messages = [];
        let hasMore = false;
        if (conversationId) {
          const page = await listFriendMessages(conversationId);
          messages = mergeMessages([], page);
          hasMore = page.length >= 50;
          await markFriendConversationRead(conversationId);
          await refresh();
        }
        const person = conv
          ? {
              playerId: conv.otherPlayerId,
              displayName: conv.displayName,
              avatarId: conv.avatarId,
              countryCode: conv.countryCode,
            }
          : target.person || null;
        setThread({
          conversationId,
          friendId: conv?.otherPlayerId || friendId,
          person,
          isFriend: conv ? conv.isFriend === true : target.isFriend === true,
          messages,
          hasMore,
          loading: false,
        });
      } catch {
        setErrorKey("chat.error");
        setThread((prev) => ({ ...prev, loading: false }));
      } finally {
        setBusy("");
      }
    },
    [onlineReady, refresh]
  );

  const loadOlder = useCallback(async () => {
    const current = threadRef.current;
    if (!current.conversationId || !current.messages.length || busy) return;
    const oldest = current.messages[0];
    setBusy("older");
    try {
      const page = await listFriendMessages(current.conversationId, {
        beforeCreatedAt: oldest.createdAt,
        beforeId: oldest.id,
      });
      setThread((prev) => ({
        ...prev,
        messages: mergeMessages(page, prev.messages),
        hasMore: page.length >= 50,
      }));
    } catch {
      setErrorKey("chat.error");
    } finally {
      setBusy("");
    }
  }, [busy]);

  const send = useCallback(
    async (rawBody) => {
      const current = threadRef.current;
      const friendId = current.friendId;
      if (!friendId || busy) return false;
      if (!current.isFriend) {
        setErrorKey("chat.notFriends");
        return false;
      }
      const invalid = validateMessageBody(rawBody);
      if (invalid) {
        setErrorKey(chatErrorKey({ code: invalid }));
        return false;
      }
      setBusy("send");
      setErrorKey("");
      try {
        const saved = await sendFriendMessage(friendId, rawBody);
        if (saved) {
          setThread((prev) => ({
            ...prev,
            conversationId: saved.conversationId || prev.conversationId,
            messages: mergeMessages(prev.messages, [saved]),
          }));
        }
        if (saved?.conversationId) {
          await markFriendConversationRead(saved.conversationId);
        }
        await refresh();
        return true;
      } catch (error) {
        setErrorKey(chatErrorKey(error));
        return false;
      } finally {
        setBusy("");
      }
    },
    [busy, refresh]
  );

  return useMemo(
    () => ({
      onlineReady,
      playerId,
      state,
      errorKey,
      busy,
      conversations,
      unreadTotal,
      thread,
      refresh,
      openThread,
      closeThread,
      loadOlder,
      send,
    }),
    [
      onlineReady,
      playerId,
      state,
      errorKey,
      busy,
      conversations,
      unreadTotal,
      thread,
      refresh,
      openThread,
      closeThread,
      loadOlder,
      send,
    ]
  );
}
