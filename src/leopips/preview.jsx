/**
 * Isolated LeoPips preview — not used by index.html / App.jsx.
 * Local: /src/leopips/preview.html while `npm run dev` is running.
 * Hosted: separate Vercel project only — never testers / production / App.jsx.
 *
 *   / or ?screen=home
 *   ?screen=stake&balance=5240
 *   ?inspect=1
 *   ?win=1&payout=300
 *
 * Default wallet fixture is 1,000. Use ?balance= to preview other amounts.
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import LeoPipsCoin from "./LeoPipsCoin.jsx";
import LeoPipsHomePage from "./LeoPipsHomePage.jsx";
import LeoPipsStakePage from "./LeoPipsStakePage.jsx";
import LeoPipsWinOverlay from "./LeoPipsWinOverlay.jsx";
import { LEOPIPS_PREVIEW_DEFAULT_BALANCE, LEOPIPS_STAKE_TIERS } from "./leopipsEconomy.js";
import "./LeoPipsStakePage.css";
import "../styles/global.css";

function readParam(name, fallback) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) ?? fallback;
}

function initialScreen() {
  if (readParam("inspect", "") === "1") return "inspect";
  if (readParam("win", "") === "1") return "stake";
  const screen = readParam("screen", "home");
  return screen === "stake" ? "stake" : "home";
}

export function Preview() {
  const balance = Number(readParam("balance", String(LEOPIPS_PREVIEW_DEFAULT_BALANCE)));
  const styleId = readParam("style", "classic");
  const initialWin = readParam("win", "") === "1";
  const payout = Number(readParam("payout", "300"));
  const [screen, setScreen] = useState(initialScreen);
  const [open, setOpen] = useState(initialWin);
  const stake = useMemo(() => (payout >= 300 ? 150 : 100), [payout]);

  if (screen === "inspect") {
    return (
      <div className="app" style={{ height: "100%", overflow: "auto", background: "#05070c", padding: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", maxWidth: "26rem", margin: "0 auto" }}>
          {LEOPIPS_STAKE_TIERS.map((value) => (
            <figure key={value} style={{ margin: 0, textAlign: "center", color: "#f2ede5" }}>
              <LeoPipsCoin stake={value} size={220} />
              <figcaption>{value}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    );
  }

  if (screen === "home") {
    return (
      <div className="app" style={{ height: "100%", minHeight: "100svh", overflow: "hidden" }}>
        <LeoPipsHomePage balance={balance} onPlayOnline={() => setScreen("stake")} />
      </div>
    );
  }

  return (
    <div className="app" style={{ height: "100%", minHeight: "100svh", overflow: "hidden" }}>
      <LeoPipsStakePage
        styleId={styleId}
        balance={balance}
        onBack={() => setScreen("home")}
        onFindMatch={() => setOpen(true)}
        onPlayWithFriends={() => {}}
      />
      <LeoPipsWinOverlay
        open={open}
        payout={payout}
        stake={stake}
        onContinue={() => setOpen(false)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
