import { useEffect, useState } from "react";
import SplashPage from "./pages/SplashPage";
import GamePage from "./pages/GamePage";
import "./App.css";

/**
 * Launch splash → game table.
 * Main Menu from match-over returns to the splash presentation.
 */
function App() {
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const [gameKey, setGameKey] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.boot = splashVisible ? "splash" : "game";
  }, [splashVisible]);

  const handleSplashFinished = () => {
    setSplashExiting(true);
  };

  const handleSplashExitEnd = () => {
    setSplashVisible(false);
    setSplashExiting(false);
  };

  const handleMainMenu = () => {
    setGameKey((key) => key + 1);
    setSplashExiting(false);
    setSplashVisible(true);
  };

  return (
    <div className={`app app--game${splashVisible ? " app--booting" : ""}`}>
      <GamePage key={gameKey} onMainMenu={handleMainMenu} />

      {splashVisible ? (
        <SplashPage
          exiting={splashExiting}
          onFinished={handleSplashFinished}
          onExitComplete={handleSplashExitEnd}
        />
      ) : null}
    </div>
  );
}

export default App;
