import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyTheme,
  applyTileSkin,
  loadPrefs,
  savePrefs,
  vibrate as vibrateDevice,
} from "../persistence/index.js";
import { PrefsContext } from "./PrefsContext.js";

/**
 * Theme + tile skin + vibration preferences (persisted offline).
 */
export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(() => loadPrefs());

  useEffect(() => {
    applyTheme(prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    applyTileSkin(prefs.tileSkin);
  }, [prefs.tileSkin]);

  const setTheme = useCallback((theme) => {
    setPrefs(savePrefs({ theme }));
  }, []);

  const setTileSkin = useCallback((tileSkin) => {
    setPrefs(savePrefs({ tileSkin }));
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
      setTileSkin,
      setVibration,
      vibrate,
    }),
    [prefs, setTheme, setTileSkin, setVibration, vibrate]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
