/**
 * Home and Challenge page schedule. Reads hosted config on mount,
 * visibility/focus/resume, and a short poll while the screen is visible.
 * Does not subscribe to postgres changes. Does not write. Does not auto-live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  challengeHomePresentation,
  fetchPublicChallengeSchedule,
} from "../online/challengeSchedule.js";

/** While Home is visible, re-read hosted Challenge config. Not a clock-driven status flip. */
export const CHALLENGE_HOME_REFRESH_MS = 15000;

export function usePublicChallengeSchedule() {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scheduleRef = useRef(null);
  const inFlightRef = useRef(null);
  scheduleRef.current = schedule;

  const refresh = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = fetchPublicChallengeSchedule()
      .then((next) => {
        setSchedule(next);
        setFailed(!next);
      })
      .catch(() => {
        if (!scheduleRef.current) {
          setSchedule(null);
          setFailed(true);
        }
      })
      .finally(() => {
        inFlightRef.current = null;
        setLoading(false);
      });
    inFlightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();

    const refreshIfVisible = () => {
      setNowMs(Date.now());
      if (document.visibilityState === "visible") void refresh();
    };

    const onShow = () => {
      setNowMs(Date.now());
      void refresh();
    };

    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("resume", onShow);

    const poll = window.setInterval(refreshIfVisible, CHALLENGE_HOME_REFRESH_MS);

    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("resume", onShow);
      window.clearInterval(poll);
    };
  }, [refresh]);

  const presentation = useMemo(
    () => challengeHomePresentation(schedule, nowMs),
    [schedule, nowMs]
  );

  useEffect(() => {
    if (!schedule) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [schedule]);

  return { schedule, loading, failed, presentation, refresh };
}
