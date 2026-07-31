import { useContext } from "react";
import { PrefsContext } from "./PrefsContext.js";

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
