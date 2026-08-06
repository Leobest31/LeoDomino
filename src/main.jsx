import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import { I18nProvider } from "./i18n";
import { AudioProvider } from "./audio";
import { PrefsProvider } from "./hooks/PrefsProvider.jsx";
import { applyTheme, applyTileSkin, loadPrefs } from "./persistence/index.js";
import "./styles/global.css";
import App from "./App.jsx";

const prefs = loadPrefs();
applyTheme(prefs.theme);
applyTileSkin(prefs.tileSkin);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>
      <PrefsProvider>
        <AudioProvider>
          <App />
        </AudioProvider>
      </PrefsProvider>
    </I18nProvider>
  </StrictMode>
);
