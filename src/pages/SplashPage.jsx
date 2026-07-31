import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n";
import { useAudio } from "../audio";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion.js";
import BrandLogo from "../components/BrandLogo";
import "./SplashPage.css";

const SPLASH_HOLD_MS = 2600;
const SPLASH_EXIT_MS = 640;
const SPLASH_REDUCED_MS = 720;
const CLICK_AT_MS = 1080;

/**
 * Launch splash — official LeoDomino crest presentation only.
 * Shown once on app start; never between matches.
 */
function SplashPage({ exiting = false, onFinished, onExitComplete }) {
  const { t } = useI18n();
  const { play, unlock } = useAudio();
  const reduced = usePrefersReducedMotion();
  const finishedRef = useRef(false);

  const particles = useMemo(
    () =>
      Array.from({ length: reduced ? 0 : 14 }, (_, index) => ({
        id: index,
        left: `${6 + ((index * 23) % 88)}%`,
        delay: `${(index % 8) * 0.2}s`,
        duration: `${2.4 + (index % 5) * 0.35}s`,
        size: `${1.5 + (index % 3) * 0.7}px`,
      })),
    [reduced]
  );

  useEffect(() => {
    const hold = reduced ? SPLASH_REDUCED_MS : SPLASH_HOLD_MS;
    let clickTimer = 0;

    if (!reduced) {
      clickTimer = window.setTimeout(() => {
        unlock().then((ok) => {
          if (ok) play("place", { gain: 0.65 });
        });
      }, CLICK_AT_MS);
    }

    const doneTimer = window.setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinished?.();
    }, hold);

    return () => {
      window.clearTimeout(clickTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onFinished, play, reduced, unlock]);

  useEffect(() => {
    if (!exiting) return undefined;
    const exitMs = reduced ? 180 : SPLASH_EXIT_MS;
    const timer = window.setTimeout(() => {
      onExitComplete?.();
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [exiting, onExitComplete, reduced]);

  return (
    <div
      className={`splash${exiting ? " splash--exit" : ""}${
        reduced ? " splash--reduced" : ""
      }`}
      role="presentation"
      aria-hidden={exiting ? true : undefined}
    >
      <main className="splash__frame" aria-label={t("splash.aria")}>
        <div className="splash__atmosphere" aria-hidden="true">
          <div className="splash__wood" />
          <div className="splash__vignette" />
          <div className="splash__rays" />
          <ul className="splash__particles">
            {particles.map((particle) => (
              <li
                key={particle.id}
                className="splash__particle"
                style={{
                  left: particle.left,
                  width: particle.size,
                  height: particle.size,
                  animationDelay: particle.delay,
                  animationDuration: particle.duration,
                }}
              />
            ))}
          </ul>
        </div>

        <div className="splash__stage">
          <div className="splash__lion-glow" aria-hidden="true" />
          <div className="splash__crest-wrap">
            <BrandLogo
              size="splash"
              title={t("common.brand")}
              className="splash__crest"
            />
            <span className="splash__sweep" aria-hidden="true" />
          </div>
        </div>
      </main>
    </div>
  );
}

export default SplashPage;
