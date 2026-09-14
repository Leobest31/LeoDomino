import { useEffect, useState } from "react";
import { useAudio } from "../audio";
import { useAuth } from "../auth";
import { useLeoPipsStakeRequestCounts } from "../hooks/useLeoPipsStakeRequestCounts.js";
import LeoPipsStakePage from "../leopips/LeoPipsStakePage.jsx";
import {
  canAffordLeoPipsStake,
  isAllowedLeoPipsStake,
  isLeoPipsStyleId,
} from "../leopips/leopipsEconomy.js";
import { readMyLeoPipsWallet } from "../leopips/leopipsWalletRead.js";

/**
 * Authenticated LeoPips style/stake entry. Hosted read-only wallet.
 * PLAY hands off to existing Find Match. Does not debit or pay out.
 */
function LeoPipsAuthenticatedStake({ initialStyleId = "classic", onBack, onPlayWithFriends, onContinueToMatchmaking }) {
  const { play, unlock } = useAudio();
  const { session } = useAuth();
  const [styleId, setStyleId] = useState(isLeoPipsStyleId(initialStyleId) ? initialStyleId : "classic");
  const [walletStatus, setWalletStatus] = useState("loading");
  const [walletBalance, setWalletBalance] = useState(null);
  const { counts: requestCounts, status: requestCountsStatus } = useLeoPipsStakeRequestCounts(styleId);

  useEffect(() => {
    if (isLeoPipsStyleId(initialStyleId)) setStyleId(initialStyleId);
  }, [initialStyleId]);

  useEffect(() => {
    let cancelled = false;
    setWalletStatus("loading");
    setWalletBalance(null);
    readMyLeoPipsWallet()
      .then((result) => {
        if (cancelled) return;
        setWalletStatus(result.status === "ready" ? "ready" : "missing");
        setWalletBalance(result.status === "ready" ? result.balance : null);
      })
      .catch(() => {
        if (cancelled) return;
        setWalletStatus("error");
        setWalletBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.playerId]);

  const tap = (fn) => {
    unlock();
    play("button");
    fn?.();
  };

  const handleContinue = (pick) => {
    const styleId = String(pick?.styleId || "");
    const stake = Number(pick?.stake);
    if (walletStatus !== "ready") return;
    if (!isLeoPipsStyleId(styleId) || !isAllowedLeoPipsStake(stake)) return;
    if (!canAffordLeoPipsStake(walletBalance, stake)) return;
    tap(() => onContinueToMatchmaking?.({ styleId, stake }));
  };

  return (
    <LeoPipsStakePage
      isolated={false}
      styleId={styleId}
      balance={walletStatus === "ready" ? walletBalance : null}
      walletStatus={walletStatus}
      requestCounts={requestCounts}
      requestCountsStatus={requestCountsStatus}
      onBack={() => tap(() => onBack?.())}
      onChangeStyle={(next) => {
        if (isLeoPipsStyleId(next)) setStyleId(next);
      }}
      onPlayWithFriends={() => tap(() => onPlayWithFriends?.())}
      onFindMatch={handleContinue}
    />
  );
}

export default LeoPipsAuthenticatedStake;
