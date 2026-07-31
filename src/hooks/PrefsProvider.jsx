import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyTheme,
  loadPrefs,
  savePrefs,
  vibrate as vibrateDevice,
} from "../persistence/index.js";
import { PrefsContext } from "./PrefsContext.js";

/**
 * Theme + vibration preferences (persisted offline).
 */
export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(() => loadPrefs());

  useEffect(() => {
    applyTheme(prefs.theme);
  }, [prefs.theme]);

  const setTheme = useCallback((theme) => {
    setPrefs(savePrefs({ theme }));
  }, []);

  const setVibration = useCallback((vibration) => {
    setPrefs(savePrefs({ vibration: Boolean(vibration) }));
  }, []);

  const vibrate = useCallback((pattern) => {
    vibrateDevice(pattern);
  }, []);

  const value = useMemo(
    () => ({
      ...prefs,
      setTheme,
      setVibration,
      vibrate,
    }),
    [prefs, setTheme, setVibration, vibrate]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
