/**
 * Friends client — existing friend_requests / friendships RPCs.
 * Mutations go through send/cancel/respond. Presence never touches game state.
 */
import { getSupabaseClient } from "./supabaseClient.js";

export const PROFILE_PUBLIC_SELECT = "id, display_name, avatar_id, country_code";
export const FRIEND_REQUEST_SELECT =
  "id, sender_id, receiver_id, status, created_at, responded_at, sender:profiles!sender_id ( display_name, avatar_id, country_code ), receiver:profiles!receiver_id ( display_name, avatar_id, country_code )";

export const FRIEND_RELATIONS = Object.freeze({
  self: "self",
  none: "none",
  outgoing: "outgoing",
  incoming: "incoming",
  friends: "friends",
});

export const FRIEND_STATUSES = Object.freeze({
  online: "online",
  inMatch: "inMatch",
  offline: "offline",
});

export class FriendsError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = "FriendsError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function clientOf(client) {
  return client ?? getSupabaseClient();
}

function unwrapProfile(raw) {
  const profile = Array.isArray(raw) ? raw[0] : raw;
  return {
    displayName:
      typeof profile?.display_name === "string" && profile.display_name
        ? profile.display_name
        : "Player",
    avatarId:
      typeof profile?.avatar_id === "string" && profile.avatar_id
        ? profile.avatar_id
        : "marcus",
    countryCode: typeof profile?.country_code === "string" ? profile.country_code : "",
  };
}

export function normalizePublicProfile(row, playerId = row?.id) {
  if (!row && !playerId) return null;
  const profile = unwrapProfile(row);
  return {
    playerId: row?.id || playerId,
    displayName: profile.displayName,
    avatarId: profile.avatarId,
    countryCode: profile.countryCode,
  };
}

export function normalizeFriendRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? null,
    sender: normalizePublicProfile(row.sender, row.sender_id),
    receiver: normalizePublicProfile(row.receiver, row.receiver_id),
  };
}

export function otherFriendshipId(row, playerId) {
  if (!row || !playerId) return "";
  if (row.user_a === playerId) return row.user_b;
  if (row.user_b === playerId) return row.user_a;
  return "";
}

