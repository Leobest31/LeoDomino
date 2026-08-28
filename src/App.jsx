import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import SplashPage from "./pages/SplashPage";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import GameStylePage from "./pages/GameStylePage";
import FindMatchPage from "./pages/FindMatchPage";
import FriendsPage from "./pages/FriendsPage";
import ChatPage from "./pages/ChatPage";
import GamePage from "./pages/GamePage";
import OnlineGamePage from "./pages/OnlineGamePage";
import {
  cleanupStaleOccupiedMatches,
  getMatchWithPlayers,
  sendFriendMatchInvite,
  friendInviteErrorKey,
} from "./online/matchmaking.js";
import { capturePendingReferralFromWindow } from "./online/referrals.js";
import { ONLINE_MODE, lockedRulesetId, readOnlineSession, clearOnlineSession } from "./online/onlineTable.js";
import { useOwnFriendsPresence } from "./hooks/useFriends.js";
import "./App.css";

/** @typedef {"intro" | "home" | "gameStyle" | "findMatch" | "friends" | "chat" | "game"} AppPhase */

/**
 * Startup: brand intro → Login (or Home if signed in) → Game Style → table.
 * PLAY VS LEOBEST opens Game Style. PLAY on that screen starts the 1v1 match.
 * Find Match Match-ready enters the live online table.
 * Main Menu returns to Home when signed in.
 */
