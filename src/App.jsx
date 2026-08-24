import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import SplashPage from "./pages/SplashPage";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import GameStylePage from "./pages/GameStylePage";
import FindMatchPage from "./pages/FindMatchPage";
import GamePage from "./pages/GamePage";
import "./App.css";

/** @typedef {"intro" | "home" | "gameStyle" | "findMatch" | "game"} AppPhase */

/**
 * Startup: brand intro → Login (or Home if signed in) → Game Style → table.
 * PLAY VS LEOBEST opens Game Style. PLAY on that screen starts the 1v1 match.
 * Main Menu returns to Home when signed in.
 */
function App() {
  const { signedIn, authReady, authView, openLogin, session } = useAuth();
  /** @type {[AppPhase, function]} */
  const [phase, setPhase] = useState("intro");
  const [splashExiting, setSplashExiting] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [matchOptions, setMatchOptions] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.boot = phase;
  }, [phase]);

  useEffect(() => {
    if (!authReady || phase === "intro" || signedIn) return undefined;
    if (!authView) openLogin();
    if (phase === "game" || phase === "gameStyle" || phase === "findMatch") {
      setMatchOptions(null);
      setPhase("home");
    }
    return undefined;
  }, [authReady, signedIn, phase, authView, openLogin]);

  const handleSplashFinished = () => {
    setSplashExiting(true);
  };

  const handleSplashExitEnd = () => {
    setSplashExiting(false);
    setPhase("home");
    if (authReady && !signedIn) openLogin();
  };

  const handlePlay = (config) => {
    setMatchOptions({
      skipResume: true,
      playerCount: config.playerCount,
      difficulty: config.difficulty,
      rulesetId: config.rulesetId,
      seed: Date.now(),
    });
    setGameKey((key) => key + 1);
    setPhase("game");
  };

  const handleResume = () => {
    setMatchOptions({ skipResume: false });
    setGameKey((key) => key + 1);
    setPhase("game");
  };

  const handleMainMenu = () => {
    setMatchOptions(null);
    setGameKey((key) => key + 1);
    setPhase("home");
  };

  const bootShell =
    phase === "intro" || phase === "home" || phase === "gameStyle" || phase === "findMatch";
  const showAuth = Boolean(authView) || (phase !== "intro" && authReady && !signedIn);

  return (
    <div className={`app app--game${bootShell ? " app--booting" : ""}`}>
      {phase === "intro" ? (
        <SplashPage
          exiting={splashExiting}
          onFinished={handleSplashFinished}
          onExitComplete={handleSplashExitEnd}
        />
      ) : null}

      {phase === "home" && signedIn ? (
        <HomePage
          key={session?.playerId ?? "home"}
          onPlayVsLeoBest={() => setPhase("gameStyle")}
          onFindMatch={() => setPhase("findMatch")}
          onResume={handleResume}
        />
      ) : null}

      {phase === "findMatch" && signedIn ? (
        <FindMatchPage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
        />
      ) : null}

      {phase === "gameStyle" && signedIn ? (
        <GameStylePage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
          onPlay={handlePlay}
        />
      ) : null}

      {phase === "game" && signedIn ? (
        <GamePage
          key={gameKey}
          matchOptions={matchOptions}
          onMainMenu={handleMainMenu}
        />
      ) : null}

      {showAuth ? <AuthPage /> : null}
    </div>
  );
}

export default App;
