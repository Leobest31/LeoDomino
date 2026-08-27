import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { reportError } from "../monitoring";
import { isSupabaseConfigured } from "../online/supabaseClient.js";
import {
  applyPendingReferralAttribution,
  buildReferralLink,
  consumeReferralNotice,
  copyText,
  ensureMyReferralCode,
  normalizeReferralCode,
  noticeAfterReferralCodeLoad,
  noticeForInviteFriendsOutcome,
  shareReferralInvite,
} from "../online/referrals.js";

/**
 * Loads the authenticated player's server-issued invite code and share actions.
 */
export function useReferralInvite({ enabled = true } = {}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [noticeKey, setNoticeKey] = useState("");
  const [noticeNonce, setNoticeNonce] = useState(0);
  const inviteLockRef = useRef(false);
  const codeRef = useRef("");

  const showNotice = useCallback((key) => {
    setNoticeKey(key || "");
    setNoticeNonce((n) => n + 1);
  }, []);

  const fetchCode = useCallback(async () => {
    if (!enabled) return "";
    if (!isSupabaseConfigured()) {
      showNotice("referral.unavailable");
      return "";
    }
    try {
      const next = await ensureMyReferralCode();
      codeRef.current = next;
      setCode(next);
      await applyPendingReferralAttribution({ ownCode: next });
      showNotice(noticeAfterReferralCodeLoad(true, consumeReferralNotice()));
      return next;
    } catch (error) {
      reportError(error, {
        screen: "referral",
        actionName: "ensure_my_referral_code",
        code: error?.code || "GENERIC",
      });
      showNotice(noticeAfterReferralCodeLoad(false));
      return "";
    }
  }, [enabled, showNotice]);

  const loadCode = useCallback(async () => {
    if (!enabled) return "";
    setBusy(true);
    try {
      return await fetchCode();
    } finally {
      setBusy(false);
    }
  }, [enabled, fetchCode]);

  useEffect(() => {
    if (!enabled) return undefined;
    const notice = consumeReferralNotice();
    if (notice) showNotice(notice);
    void loadCode();
    return undefined;
  }, [enabled, loadCode, showNotice]);

  const copyCode = useCallback(async () => {
    const value = codeRef.current || code;
    if (!value) return false;
    try {
      const ok = await copyText(value);
      showNotice(ok ? "referral.copied" : "referral.shareFailed");
      return ok;
    } catch (error) {
      reportError(error, {
        screen: "referral",
        actionName: "copyCode",
        code: error?.code || "GENERIC",
      });
      showNotice("referral.shareFailed");
      return false;
    }
  }, [code, showNotice]);

  const inviteFriends = useCallback(async () => {
    if (inviteLockRef.current) return "busy";
    inviteLockRef.current = true;
    setBusy(true);
    try {
      let ready = codeRef.current || code;
      if (!ready) {
        showNotice("referral.preparing");
        ready = await fetchCode();
      }
      ready = normalizeReferralCode(ready) || normalizeReferralCode(codeRef.current) || normalizeReferralCode(code);
      const url = ready ? buildReferralLink(ready) : "";
      if (!ready) {
        showNotice(noticeForInviteFriendsOutcome({ code: "", url: "", result: "failed" }));
        return "failed";
      }
      if (!url) {
        showNotice(noticeForInviteFriendsOutcome({ code: ready, url: "", result: "failed" }));
        return "failed";
      }
      let result = "failed";
      try {
        result = await shareReferralInvite({
          title: t("referral.shareTitle"),
          text: t("referral.shareText"),
          url,
        });
      } catch (error) {
        reportError(error, {
          screen: "referral",
          actionName: "shareReferralInvite",
          code: error?.code || "GENERIC",
        });
        result = "failed";
      }
      showNotice(noticeForInviteFriendsOutcome({ code: ready, url, result }));
      return result;
    } finally {
      inviteLockRef.current = false;
      setBusy(false);
    }
  }, [code, fetchCode, showNotice, t]);

  return {
    code,
    link: buildReferralLink(code),
    busy,
    noticeKey,
    noticeNonce,
    copyCode,
    inviteFriends,
    reload: loadCode,
  };
}
