import { useCallback, useMemo, useState } from "react";
import { AuthContext } from "./AuthContext.js";
import { AuthError, authService } from "./service.js";

/**
 * Local session + auth screen intent. Overlay is rendered by App.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => authService.getSession());
  const [authView, setAuthView] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const logout = useCallback(() => {
    authService.logout();
    setSession(null);
    setAuthView("login");
  }, []);

  const value = useMemo(
    () => ({
      session,
      signedIn: Boolean(session),
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
