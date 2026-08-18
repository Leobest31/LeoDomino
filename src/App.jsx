import { useEffect, useState } from "react";
import SplashPage from "./pages/SplashPage";
import HomePage from "./pages/HomePage";
import GameStylePage from "./pages/GameStylePage";
import GamePage from "./pages/GamePage";
import "./App.css";

/** @typedef {"intro" | "home" | "gameStyle" | "game"} AppPhase */

/**
 * Startup: brand intro → Home → Game Style → table.
 * PLAY VS LEOBEST opens Game Style. PLAY on that screen starts the 1v1 match.
 * Main Menu returns to Home.
 */
function App() {
  /** @type {[AppPhase, function]} */
  const [phase, setPhase] = useState("intro");
  const [splashExiting, setSplashExiting] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [matchOptions, setMatchOptions] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.boot = phase;
  }, [phase]);

  const handleSplashFinished = () => {
    setSplashExiting(true);
  };

  const handleSplashExitEnd = () => {
    setSplashExiting(false);
    setPhase("home");
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
    phase === "intro" || phase === "home" || phase === "gameStyle";

  return (
    <div className={`app app--game${bootShell ? " app--booting" : ""}`}>
      {phase === "intro" ? (
        <SplashPage
          exiting={splashExiting}
          onFinished={handleSplashFinished}
          onExitComplete={handleSplashExitEnd}
        />
      ) : null}

      {phase === "home" ? (
        <HomePage
          onPlayVsLeoBest={() => setPhase("gameStyle")}
          onResume={handleResume}
        />
      ) : null}

      {phase === "gameStyle" ? (
        <GameStylePage
          onBack={() => setPhase("home")}
          onMainMenu={() => setPhase("home")}
          onPlay={handlePlay}
        />
      ) : null}

      {phase === "game" ? (
        <GamePage
          key={gameKey}
          matchOptions={matchOptions}
          onMainMenu={handleMainMenu}
        />
      ) : null}
    </div>
  );
}

export default App;
