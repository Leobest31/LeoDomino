import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import SplashPage from "./pages/SplashPage";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import AccountDeletionPending from "./components/AccountDeletionPending.jsx";
import GameStylePage from "./pages/GameStylePage";
import FindMatchPage from "./pages/FindMatchPage";
import FriendsPage from "./pages/FriendsPage";
import ChatPage from "./pages/ChatPage";
import GamePage from "./pages/GamePage";
import OnlineGamePage from "./pages/OnlineGamePage";
import {
  cleanupStaleOccupiedMatches,
  getMyActiveMatch,
  sendFriendMatchInvite,
  friendInviteErrorKey,
} from "./online/matchmaking.js";
import { canRecoverMatch, decideHomeSessionRecovery } from "./online/matchRecovery.js";
import { isNotedTerminalMatch } from "./online/terminalMatchMemory.js";
import { useActiveOnlineMatch } from "./hooks/useActiveOnlineMatch.js";
import { capturePendingReferralFromWindow } from "./online/referrals.js";
import { ONLINE_MODE, lockedRulesetId, readOnlineSession, clearOnlineSession } from "./online/onlineTable.js";
import { useOwnFriendsPresence } from "./hooks/useFriends.js";
import { usePlayerPresence } from "./hooks/usePlayerPresence.js";
import { probeAmIStaff } from "./online/adminDashboard.js";
import { enterAdminLocation, goBackFromAdmin, isAdminLocation, leaveAdminLocation } from "./online/adminRoute.js";
import AdminPage from "./pages/AdminPage.jsx";
import ChallengePage from "./pages/ChallengePage.jsx";
import "./App.css";

/** @typedef {"intro" | "home" | "gameStyle" | "findMatch" | "friends" | "chat" | "game" | "admin" | "challenge"} AppPhase */

/**
 * Startup: brand intro → Login (or Home if signed in) → Game Style → table.
 * PLAY VS LEOBEST opens Game Style. PLAY on that screen starts the 1v1 match.
 * Find Match Match-ready enters the live online table.
 * Main Menu returns to Home when signed in.
 */