function App() {
  const { signedIn, authReady, authView, openLogin, session } = useAuth();
  /** @type {[AppPhase, function]} */
  const [phase, setPhase] = useState("intro");
  const [splashExiting, setSplashExiting] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [matchOptions, setMatchOptions] = useState(null);
  const [friendInvitee, setFriendInvitee] = useState(null);
  const [friendsNoticeKey, setFriendsNoticeKey] = useState("");
  const [chatFocus, setChatFocus] = useState(null);
  const [chatReturnTo, setChatReturnTo] = useState("home");
  const recoveredOnlineRef = useRef(false);
  const friendInviteBusyRef = useRef(false);
  useOwnFriendsPresence();

  useEffect(() => {
    capturePendingReferralFromWindow();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.boot = phase;
  }, [phase]);

  useEffect(() => {
    if (!authReady || phase === "intro" || signedIn) return undefined;
    if (!authView) openLogin();
    if (phase === "game" || phase === "gameStyle" || phase === "findMatch" || phase === "friends" || phase === "chat") {
      setMatchOptions(null);
      setPhase("home");
    }
    return undefined;
  }, [authReady, signedIn, phase, authView, openLogin]);

  useEffect(() => {
    if (!authReady || !signedIn || phase !== "home") return undefined;
    cleanupStaleOccupiedMatches().catch(() => 0);
    return undefined;
  }, [authReady, signedIn, phase]);

  useEffect(() => {
    if (!authReady || !signedIn || phase !== "home") return undefined;
    if (recoveredOnlineRef.current) return undefined;
    const saved = readOnlineSession();
    if (!saved?.matchId) {
      recoveredOnlineRef.current = true;
      return undefined;
    }
    recoveredOnlineRef.current = true;
    let cancelled = false;
    cleanupStaleOccupiedMatches()
      .catch(() => 0)
      .then(() => getMatchWithPlayers(saved.matchId))
      .then((match) => {
        if (cancelled || !match?.id) return;
        if (match.status === "aborted") {
          clearOnlineSession();
          return;
        }
        setMatchOptions({
          mode: ONLINE_MODE,
          matchId: match.id,
          rulesetId: lockedRulesetId(match.rulesetId),
          host: match.host,
          opponent: match.opponent,
        });
        setGameKey((key) => key + 1);
        setPhase("game");
      })
      .catch(() => {
        /* stay on Home if the stored match cannot be resolved */
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, signedIn, phase]);

  const handleSplashFinished = () => {
    setSplashExiting(true);
  };

  const handleSplashExitEnd = () => {
    setSplashExiting(false);
    setPhase("home");
    if (authReady && !signedIn) openLogin();
  };

  const handlePlay = (config) => {
    if (friendInvitee?.playerId) {
      if (friendInviteBusyRef.current) return;
      friendInviteBusyRef.current = true;
      const inviteeId = friendInvitee.playerId;
      void sendFriendMatchInvite(inviteeId, config.rulesetId)
        .then(() => {
          setFriendsNoticeKey("friends.inviteSent");
        })
        .catch((error) => {
          setFriendsNoticeKey(friendInviteErrorKey(error));
        })
        .finally(() => {
          friendInviteBusyRef.current = false;
          setFriendInvitee(null);
          setPhase("friends");
        });
      return;
    }
    setMatchOptions({
      skipResume: true,
      playerCount: config.playerCount,
      difficulty: config.difficulty,
      rulesetId: config.rulesetId,
      seed: Date.now(),
    });
    setGameKey((key) => key + 1);
    setPhase("game");
  };

  const handleResume = () => {
    setMatchOptions({ skipResume: false });
    setGameKey((key) => key + 1);
    setPhase("game");
  };

  const handleEnterOnlineMatch = (match) => {
    const matchId = match?.matchId || match?.id;
    if (!matchId) return;
    setMatchOptions({
      mode: ONLINE_MODE,
      matchId,
      rulesetId: lockedRulesetId(match.rulesetId),
      host: match.host,
      opponent: match.opponent,
    });
    setGameKey((key) => key + 1);
    setPhase("game");
  };

  const handleMainMenu = () => {
    setMatchOptions(null);
    setChatFocus(null);
    setChatReturnTo("home");
    setGameKey((key) => key + 1);
    setPhase("home");
  };

  const openChat = (focus = null, returnTo = "home") => {
    setChatReturnTo(returnTo === "friends" ? "friends" : "home");
    setChatFocus(focus);
    setPhase("chat");
  };

  const bootShell =
    phase === "intro" ||
    phase === "home" ||
    phase === "gameStyle" ||
    phase === "findMatch" ||
    phase === "friends" ||
    phase === "chat";
  const showAuth = Boolean(authView) || (phase !== "intro" && authReady && !signedIn);
  const onlineTable = matchOptions?.mode === ONLINE_MODE;

  return (
    <div className={`app app--game${bootShell ? " app--booting" : ""}`}>
      {phase === "intro" ? (
        <SplashPage
          exiting={splashExiting}
          onFinished={handleSplashFinished}
          onExitComplete={handleSplashExitEnd}
        />
      ) : null}

      {phase === "home" && signedIn ? (
        <HomePage
          key={session?.playerId ?? "home"}
          onPlayVsLeoBest={() => setPhase("gameStyle")}
          onFindMatch={() => setPhase("findMatch")}
          onFriends={() => setPhase("friends")}
          onChat={() => openChat(null, "home")}
          onOpenChat={(focus) => openChat(focus, "home")}
          onEnterMatch={handleEnterOnlineMatch}
          onResume={handleResume}
        />
      ) : null}

      {phase === "findMatch" && signedIn ? (
        <FindMatchPage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
          onEnterMatch={handleEnterOnlineMatch}
        />
      ) : null}

      {phase === "friends" && signedIn ? (
        <FriendsPage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
          noticeKey={friendsNoticeKey}
          onNoticeConsumed={() => setFriendsNoticeKey("")}
          onPlayWithFriend={(person) => {
            if (!person?.playerId) return;
            setFriendsNoticeKey("");
            setFriendInvitee(person);
            setPhase("gameStyle");
          }}
          onEnterMatch={handleEnterOnlineMatch}
          onOpenChat={(focus) => openChat(focus, "friends")}
        />
      ) : null}

      {phase === "chat" && signedIn ? (
        <ChatPage
          focus={chatFocus}
          onFocusConsumed={() => setChatFocus(null)}
          onBack={() => setPhase(chatReturnTo === "friends" ? "friends" : "home")}
          onMainMenu={() => setPhase("home")}
        />
      ) : null}

      {phase === "gameStyle" && signedIn ? (
        <GameStylePage
          onBack={() => {
            if (friendInvitee) {
              setFriendInvitee(null);
              setPhase("friends");
              return;
            }
            setPhase("home");
          }}
          onMainMenu={() => {
            setFriendInvitee(null);
            setPhase("home");
          }}
          onPlay={handlePlay}
        />
      ) : null}

      {phase === "game" && signedIn && onlineTable ? (
        <OnlineGamePage
          key={gameKey}
          matchOptions={matchOptions}
          onMainMenu={handleMainMenu}
        />
      ) : null}

      {phase === "game" && signedIn && !onlineTable ? (
        <GamePage
          key={gameKey}
          matchOptions={matchOptions}
          onMainMenu={handleMainMenu}
        />
      ) : null}

      {showAuth ? <AuthPage /> : null}
    </div>
  );
}

export default App;
