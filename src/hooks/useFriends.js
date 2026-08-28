/**
 * Friends board + Realtime requests. Presence is display-only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import {
  cancelFriendRequest,
  friendStatus,
  friendsErrorKey,
  listFriendsInActiveMatch,
  loadFriendsBoard,
  relationBetween,
  respondToFriendRequest,
  searchPlayers,
  sendFriendRequest,
  startOwnFriendsPresence,
  subscribeFriendRequests,
  subscribeFriendships,
  subscribeFriendsPresence,
  unfriendPlayer,
} from "../online/friends.js";

export function useOwnFriendsPresence() {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const ready = isCloudAuth() && Boolean(playerId);

  useEffect(() => {
    if (!ready) return undefined;
    let stop = () => {};
    try {
      stop = startOwnFriendsPresence(playerId);
    } catch {
      stop = () => {};
    }
    return () => stop();
  }, [ready, playerId]);
}

export function useFriendsBoard({ watchOnline = true } = {}) {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const onlineReady = isCloudAuth();
  const [board, setBoard] = useState({
    friends: [],
    incoming: [],
    outgoing: [],
    busyIds: [],
  });
  const [onlineIds, setOnlineIds] = useState([]);
  const [state, setState] = useState(onlineReady ? "loading" : "unavailable");
  const [errorKey, setErrorKey] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    if (!onlineReady || !playerId) {
      setState("unavailable");
      setBoard({ friends: [], incoming: [], outgoing: [], busyIds: [] });
      return;
    }
    try {
      const next = await loadFriendsBoard(playerId);
      setBoard(next);
      setErrorKey("");
      setState("ready");
    } catch {
      setErrorKey("friends.error");
      setState("error");
    }
  }, [onlineReady, playerId]);

  useEffect(() => {
    refresh();
    if (!onlineReady) return undefined;
    const stops = [];
    try {
      stops.push(
        subscribeFriendRequests(() => {
          refresh();
        })
      );
    } catch {
      /* optional realtime */
    }
    try {
      stops.push(
        subscribeFriendships(() => {
          refresh();
        })
      );
    } catch {
      /* optional realtime */
    }
    const poll = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => {
      window.clearInterval(poll);
      for (const stop of stops) stop?.();
    };
  }, [onlineReady, refresh]);

  useEffect(() => {
    if (!onlineReady || !watchOnline) return undefined;
    const ids = (board.friends || []).map((row) => row.playerId);
    let stop = () => {};
    try {
      stop = subscribeFriendsPresence(ids, (next) => {
        setOnlineIds(next);
        listFriendsInActiveMatch()
          .then((busyIds) => {
            setBoard((prev) => ({ ...prev, busyIds }));
          })
          .catch(() => {});
      });
    } catch {
      stop = () => {};
    }
    return () => stop();
  }, [onlineReady, board.friends, watchOnline]);

  const relationFor = useCallback(
    (targetId) => relationBetween(targetId, playerId, board),
    [board, playerId]
  );
  const outgoingRequestId = useCallback(
    (targetId) => board.outgoing.find((row) => row.receiverId === targetId)?.id || "",
    [board.outgoing]
  );
  const incomingRequestId = useCallback(
    (targetId) => board.incoming.find((row) => row.senderId === targetId)?.id || "",
    [board.incoming]
  );

  const statusFor = useCallback(
    (targetId) =>
      friendStatus({
        inMatch: (board.busyIds || []).includes(targetId),
        online: onlineIds.includes(targetId),
      }),
    [board.busyIds, onlineIds]
  );

  const run = useCallback(
    async (key, fn) => {
      if (busy) return;
      setBusy(key);
      setErrorKey("");
      try {
        await fn();
        await refresh();
      } catch (error) {
        setErrorKey(friendsErrorKey(error));
      } finally {
        setBusy("");
      }
    },
    [busy, refresh]
  );

  const sendTo = useCallback(
    (receiverId) => run("send", () => sendFriendRequest(receiverId, playerId)),
    [playerId, run]
  );
  const accept = useCallback(
    (requestId) => run("accept", () => respondToFriendRequest(requestId, "accept")),
    [run]
  );
  const decline = useCallback(
    (requestId) => run("decline", () => respondToFriendRequest(requestId, "decline")),
    [run]
  );
  const cancel = useCallback(
    (requestId) => run("cancel", () => cancelFriendRequest(requestId)),
    [run]
  );
  const removeFriend = useCallback(
    (friendId) => run("unfriend", () => unfriendPlayer(friendId)),
    [run]
  );
  const search = useCallback(
    (query) => searchPlayers(query, playerId, undefined, board.friends),
    [board.friends, playerId]
  );

  return useMemo(
    () => ({
      onlineReady,
      playerId,
      state,
      errorKey,
      busy,
      board,
      relationFor,
      outgoingRequestId,
      incomingRequestId,
      statusFor,
      refresh,
      sendTo,
      accept,
      decline,
      cancel,
      removeFriend,
      search,
    }),
    [
      onlineReady,
      playerId,
      state,
      errorKey,
      busy,
      board,
      relationFor,
      outgoingRequestId,
      incomingRequestId,
      statusFor,
      refresh,
      sendTo,
      accept,
      decline,
      cancel,
      removeFriend,
      search,
    ]
  );
}
