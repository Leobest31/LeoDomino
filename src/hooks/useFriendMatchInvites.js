/**
 * Private friend-match invitations. Reuses match_requests Realtime + accept RPC.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isCloudAuth, useAuth } from "../auth";
import {
  acceptMatchRequest,
  cancelMatchRequest,
  declineFriendMatchInvite,
  friendInviteErrorKey,
  getMatchWithPlayers,
  isStaleMatchAcceptError,
  listIncomingFriendInvites,
  listOutgoingFriendInvites,
  normalizeMatchRequest,
  subscribeMatchRequests,
} from "../online/matchmaking.js";
import { canRecoverMatch } from "../online/matchRecovery.js";

export function useFriendMatchInvites({ onEnterMatch } = {}) {
  const { session } = useAuth();
  const playerId = session?.playerId || "";
  const onlineReady = isCloudAuth() && Boolean(playerId) && !session?.deletionPending;
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [errorKey, setErrorKey] = useState("");
  const [busy, setBusy] = useState("");
  const enteredRef = useRef("");

  const enterMatch = useCallback(
    async (matchId) => {
      if (!matchId || enteredRef.current === matchId) return;
      enteredRef.current = matchId;
      try {
        const match = await getMatchWithPlayers(matchId);
        if (!canRecoverMatch(match)) {
          enteredRef.current = "";
          return;
        }
        onEnterMatch?.(match);
      } catch {
        enteredRef.current = "";
        setErrorKey("findMatch.enterError");
      }
    },
    [onEnterMatch]
  );

  const refresh = useCallback(async () => {
    if (!onlineReady) {
      setIncoming([]);
      setOutgoing([]);
      return;
    }
    try {
      const [nextIncoming, nextOutgoing] = await Promise.all([
        listIncomingFriendInvites(playerId),
        listOutgoingFriendInvites(playerId),
      ]);
      setIncoming(nextIncoming);
      setOutgoing(nextOutgoing);
      setErrorKey("");
    } catch (error) {
      setErrorKey(friendInviteErrorKey(error));
    }
  }, [onlineReady, playerId]);

  useEffect(() => {
    refresh();
    if (!onlineReady) return undefined;
    let stop = () => {};
    try {
      stop = subscribeMatchRequests((payload) => {
        const row = normalizeMatchRequest(payload?.new);
        if (row?.visibility === "friend" && row.status === "accepted" && row.matchId) {
          if (row.creatorId === playerId || row.inviteeId === playerId) {
            void enterMatch(row.matchId);
          }
        }
        void refresh();
      });
    } catch {
      stop = () => {};
    }
    return () => stop();
  }, [enterMatch, onlineReady, playerId, refresh]);

  const pendingFor = useCallback(
    (friendId) => outgoing.find((row) => row.inviteeId === friendId) || null,
    [outgoing]
  );

  const accept = useCallback(
    async (request) => {
      const requestId = request?.id || request;
      if (!requestId || busy) return;
      setBusy(`accept:${requestId}`);
      setErrorKey("");
      try {
        const match = await acceptMatchRequest(requestId, {
          playerId,
          creatorId: request?.creatorId,
        });
        const matchId = match?.id || match?.matchId;
        if (matchId) await enterMatch(matchId);
        await refresh();
      } catch (error) {
        setErrorKey(
          isStaleMatchAcceptError(error)
            ? "findMatch.playerUnavailable"
            : friendInviteErrorKey(error)
        );
        await refresh();
      } finally {
        setBusy("");
      }
    },
    [busy, enterMatch, playerId, refresh]
  );

  const decline = useCallback(
    async (requestId) => {
      if (!requestId || busy) return;
      setBusy(`decline:${requestId}`);
      setErrorKey("");
      try {
        await declineFriendMatchInvite(requestId);
        await refresh();
      } catch (error) {
        setErrorKey(friendInviteErrorKey(error));
        await refresh();
      } finally {
        setBusy("");
      }
    },
    [busy, refresh]
  );

  const cancel = useCallback(
    async (requestId) => {
      if (!requestId || busy) return;
      setBusy(`cancel:${requestId}`);
      setErrorKey("");
      try {
        await cancelMatchRequest(requestId);
        await refresh();
      } catch (error) {
        setErrorKey(friendInviteErrorKey(error));
        await refresh();
      } finally {
        setBusy("");
      }
    },
    [busy, refresh]
  );

  return {
    incoming,
    outgoing,
    errorKey,
    busy,
    pendingFor,
    accept,
    decline,
    cancel,
    refresh,
  };
}
