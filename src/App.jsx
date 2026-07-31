import { useEffect, useState } from "react";
import SplashPage from "./pages/SplashPage";
import GamePage from "./pages/GamePage";
import "./App.css";

/**
 * Launch splash once → game table forever.
 * Game mounts under the splash so the handoff never flashes blank.
 */
function App() {
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);

  useEffect(() => {
    // Ensure game chrome paints before splash exits (seamless handoff).
    document.documentElement.dataset.boot = splashVisible ? "splash" : "game";
  }, [splashVisible]);

  const handleSplashFinished = () => {
    setSplashExiting(true);
  };

  const handleSplashExitEnd = () => {
    setSplashVisible(false);
    setSplashExiting(false);
  };

  return (
    <div className={`app app--game${splashVisible ? " app--booting" : ""}`}>
      <GamePage />

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
