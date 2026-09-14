import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import SettingsPanel from "../components/SettingsPanel";
import ProfilePanel from "../components/ProfilePanel";
import NotificationsPanel from "../components/NotificationsPanel";
import { resolvePlayerAvatar } from "../auth/avatars.media.js";
import {
  AI_DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
} from "../game/ai/difficulties.js";
import { useAuth } from "../auth";
import { useFriendsBoard } from "../hooks/useFriends.js";
import { useFriendMatchInvites } from "../hooks/useFriendMatchInvites.js";
import { useFriendChat } from "../hooks/useFriendChat.js";
import { formatInboxBadge, inboxBadgeCount } from "../online/friendChat.js";
import { canRecoverMatch } from "../online/matchRecovery.js";
import { useReferralInvite } from "../hooks/useReferralInvite.js";
import { loadMatch } from "../persistence/index.js";
import { readStorage, writeStorage } from "../utils/storage.js";
import LeoPipsHomePage from "../leopips/LeoPipsHomePage.jsx";
import { LEOPIPS_COPY } from "../leopips/leopipsCopy.js";
import {
  LEOPIPS_WALLET_CHANGED_EVENT,
  readMyLeoPipsWallet,
  subscribeMyLeoPipsWallet,
} from "../leopips/leopipsWalletRead.js";
import {
  consumeMyLevelUpEvent,
  listMyPendingLevelUps,
  readMyProgression,
} from "../leopips/leopipsProgressRead.js";
import { progressionWinProgress } from "../leopips/leopipsProgress.js";
import LevelUpOverlay from "../components/LevelUpOverlay.jsx";

function missingProgression() {
  const winProgress = progressionWinProgress(0);
  return {
    status: "missing",
    lifetimeXp: 0,
    qualifyingWins: 0,
    level: 0,
    rank: null,
    winProgress,
  };
}

/**
 * Authenticated LeoPips Home: real session, read-only wallet, existing routes.
 * FIND MATCH is handled by App (stake UI, then existing FindMatchPage).
 * Does not debit LeoPips.
 */