function App() {
  const { signedIn, authReady, authView, openLogin, session } = useAuth();
  const playable = Boolean(signedIn && !session?.deletionPending);
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
  const [staffRole, setStaffRole] = useState(null);
  const activeOnline = useActiveOnlineMatch({ enabled: playable });
  useOwnFriendsPresence();
  usePlayerPresence();

  useEffect(() => {
    capturePendingReferralFromWindow();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.boot = phase;
  }, [phase]);

  useEffect(() => {
    if (!authReady || phase === "intro" || signedIn) return undefined;
    if (!authView) openLogin();
    if (
      phase === "game" ||
      phase === "gameStyle" ||
      phase === "findMatch" ||
      phase === "friends" ||
      phase === "chat" ||
      phase === "admin" ||
      phase === "challenge"
    ) {
      setMatchOptions(null);
      if (phase === "admin") leaveAdminLocation();
      setPhase("home");
    }
    return undefined;
  }, [authReady, signedIn, phase, authView, openLogin]);

  useEffect(() => {
    if (!playable) {
      setStaffRole(null);
      return undefined;
    }
    let cancelled = false;
    probeAmIStaff()
      .then((result) => {
        if (!cancelled) setStaffRole(result.isStaff ? result.role : false);
      })
      .catch(() => {
        if (!cancelled) setStaffRole(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playable, session?.playerId]);

  useEffect(() => {
    if (!authReady || !playable || phase === "intro") return undefined;
    if (isAdminLocation() && phase !== "admin") setPhase("admin");
    return undefined;
  }, [authReady, playable, phase]);

  useEffect(() => {
    const onNav = () => {
      if (isAdminLocation()) {
        if (playable) setPhase("admin");
        return;
      }
      setPhase((current) => (current === "admin" ? "home" : current));
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, [playable]);

  useEffect(() => {
    if (!authReady || !playable || phase !== "home") return undefined;
    cleanupStaleOccupiedMatches().catch(() => 0);
    return undefined;
  }, [authReady, playable, phase]);

  useEffect(() => {
    if (!authReady || !playable || phase !== "home") return undefined;
    if (recoveredOnlineRef.current) return undefined;
    const saved = readOnlineSession();
    if (!saved?.matchId) {
      recoveredOnlineRef.current = true;
      return undefined;
    }
    recoveredOnlineRef.current = true;
    let cancelled = false;
    if (isNotedTerminalMatch(saved.matchId)) {
      clearOnlineSession();
      return undefined;
    }
    getMyActiveMatch()
      .then((match) => {
        if (cancelled) return;
        const decision = decideHomeSessionRecovery({
          savedMatchId: saved.matchId,
          occupancyUnknown: false,
          occupancyMatch: match,
        });
        if (decision.clearSession) clearOnlineSession();
        if (!decision.enter || !decision.match) return;
        setMatchOptions({
          mode: ONLINE_MODE,
          matchId: decision.match.id,
          rulesetId: lockedRulesetId(decision.match.rulesetId),
          host: decision.match.host,
          opponent: decision.match.opponent,
        });
        setGameKey((key) => key + 1);
        setPhase("game");
      })
      .catch(() => {
        const decision = decideHomeSessionRecovery({
          savedMatchId: saved.matchId,
          occupancyUnknown: true,
          occupancyMatch: null,
        });
        if (decision.clearSession) clearOnlineSession();
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, playable, phase]);

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
    if (match?.status && !canRecoverMatch({ ...match, id: matchId })) return;
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
    leaveAdminLocation();
    setPhase("home");
  };

  const handleAdminBack = () => {
    goBackFromAdmin(typeof window !== "undefined" ? window : null, handleMainMenu);
  };

  const openAdmin = () => {
    enterAdminLocation();
    setPhase("admin");
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
    phase === "chat" ||
    phase === "admin" ||
    phase === "challenge";
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

      {phase !== "intro" && session?.deletionPending ? <AccountDeletionPending /> : null}

      {phase === "home" && playable ? (
        <HomePage
          key={session?.playerId ?? "home"}
          onPlayVsLeoBest={() => setPhase("gameStyle")}
          onFindMatch={() => setPhase("findMatch")}
          onFriends={() => setPhase("friends")}
          onChat={() => openChat(null, "home")}
          onOpenChat={(focus) => openChat(focus, "home")}
          onEnterMatch={handleEnterOnlineMatch}
          activeOnlineMatch={activeOnline.match}
          onOpenChallenge={() => setPhase("challenge")}
          onResume={handleResume}
          showAdmin={typeof staffRole === "string"}
          onOpenAdmin={openAdmin}
        />
      ) : null}

      {phase === "findMatch" && playable ? (
        <FindMatchPage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
          onEnterMatch={handleEnterOnlineMatch}
        />
      ) : null}

      {phase === "friends" && playable ? (
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

      {phase === "chat" && playable ? (
        <ChatPage
          focus={chatFocus}
          onFocusConsumed={() => setChatFocus(null)}
          onBack={() => setPhase(chatReturnTo === "friends" ? "friends" : "home")}
          onMainMenu={() => setPhase("home")}
        />
      ) : null}

      {phase === "gameStyle" && playable ? (
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

      {phase === "admin" && playable ? (
        <AdminPage onBack={handleAdminBack} />
      ) : null}

      {phase === "challenge" && playable ? (
        <ChallengePage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
        />
      ) : null}

      {phase === "game" && playable && onlineTable ? (
        <OnlineGamePage
          key={gameKey}
          matchOptions={matchOptions}
          onMainMenu={handleMainMenu}
        />
      ) : null}

      {phase === "game" && playable && !onlineTable ? (
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
