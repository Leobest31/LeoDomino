/**
 * Friends-only Live Chat client — existing send/list/read RPCs.
 * Messages are text-only. Links/files are rejected; the database is authority.
 */
import { getSupabaseClient } from "./supabaseClient.js";

export const FRIEND_MESSAGE_MAX = 1000;
export const FRIEND_MESSAGE_PAGE = 50;

export class FriendChatError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "FriendChatError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function asRows(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

export function inboxBadgeCount({
  incomingFriendRequests = 0,
  incomingMatchInvites = 0,
  unreadMessageCount = 0,
} = {}) {
  return (
    Math.max(0, Number(incomingFriendRequests) || 0) +
    Math.max(0, Number(incomingMatchInvites) || 0) +
    Math.max(0, Number(unreadMessageCount) || 0)
  );
}

export function formatInboxBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return "";
  if (n > 99) return "99+";
  return String(n);
}

export function trimMessageBody(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function messageContainsLink(value) {
  const body = String(value || "");
  return (
    /https?:\/\//i.test(body) ||
    /www\./i.test(body) ||
    /:\/\//.test(body) ||
    /(^|[^a-z0-9])[a-z0-9][a-z0-9-]*\.(com|net|org|io|app|gg|co)(\b|\/)/i.test(body)
  );
}

export function validateMessageBody(value) {
  const body = trimMessageBody(value);
  if (!body) return "EMPTY";
  if (body.length > FRIEND_MESSAGE_MAX) return "TOO_LONG";
  if (messageContainsLink(body)) return "LINKS";
  return "";
}

export function normalizeConversation(row) {
  if (!row) return null;
  const conversationId = row.conversation_id || row.conversationId || "";
  const otherPlayerId = row.other_player_id || row.otherPlayerId || "";
  if (!conversationId && !otherPlayerId) return null;
  const unread = Number(row.unread_count ?? row.unreadCount ?? 0);
  return {
    conversationId,
    otherPlayerId,
    displayName:
      typeof row.display_name === "string" && row.display_name
        ? row.display_name
        : typeof row.displayName === "string" && row.displayName
          ? row.displayName
          : "Player",
    avatarId:
      typeof row.avatar_id === "string" && row.avatar_id
        ? row.avatar_id
        : typeof row.avatarId === "string" && row.avatarId
          ? row.avatarId
          : "marcus",
    countryCode: typeof row.country_code === "string" ? row.country_code : row.countryCode || "",
    lastMessagePreview:
      typeof row.last_message_preview === "string"
        ? row.last_message_preview
        : typeof row.lastMessagePreview === "string"
          ? row.lastMessagePreview
          : "",
    lastMessageAt: row.last_message_at || row.lastMessageAt || null,
    unreadCount: Number.isFinite(unread) ? Math.max(0, unread) : 0,
    isFriend: row.is_friend === true || row.isFriend === true,
  };
}

export function normalizeMessage(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id || row.conversationId || "",
    senderId: row.sender_id || row.senderId || "",
    body: typeof row.body === "string" ? row.body : "",
    createdAt: row.created_at || row.createdAt || null,
  };
}

export function unreadConversations(conversations) {
  return (conversations || []).filter((row) => row?.unreadCount > 0);
}

export function conversationForFriend(conversations, friendId) {
  if (!friendId) return null;
  return (conversations || []).find((row) => row.otherPlayerId === friendId) || null;
}

export function throwFromChatError(error, fallbackCode = "RPC") {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/authentication required/i.test(msg)) {
    throw new FriendChatError("AUTH", msg, error);
  }
  if (/not friends/i.test(msg)) {
    throw new FriendChatError("NOT_FRIENDS", msg, error);
  }
  if (/links are not allowed/i.test(msg)) {
    throw new FriendChatError("LINKS", msg, error);
  }
  if (/message is too long/i.test(msg)) {
    throw new FriendChatError("TOO_LONG", msg, error);
  }
  if (/message is empty/i.test(msg)) {
    throw new FriendChatError("EMPTY", msg, error);
  }
  if (/too many messages/i.test(msg)) {
    throw new FriendChatError("RATE", msg, error);
  }
  if (/repeated message/i.test(msg)) {
    throw new FriendChatError("REPEAT", msg, error);
  }
  if (/player not found|conversation not found|not a conversation participant/i.test(msg)) {
    throw new FriendChatError("NOT_FOUND", msg, error);
  }
  if (/cannot message yourself/i.test(msg)) {
    throw new FriendChatError("SELF", msg, error);
  }
  throw new FriendChatError(fallbackCode, msg || "request failed", error);
}

export function chatErrorKey(error) {
  switch (error?.code) {
    case "AUTH":
      return "chat.unavailable";
    case "NOT_FRIENDS":
      return "chat.notFriends";
    case "LINKS":
      return "chat.linksBlocked";
    case "TOO_LONG":
      return "chat.tooLong";
    case "EMPTY":
      return "chat.empty";
    case "RATE":
      return "chat.tooMany";
    case "REPEAT":
      return "chat.repeated";
    case "NOT_FOUND":
      return "chat.notFound";
    default:
      return "chat.sendError";
  }
}

export async function listMyFriendConversations(client) {
  const { data, error } = await clientOf(client).rpc("list_my_friend_conversations");
  if (error) throwFromChatError(error, "LIST_FAILED");
  return asRows(data).map(normalizeConversation).filter(Boolean);
}

export async function listFriendMessages(conversationId, options = {}, client) {
  if (!conversationId) return [];
  const args = { p_conversation_id: conversationId };
  if (options.beforeCreatedAt) args.p_before_created_at = options.beforeCreatedAt;
  if (options.beforeId) args.p_before_id = options.beforeId;
  if (options.limit) args.p_limit = options.limit;
  const { data, error } = await clientOf(client).rpc("list_friend_messages", args);
  if (error) throwFromChatError(error, "LIST_FAILED");
  return asRows(data).map(normalizeMessage).filter(Boolean);
}

export async function sendFriendMessage(friendId, body, client) {
  const code = validateMessageBody(body);
  if (code) throw new FriendChatError(code, code);
  if (!friendId) throw new FriendChatError("NOT_FOUND", "friend id required");
  const { data, error } = await clientOf(client).rpc("send_friend_message", {
    p_friend_id: friendId,
    p_body: trimMessageBody(body),
  });
  if (error) throwFromChatError(error, "SEND_FAILED");
  return normalizeMessage(data) || data;
}

export async function markFriendConversationRead(conversationId, client) {
  if (!conversationId) return;
  const { error } = await clientOf(client).rpc("mark_friend_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) throwFromChatError(error, "READ_FAILED");
}

export async function getMyUnreadMessageCount(client) {
  const { data, error } = await clientOf(client).rpc("get_my_unread_message_count");
  if (error) throwFromChatError(error, "LIST_FAILED");
  const n = Number(data);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function subscribeFriendMessages(onEvent, client) {
  const db = clientOf(client);
  const channel = db.channel("leo-friend-messages");
  channel
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "friend_messages" },
      (payload) => {
        onEvent?.(payload);
      }
    )
    .subscribe();
  return () => {
    db.removeChannel(channel);
  };
}