function LeoPipsAuthenticatedHome({
  onPlayVsLeoBest,
  onResume,
  onFindMatch,
  onFriends,
  onChat,
  onOpenChat,
  onEnterMatch,
  activeOnlineMatch,
  onOpenChallenge,
  showAdmin,
  onOpenAdmin,
}) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const { session } = useAuth();
  const resumeOnline = canRecoverMatch(activeOnlineMatch) ? activeOnlineMatch : null;
  const referral = useReferralInvite({ enabled: Boolean(session) });
  const friends = useFriendsBoard({ watchOnline: false });
  const invites = useFriendMatchInvites({ onEnterMatch });
  const chat = useFriendChat();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [canResumeOffline, setCanResumeOffline] = useState(() => Boolean(loadMatch()));
  const [difficulty, setDifficulty] = useState(() =>
    normalizeDifficulty(readStorage(AI_DIFFICULTY_STORAGE_KEY, DEFAULT_DIFFICULTY))
  );
  const [walletStatus, setWalletStatus] = useState("loading");
  const [walletBalance, setWalletBalance] = useState(null);
  const [progression, setProgression] = useState(null);
  const [levelUpEvent, setLevelUpEvent] = useState(null);

  useEffect(() => {
    setCanResumeOffline(Boolean(loadMatch()));
  }, []);

  useEffect(() => {
    setSettingsOpen(false);
    setProfileOpen(false);
    setInboxOpen(false);
  }, [session?.playerId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    const refreshWalletAndProgression = ({ silent = false } = {}) => {
      if (!silent) {
        setWalletStatus("loading");
        setWalletBalance(null);
        setProgression(null);
      }
      readMyLeoPipsWallet()
        .then((result) => {
          if (cancelled) return;
          setWalletStatus(result.status === "ready" ? "ready" : "missing");
          setWalletBalance(result.status === "ready" ? result.balance : null);
        })
        .catch(() => {
          if (cancelled) return;
          if (!silent) {
            setWalletStatus("error");
            setWalletBalance(null);
          }
        });
      readMyProgression()
        .then((result) => {
          if (cancelled) return;
          setProgression(result);
        })
        .catch(() => {
          if (cancelled) return;
          if (!silent) setProgression(missingProgression());
        });
      listMyPendingLevelUps()
        .then((events) => {
          if (cancelled) return;
          if (Array.isArray(events) && events.length) setLevelUpEvent(events[0]);
        })
        .catch(() => {});
    };
    refreshWalletAndProgression();
    const onFocus = () => refreshWalletAndProgression({ silent: true });
    const onVis = () => {
      if (document.visibilityState === "hidden") return;
      refreshWalletAndProgression({ silent: true });
    };
    const onWalletChanged = () => refreshWalletAndProgression({ silent: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(LEOPIPS_WALLET_CHANGED_EVENT, onWalletChanged);
    void subscribeMyLeoPipsWallet((result) => {
      if (cancelled) return;
      setWalletStatus(result.status === "ready" ? "ready" : "missing");
      setWalletBalance(result.status === "ready" ? result.balance : null);
    }).then((unsub) => {
      if (cancelled) {
        unsub?.();
        return;
      }
      unsubscribe = typeof unsub === "function" ? unsub : () => {};
    });
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(LEOPIPS_WALLET_CHANGED_EVENT, onWalletChanged);
      unsubscribe();
    };
  }, [session?.playerId]);

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const dismissLevelUp = async () => {
    const current = levelUpEvent;
    setLevelUpEvent(null);
    if (current?.level == null) return;
    try {
      await consumeMyLevelUpEvent(current.level);
    } catch {
      /* already consumed or offline — do not re-show from this session */
    }
    const rest = await listMyPendingLevelUps().catch(() => []);
    if (Array.isArray(rest) && rest.length) setLevelUpEvent(rest[0]);
  };

  const walletNotice =
    walletStatus === "error"
      ? LEOPIPS_COPY.walletReadFailed
      : walletStatus === "missing"
        ? LEOPIPS_COPY.walletMissing
        : referral.noticeKey
          ? t(referral.noticeKey)
          : "";

  const inboxCount = inboxBadgeCount({
    incomingFriendRequests: friends.board.incoming.length,
    incomingMatchInvites: invites.incoming.length,
    unreadMessageCount: chat.unreadTotal,
  });

  return (
    <>
      <LeoPipsHomePage
        isolated={false}
        balance={walletStatus === "ready" ? walletBalance : null}
        walletStatus={walletStatus}
        level={progression?.level ?? 0}
        lifetimeXp={progression?.lifetimeXp ?? 0}
        qualifyingWins={progression?.qualifyingWins ?? 0}
        progressionRank={progression?.rank ?? null}
        displayName={session?.displayName || session?.username || t("game.player")}
        statusNotice={walletNotice}
        comingSoonNotice={t("home.comingSoonNotice")}
        avatarSrc={session ? resolvePlayerAvatar(session.avatarId).src : undefined}
        inboxBadge={formatInboxBadge(inboxCount)}
        chatBadge={formatInboxBadge(chat.unreadTotal)}
        canResume={canResumeOffline}
        resumeLabel={t("setup.resumeMatch")}
        findMatchLabel={resumeOnline ? t("setup.resumeMatch") : LEOPIPS_COPY.findMatch}
        onPlayOnline={() =>
          tap(() => {
            if (resumeOnline) onEnterMatch?.(resumeOnline);
            else onFindMatch?.();
          })
        }
        onPlayVsLeoBest={() => tap(() => onPlayVsLeoBest?.())}
        onFriends={() => tap(() => onFriends?.())}
        onChat={() => tap(() => onChat?.())}
        onNotifications={() => tap(() => setInboxOpen(true))}
        onProfile={() => tap(() => setProfileOpen(true))}
        onSettings={() => tap(() => setSettingsOpen(true))}
        onChallenge={() => tap(() => onOpenChallenge?.())}
        onInviteFriends={() => tap(() => void referral.inviteFriends())}
        onResume={() => tap(() => onResume?.())}
        onNavPlay={() => tap(() => onPlayVsLeoBest?.())}
      />
      <LevelUpOverlay
        open={Boolean(levelUpEvent)}
        level={levelUpEvent?.level}
        rank={levelUpEvent?.rank}
        maxLevel={levelUpEvent?.level === 100}
        title={t("progression.levelUpTitle")}
        congratulations={t("progression.congratulations")}
        welcome={t("progression.welcomeToLevel", { level: levelUpEvent?.level ?? 0 })}
        maxLabel={t("progression.maxLevelReached")}
        continueLabel={t("progression.continue")}
        onContinue={() => void dismissLevelUp()}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        difficulty={difficulty}
        onDifficultyChange={(next) => {
          const level = normalizeDifficulty(next);
          setDifficulty(level);
          writeStorage(AI_DIFFICULTY_STORAGE_KEY, level);
        }}
        showAdmin={Boolean(showAdmin)}
        onOpenAdmin={() => {
          setSettingsOpen(false);
          onOpenAdmin?.();
        }}
      />
      <ProfilePanel
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        referral={referral}
      />
      <NotificationsPanel
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        friends={friends}
        invites={invites}
        conversations={chat.conversations}
        onOpenFriends={() => onFriends?.()}
        onOpenChat={(focus) => onOpenChat?.(focus)}
      />
    </>
  );
}

export default LeoPipsAuthenticatedHome;
