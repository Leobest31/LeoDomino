/**
 * Sprint 2B device UI capture — headless Chrome via CDP (native WebSocket).
 * Usage: node scripts/qa-device-ui.mjs
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
  { name: "iphone-se", width: 375, height: 667, players: 2 },
  { name: "iphone-14", width: 390, height: 844, players: 2 },
  { name: "android-360", width: 360, height: 800, players: 2 },
  { name: "android-360-3p", width: 360, height: 800, players: 3 },
  { name: "android-360-4p", width: 360, height: 800, players: 4 },
  { name: "iphone-14-4p", width: 390, height: 844, players: 4 },
  { name: "iphone-se-landscape", width: 667, height: 375, players: 2 },
  { name: "tablet-768", width: 768, height: 1024, players: 2 },
  { name: "tablet-768-4p", width: 768, height: 1024, players: 4 },
  { name: "desktop-1280", width: 1280, height: 800, players: 2 },
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

async function measureLayout(cdp) {
  const { result } = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const q = (s) => document.querySelector(s);
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          t: Math.round(r.top),
          l: Math.round(r.left),
          r: Math.round(r.right),
          b: Math.round(r.bottom),
        };
      };
      const cs = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : null);
      const page = q(".game-page");
      const mid = q(".game-page__mid");
      const side = q(".game-page__side-seats");
      const score = q(".game-page__hud-score");
      const reserve = q(".game-page__hud-reserve");
      const handBtns = [...document.querySelectorAll(".player-panel .domino--interactive")];
      const barBtns = [...document.querySelectorAll(".bottom-bar button")];
      const headerBtns = [...document.querySelectorAll(".header__icon-btn")];
      const sizes = (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        });
      const overflow = (el) => {
        if (!el) return null;
        return {
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          overflowX: el.scrollWidth > el.clientWidth + 1,
        };
      };
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        playersClass: page?.className ?? null,
        midOverflow: cs(mid, "overflow"),
        sideMaxWidth: cs(side, "max-width"),
        scoreWidthCss: cs(score, "width"),
        scoreRect: rect(score),
        reserveRect: rect(reserve),
        sideRect: rect(side),
        playerTray: overflow(q(".player-panel__tray")),
        opponentTop: rect(q(".opponent-panel--top")),
        opponentLeft: rect(q(".opponent-panel--left")),
        opponentRight: rect(q(".opponent-panel--right")),
        handTileSizes: sizes(handBtns),
        bottomBtnSizes: sizes(barBtns),
        headerBtnSizes: sizes(headerBtns),
        scoreLabelFont: cs(q(".scoreboard__label"), "font-size"),
        scoreLines: document.querySelectorAll(".scoreboard__line").length,
        pagePadding: page ? getComputedStyle(page).padding : null,
        bottomBarPad: q(".bottom-bar__inner") ? getComputedStyle(q(".bottom-bar__inner")).padding : null,
        felt: rect(q(".game-table__felt")),
        body: rect(q(".game-page__body")),
        header: rect(q(".header")),
        bottomBar: rect(q(".bottom-bar")),
        clippedByViewport: (() => {
          const els = [q(".header"), q(".bottom-bar"), q(".player-panel"), score, reserve, q(".opponent-panel--top")];
          return els.filter(Boolean).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              cls: el.className?.toString?.().split(" ")[0] || el.tagName,
              out:
                r.top < -1 ||
                r.left < -1 ||
                r.bottom > window.innerHeight + 1 ||
                r.right > window.innerWidth + 1,
              r: rect(el),
            };
          });
        })(),
      };
    })()`,
  });
  return result.value;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const chrome = findChrome();
  const userData = path.join(process.env.TEMP || "/tmp", "leodomino-qa-chrome-profile");
  const cdpPort = 9333;
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
    { stdio: "ignore" }
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
        mobile: vp.width < 1024,
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });

      await cdp.send("Page.navigate", { url: "about:blank" });
      await sleep(150);
      // Clear prior scripts by using evaluate on blank then set storage on next doc
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try{
          localStorage.removeItem("leodomino.match");
          localStorage.setItem("leodomino.playerCount","${vp.players}");
        }catch(e){}`,
      });
      const nav = await cdp.send("Page.navigate", { url: APP });
      let ready = false;
      let lastTitle = "";
      for (let i = 0; i < 100; i += 1) {
        const { result } = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `({
            ready: Boolean(document.querySelector(".game-page") && document.querySelector(".player-panel")),
            splash: Boolean(document.querySelector(".splash")),
            title: document.title,
            body: (document.body?.innerText || "").slice(0, 80),
            href: location.href
          })`,
        });
        lastTitle = JSON.stringify(result.value);
        if (result.value?.ready) {
          ready = true;
          break;
        }
        await sleep(200);
      }
      if (!ready) {
        report.push({ name: vp.name, error: "game-page not ready", detail: lastTitle, nav });
        console.error(`${vp.name}: not ready`, lastTitle);
        continue;
      }
      await sleep(700);
      // Force new match if needed so playerCount applies from storage on boot
      const { result: pc } = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const cls = document.querySelector(".game-page")?.className || "";
          const m = cls.match(/game-page--players-(\\d+)/);
          return m ? Number(m[1]) : null;
        })()`,
      });
      if (pc.value !== vp.players) {
        // Change via settings then new match
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('.header__icon-btn:last-of-type, .header__side--end .header__icon-btn')?.click()`,
        });
        await sleep(400);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const sel = document.querySelector('select[aria-label], .settings-panel__select');
            const selects = [...document.querySelectorAll('.settings-panel select')];
            const playerSel = selects.find(s => [...s.options].some(o => o.value === '3' || o.value === '4')) || selects[selects.length-1];
            if (playerSel) {
              playerSel.value = '${vp.players}';
              playerSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()`,
        });
        await sleep(200);
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('.settings-panel__close, .settings-backdrop')?.click()`,
        });
        await sleep(200);
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('.bottom-bar__new')?.click()`,
        });
        await sleep(900);
      }

      const metrics = await measureLayout(cdp);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const file = `${vp.name}.png`;
      await writeFile(path.join(OUT, file), Buffer.from(shot.data, "base64"));
      report.push({ name: vp.name, viewport: vp, metrics, file });
      const hand0 = metrics.handTileSizes?.[0];
      console.log(
        `${vp.name}: class=${metrics.playersClass} sideMax=${metrics.sideMaxWidth} score=${JSON.stringify(metrics.scoreRect)} hand0=${JSON.stringify(hand0)} btn0=${JSON.stringify(metrics.bottomBtnSizes?.[0])} lines=${metrics.scoreLines}`
      );
    }

    await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log("OK", path.join(OUT, "report.json"));
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
