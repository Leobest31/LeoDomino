import { useEffect, useState } from "react";
import SplashPage from "./pages/SplashPage";
import GameSetupPage from "./pages/GameSetupPage";
import GamePage from "./pages/GamePage";
import "./App.css";

/** @typedef {"intro" | "setup" | "game"} AppPhase */

/**
 * Startup: brand intro → game setup → table.
 * Match mounts only after PLAY (or Resume). Main Menu returns to setup.
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
    setPhase("setup");
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
    setPhase("setup");
  };

  return (
    <div
      className={`app app--game${
        phase === "intro" || phase === "setup" ? " app--booting" : ""
      }`}
    >
      {phase === "intro" ? (
        <SplashPage
          exiting={splashExiting}
          onFinished={handleSplashFinished}
          onExitComplete={handleSplashExitEnd}
        />
      ) : null}

      {phase === "setup" ? (
        <GameSetupPage onPlay={handlePlay} onResume={handleResume} />
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
