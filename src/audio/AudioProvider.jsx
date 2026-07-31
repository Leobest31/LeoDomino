import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioContext } from "./AudioContext.js";
import { audioEngine } from "./AudioEngine.js";

/**
 * App-wide audio provider — unlock on first gesture, persist prefs.
 */
export function AudioProvider({ children }) {
  const [prefs, setPrefs] = useState(() => audioEngine.getPrefs());

  const refresh = useCallback(() => {
    setPrefs(audioEngine.getPrefs());
  }, []);

  useEffect(() => {
    const unlock = () => {
      audioEngine.unlock().then(() => {
        refresh();
      });
    };

    // Mobile-friendly: unlock on first pointer / key interaction.
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [refresh]);

  const play = useCallback((id, options) => {
    audioEngine.play(id, options);
  }, []);

  const setVolume = useCallback(
    (volume) => {
      audioEngine.setVolume(volume);
      refresh();
    },
    [refresh]
  );

  const setMuted = useCallback(
    (muted) => {
      audioEngine.setMuted(muted);
      refresh();
    },
    [refresh]
  );

  const toggleMute = useCallback(() => {
    audioEngine.toggleMute();
    refresh();
    return audioEngine.getPrefs().muted;
  }, [refresh]);

  const setAmbient = useCallback(
    (enabled) => {
      audioEngine.setAmbient(enabled);
      refresh();
    },
    [refresh]
  );

  const unlock = useCallback(async () => {
    const ok = await audioEngine.unlock();
    refresh();
    return ok;
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...prefs,
      play,
      setVolume,
      setMuted,
      toggleMute,
      setAmbient,
      unlock,
    }),
    [prefs, play, setAmbient, setMuted, setVolume, toggleMute, unlock]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}
