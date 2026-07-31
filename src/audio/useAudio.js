import { useContext } from "react";
import { AudioContext } from "./AudioContext.js";

/**
 * Access LeoDomino audio controls & playback.
 */
export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) {
    throw new Error("useAudio must be used within AudioProvider");
  }
  return ctx;
}
