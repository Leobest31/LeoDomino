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
import { AuthProvider } from "./auth";
import { PrefsProvider } from "./hooks/PrefsProvider.jsx";
import { applyTheme, applyTileSkin, loadPrefs } from "./persistence/index.js";
import { MonitoringErrorBoundary, initMonitoring } from "./monitoring";
import { capturePendingReferralFromWindow } from "./online/referrals.js";
import "./styles/global.css";
import App from "./App.jsx";

const prefs = loadPrefs();
applyTheme(prefs.theme);
applyTileSkin(prefs.tileSkin);

async function boot() {
  capturePendingReferralFromWindow();
  await initMonitoring();
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <I18nProvider>
        <MonitoringErrorBoundary>
          <PrefsProvider>
            <AudioProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </AudioProvider>
          </PrefsProvider>
        </MonitoringErrorBoundary>
      </I18nProvider>
    </StrictMode>
  );
}

void boot();
