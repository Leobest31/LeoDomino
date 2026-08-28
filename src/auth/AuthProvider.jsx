import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContext.js";
import { AUTH_ERROR } from "./constants.js";
import { AuthError, authService } from "./service.js";
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

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    async function hydrate() {
      try {
        const initial = await authService.getSession();
        if (!cancelled) setSession(initial);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
      unsubscribe = authService.onAuthStateChange((next) => {
        if (!cancelled) setSession(next);
      });
    }

    hydrate();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !session?.playerId || session.deletionPending) return undefined;
    void applyPendingReferralAttribution();
    return undefined;
  }, [authReady, session?.playerId, session?.deletionPending]);

  const openLogin = useCallback(() => setAuthView("login"), []);
  const openCreate = useCallback(() => setAuthView("create"), []);
  const closeAuth = useCallback(() => setAuthView(null), []);

  const createAccount = useCallback(async (input) => {
    setBusy(true);
    try {
      const next = await authService.createAccount(input);
      setSession(next);
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
      setAuthView(null);
      return next;
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
    setAuthView("login");
  }, []);

  const deleteAccount = useCallback(async (password) => {
    setBusy(true);
    try {
      await authService.deleteAccount(password);
      setSession(null);
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
      authReady,
      authView,
      busy,
      openLogin,
      openCreate,
      closeAuth,
      createAccount,
      login,
      updateProfile,
      logout,
      deleteAccount,
    }),
    [
      session,
      authReady,
      authView,
      busy,
      openLogin,
      openCreate,
      closeAuth,
      createAccount,
      login,
      updateProfile,
      logout,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
