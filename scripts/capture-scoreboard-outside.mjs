/**
 * Capture scoreboard placement outside the green table.
 * Usage: node scripts/capture-scoreboard-outside.mjs
 * Requires: npm run dev on QA_APP_URL (default http://localhost:5173/)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".qa-screens");
const APP = process.env.QA_APP_URL || "http://localhost:5173/";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const VIEWPORTS = [
  { name: "scoreboard-outside-desktop", width: 1280, height: 800 },
  { name: "scoreboard-outside-tablet-landscape", width: 1024, height: 768 },
  { name: "scoreboard-outside-tablet-portrait", width: 768, height: 1024 },
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge not found");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForJson(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (e) => reject(e.error || e));
  });
}

async function measure(cdp) {
  const { result } = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          t: Math.round(r.top),
          l: Math.round(r.left),
          r: Math.round(r.right),
          b: Math.round(r.bottom),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      };
      const chrome = q(".game-page__chrome");
      const score = q(".game-page__hud-score");
      const mute = q(".header__side--start .header__icon-btn");
      const felt = q(".game-table__felt");
      const stage = q(".game-page__table-stage");
      const reserve = q(".game-page__hud-reserve");
      const newMatch = q(".bottom-bar__new");
      const bottomBar = q(".bottom-bar");
      const opponent = q(".game-page__top-hud-center .opponent-panel");
      const logo = q(".header__brand .brand-logo") || q(".header__brand");
      const sr = rect(score);
      const fr = rect(felt);
      const mr = rect(mute);
      const or = rect(opponent);
      const lr = rect(logo);
      const st = rect(stage);
      const cr = rect(chrome);
      const rr = rect(reserve);
      const nr = rect(newMatch);
      const overlap = (a, b) =>
        a && b
          ? !(a.b <= b.t || a.t >= b.b || a.r <= b.l || a.l >= b.r)
          : null;
      const belowMute = sr && mr ? sr.t >= mr.b - 2 : null;
      const scoreInStage = score && stage ? stage.contains(score) : null;
      const scoreInChrome = score && chrome ? chrome.contains(score) : null;
      const reserveInStage = reserve && stage ? stage.contains(reserve) : null;
      const reserveInBar = reserve && bottomBar ? bottomBar.contains(reserve) : null;
      const reserveAboveNew =
        rr && nr ? rr.b <= nr.t + 1 && Math.abs(rr.r - nr.r) <= 24 : null;
      const reserveNewGap = rr && nr ? nr.t - rr.b : null;
      const gapFelt = sr && fr ? fr.t - sr.b : null;
      const gapStage = sr && st ? st.t - sr.b : null;
      const chromeAboveStage = cr && st ? st.t >= cr.b - 1 : null;
      return {
        scoreRect: sr,
        chromeRect: cr,
        muteRect: mr,
        feltRect: fr,
        stageRect: st,
        reserveRect: rr,
        newMatchRect: nr,
        opponentRect: or,
        logoRect: lr,
        gapFelt,
        gapStage,
        chromeH: cr?.h ?? null,
        feltH: fr?.h ?? null,
        chromeAboveStage,
        overlapFelt: overlap(sr, fr),
        overlapOpponent: overlap(sr, or),
        overlapLogo: overlap(sr, lr),
        reserveOverlapFelt: overlap(rr, fr),
        reserveOverlapNew: overlap(rr, nr),
        reserveInStage,
        reserveInBar,
        reserveAboveNew,
        reserveNewGap,
        belowMute,
        scoreInStage,
        scoreInChrome,
        scoreParent: score?.parentElement?.className ?? null,
        clipped: (() => {
          const els = [
            score,
            mute,
            logo,
            opponent,
            reserve,
            newMatch,
            q(".bottom-bar"),
            q(".player-panel"),
          ].filter(Boolean);
          return els
            .map((el) => {
              const r = el.getBoundingClientRect();
              const out =
                r.top < -1 ||
                r.left < -1 ||
                r.bottom > window.innerHeight + 1 ||
                r.right > window.innerWidth + 1;
              return out
                ? { cls: el.className?.toString?.().split(" ")[0] || el.tagName, r: rect(el) }
                : null;
            })
            .filter(Boolean);
        })(),
      };
    })()`,
  });
  return result.value;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const chrome = findChrome();
  const userData = path.join(process.env.TEMP || "/tmp", "leodomino-qa-score-outside");
  const cdpPort = 9335;
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userData}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore", shell: false }
  );

  const report = [];
  try {
    await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
    const list = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
    const pageInfo = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageInfo) throw new Error("No page target");
    const cdp = new Cdp(await connectWs(pageInfo.webSocketDebuggerUrl));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const vp of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: vp.width < 1100,
      });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try{
          localStorage.removeItem("leodomino.match");
          localStorage.setItem("leodomino.playerCount","2");
        }catch(e){}`,
      });
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await cdp.send("Page.navigate", { url: APP });

      // Splash → setup
      let onSetup = false;
      for (let i = 0; i < 80; i += 1) {
        const { result } = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `Boolean(document.querySelector(".game-setup__play"))`,
        });
        if (result.value) {
          onSetup = true;
          break;
        }
        // Tap splash if present to advance
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector(".splash, .splash-page, [data-splash]")?.click?.()`,
        });
        await sleep(200);
      }
      if (!onSetup) {
        report.push({ name: vp.name, error: "setup not ready" });
        console.error(`${vp.name}: setup not ready`);
        continue;
      }

      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector(".game-setup__play")?.click()`,
      });

      let ready = false;
      for (let i = 0; i < 100; i += 1) {
        const { result } = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `Boolean(document.querySelector(".game-page") && document.querySelector(".scoreboard") && document.querySelector(".game-table__felt"))`,
        });
        if (result.value) {
          ready = true;
          break;
        }
        await sleep(200);
      }
      if (!ready) {
        report.push({ name: vp.name, error: "game not ready" });
        console.error(`${vp.name}: game not ready`);
        continue;
      }
      await sleep(800);
      const metrics = await measure(cdp);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const file = `${vp.name}.png`;
      await writeFile(path.join(OUT, file), Buffer.from(shot.data, "base64"));
      const ok =
        metrics.overlapFelt === false &&
        metrics.overlapOpponent === false &&
        metrics.overlapLogo === false &&
        metrics.belowMute === true &&
        metrics.scoreInStage === false &&
        metrics.scoreInChrome === true &&
        metrics.chromeAboveStage === true &&
        (metrics.gapStage ?? 0) >= 5 &&
        metrics.reserveOverlapFelt === false &&
        metrics.reserveOverlapNew === false &&
        metrics.reserveInStage === false &&
        metrics.reserveInBar === true &&
        metrics.reserveAboveNew === true &&
        (metrics.reserveNewGap ?? 0) >= 4 &&
        (metrics.clipped?.length ?? 0) === 0;
      report.push({ name: vp.name, viewport: vp, metrics, file, ok });
      console.log(
        `${vp.name}: ok=${ok} feltH=${metrics.feltH} reserveInBar=${metrics.reserveInBar} reserveAboveNew=${metrics.reserveAboveNew} reserveGap=${metrics.reserveNewGap} reserveOverlapFelt=${metrics.reserveOverlapFelt} scoreOutside=${metrics.scoreInStage === false}`
      );
    }

    await writeFile(path.join(OUT, "scoreboard-outside-report.json"), JSON.stringify(report, null, 2));
    const failed = report.filter((r) => r.ok === false || r.error);
    if (failed.length) {
      console.error("FAILED", failed.map((f) => f.name).join(", "));
      process.exitCode = 1;
    } else {
      console.log("OK", path.join(OUT, "scoreboard-outside-report.json"));
    }
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
