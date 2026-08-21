import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./AuthContext.js";
import { AuthError, authService } from "./service.js";

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
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