export function escapeIlike(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function canSearchPlayers(query) {
  return String(query || "").trim().length >= 2;
}

export function relationBetween(targetId, playerId, board = {}) {
  if (!targetId || !playerId) return FRIEND_RELATIONS.none;
  if (targetId === playerId) return FRIEND_RELATIONS.self;
  const friends = board.friends || [];
  if (friends.some((row) => row.playerId === targetId)) return FRIEND_RELATIONS.friends;
  const incoming = board.incoming || [];
  if (incoming.some((row) => row.senderId === targetId && row.status === "pending")) {
    return FRIEND_RELATIONS.incoming;
  }
  const outgoing = board.outgoing || [];
  if (outgoing.some((row) => row.receiverId === targetId && row.status === "pending")) {
    return FRIEND_RELATIONS.outgoing;
  }
  return FRIEND_RELATIONS.none;
}

export function friendStatus({ inMatch = false, online = false } = {}) {
  if (inMatch) return FRIEND_STATUSES.inMatch;
  if (online) return FRIEND_STATUSES.online;
  return FRIEND_STATUSES.offline;
}

export function throwFromFriendsError(error, fallbackCode = "RPC") {
  const msg = String(error?.message || error?.details || error?.hint || error?.code || "");
  if (/cannot send a friend request to yourself/i.test(msg)) {
    throw new FriendsError("SELF", msg, error);
  }
  if (/player not found/i.test(msg)) {
    throw new FriendsError("NOT_FOUND", msg, error);
  }
  if (/friendship already exists/i.test(msg)) {
    throw new FriendsError("ALREADY_FRIENDS", msg, error);
  }
  if (/duplicate key|unique constraint|one_pending_pair/i.test(msg)) {
    throw new FriendsError("ALREADY_PENDING", msg, error);
  }
  if (/only the receiver may respond/i.test(msg)) {
    throw new FriendsError("NOT_RECEIVER", msg, error);
  }
  if (/friend request is not pending/i.test(msg)) {
    throw new FriendsError("NOT_PENDING", msg, error);
  }
  if (/cannot cancel friend request/i.test(msg)) {
    throw new FriendsError("CANCEL_FAILED", msg, error);
  }
  if (/friend request not found/i.test(msg)) {
    throw new FriendsError("NOT_FOUND", msg, error);
  }
  if (/authentication required/i.test(msg)) {
    throw new FriendsError("AUTH", msg, error);
  }
  throw new FriendsError(fallbackCode, msg || "request failed", error);
}

export async function sendFriendRequest(receiverId, playerId, client) {
  if (playerId && receiverId && playerId === receiverId) {
    throw new FriendsError("SELF", "cannot send a friend request to yourself");
  }
  const { data, error } = await clientOf(client).rpc("send_friend_request", {
    p_receiver_id: receiverId,
  });
  if (error) throwFromFriendsError(error, "SEND_FAILED");
  return data;
}

export async function cancelFriendRequest(requestId, client) {
  const { error } = await clientOf(client).rpc("cancel_friend_request", {
    p_request_id: requestId,
  });
  if (error) throwFromFriendsError(error, "CANCEL_FAILED");
}

export async function respondToFriendRequest(requestId, action, client) {
  const { data, error } = await clientOf(client).rpc("respond_to_friend_request", {
    p_request_id: requestId,
    p_action: action,
  });
  if (error) throwFromFriendsError(error, "RESPOND_FAILED");
  return data;
}

export async function searchPlayers(query, playerId, client) {
  if (!playerId || !canSearchPlayers(query)) return [];
  const needle = escapeIlike(String(query).trim()).slice(0, 40);
  const { data, error } = await clientOf(client)
    .from("profiles")
    .select(PROFILE_PUBLIC_SELECT)
    .ilike("display_name", `%${needle}%`)
    .neq("id", playerId)
    .order("display_name", { ascending: true })
    .limit(12);
  if (error) throwFromFriendsError(error, "SEARCH_FAILED");
  return (data ?? []).map((row) => normalizePublicProfile(row)).filter(Boolean);
}

export async function listPendingFriendRequests(playerId, client) {
  if (!playerId) return { incoming: [], outgoing: [] };
  const { data, error } = await clientOf(client)
    .from("friend_requests")
    .select(FRIEND_REQUEST_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throwFromFriendsError(error, "LIST_FAILED");
  const rows = (data ?? []).map(normalizeFriendRequest).filter(Boolean);
  return {
    incoming: rows.filter((row) => row.receiverId === playerId),
    outgoing: rows.filter((row) => row.senderId === playerId),
  };
}

export async function listFriends(playerId, client) {
  if (!playerId) return [];
  const db = clientOf(client);
  const { data, error } = await db
    .from("friendships")
    .select("id, user_a, user_b, created_at")
    .or(`user_a.eq.${playerId},user_b.eq.${playerId}`)
    .order("created_at", { ascending: false });
  if (error) throwFromFriendsError(error, "LIST_FAILED");
  const ids = (data ?? []).map((row) => otherFriendshipId(row, playerId)).filter(Boolean);
  if (ids.length === 0) return [];
  const { data: profiles, error: profileError } = await db
    .from("profiles")
    .select(PROFILE_PUBLIC_SELECT)
    .in("id", ids);
  if (profileError) throwFromFriendsError(profileError, "LIST_FAILED");
  const byId = Object.fromEntries((profiles ?? []).map((row) => [row.id, normalizePublicProfile(row)]));
  return (data ?? [])
    .map((row) => {
      const player = byId[otherFriendshipId(row, playerId)];
      return player ? { ...player, friendshipId: row.id, since: row.created_at } : null;
    })
    .filter(Boolean);
}

export async function listFriendsInActiveMatch(client) {
  const db = clientOf(client);
  if (typeof db.rpc !== "function") return [];
  const { data, error } = await db.rpc("list_friends_in_active_match");
  if (error || !data) return [];
  return (Array.isArray(data) ? data : [])
    .map((row) => row?.player_id || row)
    .filter((id) => typeof id === "string" && id);
}

export async function loadFriendsBoard(playerId, client) {
  const [requests, friends, busyIds] = await Promise.all([
    listPendingFriendRequests(playerId, client),
    listFriends(playerId, client),
    listFriendsInActiveMatch(client),
  ]);
  return {
    friends,
    incoming: requests.incoming,
    outgoing: requests.outgoing,
    busyIds,
  };
}

export function subscribeFriendRequests(onEvent, client) {
  const db = clientOf(client);
  const channel = db.channel("leo-friend-requests");
  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "friend_requests" },
      (payload) => {
        onEvent?.(payload);
      }
    )
    .subscribe();
  return () => {
    db.removeChannel(channel);
  };
}

export function startOwnFriendsPresence(playerId, client) {
  if (!playerId) return () => {};
  const db = clientOf(client);
  const channel = db.channel(`leo-presence:${playerId}`, {
    config: { presence: { key: playerId } },
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channel.track({ at: Date.now() });
    }
  });
  return () => {
    db.removeChannel(channel);
  };
}

export function subscribeFriendsPresence(friendIds, onOnlineIds, client) {
  const db = clientOf(client);
  const ids = [...new Set((friendIds || []).filter(Boolean))];
  const online = new Set();
  const channels = ids.map((id) => {
    const channel = db.channel(`leo-presence:${id}`);
    const emit = () => {
      const state = channel.presenceState?.() || {};
      if (Object.keys(state).length > 0) online.add(id);
      else online.delete(id);
      onOnlineIds?.([...online]);
    };
    channel.on("presence", { event: "sync" }, emit);
    channel.subscribe();
    return channel;
  });
  return () => {
    for (const channel of channels) db.removeChannel(channel);
  };
}

export function friendsErrorKey(error) {
  switch (error?.code) {
    case "SELF":
      return "friends.self";
    case "ALREADY_FRIENDS":
      return "friends.alreadyFriends";
    case "ALREADY_PENDING":
      return "friends.alreadyPending";
    case "NOT_FOUND":
      return "friends.notFound";
    case "AUTH":
      return "friends.unavailable";
    default:
      return "friends.sendError";
  }
}
