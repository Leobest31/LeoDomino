import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContext.js";
import { AUTH_ERROR } from "./constants.js";
import { AuthError, authService } from "./service.js";
import { PASSWORD_RECOVERY_EVENT, passwordResetRedirectTo } from "./passwordRecovery.js";
import { applyPendingReferralAttribution } from "../online/referrals.js";

/**
 * Cloud session (Supabase when configured) + auth screen intent.
 * Overlay is rendered by App.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authView, setAuthView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    async function hydrate() {
      try {
        const callback = await authService.consumeAuthCallback();
        if (cancelled) return;
        if (callback?.event === PASSWORD_RECOVERY_EVENT || callback?.recovered) {
          setPasswordRecoveryPending(true);
          setAuthView("reset");
        }
        const initial = await authService.getSession();
        if (!cancelled) setSession(initial);
      } catch {
        if (!cancelled) {
          setSession(null);
          setPasswordRecoveryPending(false);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
      unsubscribe = authService.onAuthStateChange((next, event) => {
        if (cancelled) return;
        setSession(next);
        if (event === PASSWORD_RECOVERY_EVENT) {
          setPasswordRecoveryPending(true);
          setAuthView("reset");
        }
        if (event === "SIGNED_OUT") {
          setPasswordRecoveryPending(false);
        }
      });
    }

    hydrate();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !session?.playerId || session.deletionPending || passwordRecoveryPending) {
      return undefined;
    }
    void applyPendingReferralAttribution();
    return undefined;
  }, [authReady, session?.playerId, session?.deletionPending, passwordRecoveryPending]);

  const openLogin = useCallback(() => {
    setPasswordRecoveryPending(false);
    setAuthView("login");
  }, []);
  const openCreate = useCallback(() => setAuthView("create"), []);
  const openForgot = useCallback(() => setAuthView("forgot"), []);
  const closeAuth = useCallback(() => setAuthView(null), []);

  const createAccount = useCallback(async (input) => {
    setBusy(true);
    try {
      const next = await authService.createAccount(input);
      setSession(next);
      setPasswordRecoveryPending(false);
      setAuthView(null);
      return next;
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const login = useCallback(async (input) => {
    setBusy(true);
    try {
      const next = await authService.login(input);
      setSession(next);
      setPasswordRecoveryPending(false);
      setAuthView(null);
      return next;
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    setBusy(true);
    try {
      await authService.requestPasswordReset(email, {
        redirectTo: passwordResetRedirectTo(),
      });
      return { sent: true };
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const updatePassword = useCallback(async (password, confirmPassword) => {
    setBusy(true);
    try {
      await authService.updatePassword(password, confirmPassword);
      setPasswordRecoveryPending(false);
      try {
        await authService.logout();
      } catch {
        /* recovery session may already be invalid */
      }
      setSession(null);
      /* Keep authView on "reset" so Set New Password can show success. */
      return { updated: true };
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const updateProfile = useCallback(async (input) => {
    setBusy(true);
    try {
      const next = await authService.updateProfile(input);
      setSession(next);
      return next;
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
    setPasswordRecoveryPending(false);
    setAuthView("login");
  }, []);

  const deleteAccount = useCallback(async (password) => {
    setBusy(true);
    try {
      await authService.deleteAccount(password);
      setSession(null);
      setPasswordRecoveryPending(false);
      setAuthView("login");
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.code === AUTH_ERROR.DELETE_PENDING || error.code === AUTH_ERROR.ACCOUNT_DELETED)
      ) {
        try {
          const next = await authService.getSession();
          if (next) setSession(next);
        } catch {
          /* keep current session so retry remains possible */
        }
      }
      throw error instanceof AuthError ? error : new AuthError("generic");
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      signedIn: Boolean(session),
      passwordRecoveryPending,
      authReady,
      authView,
      busy,
      openLogin,
      openCreate,
      openForgot,
      closeAuth,
      createAccount,
      login,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      logout,
      deleteAccount,
    }),
    [
      session,
      passwordRecoveryPending,
      authReady,
      authView,
      busy,
      openLogin,
      openCreate,
      openForgot,
      closeAuth,
      createAccount,
      login,
      requestPasswordReset,
      updatePassword,
      updateProfile,
      logout,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
