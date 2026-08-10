/**
 * Render board-chain layout screenshots (SVG via headless Chrome).
 * Usage: node scripts/capture-board-chain.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  layoutBoard,
  LOCKED_BOARD_TILE_SHORT_PX,
  LOCKED_BOARD_TILE_LONG_PX,
} from "../src/board/DominoLayoutEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".qa-screens");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800, feltW: 1180, feltH: 520 },
  { name: "tablet-landscape", width: 1024, height: 768, feltW: 940, feltH: 480 },
  { name: "tablet-portrait", width: 768, height: 1024, feltW: 700, feltH: 620 },
];

const LENGTHS = [21, 28];
const locked = { w: LOCKED_BOARD_TILE_SHORT_PX, h: LOCKED_BOARD_TILE_LONG_PX };

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

function mkBi(total) {
  const right = Math.floor((total - 1) / 2);
  const left = total - 1 - right;
  const tiles = [];
  for (let i = left; i >= 1; i -= 1) {
    tiles.push(
      i % 4 === 0
        ? { id: `L${i}`, left: i % 7, right: i % 7 }
        : { id: `L${i}`, left: i % 7, right: (i + 1) % 7 }
    );
  }
  tiles.push({ id: "c", left: 6, right: 6 });
  for (let i = 1; i <= right; i += 1) {
    tiles.push(
      i % 4 === 0
        ? { id: `R${i}`, left: i % 7, right: i % 7 }
        : { id: `R${i}`, left: i % 7, right: (i + 1) % 7 }
    );
  }
  return { tiles, centerIndex: left };
}

function buildHtml(vp, n, layout) {
  const { placements, tileScale } = layout;
  const short = placements[0] ? Math.min(placements[0].w, placements[0].h) : 0;
  const tiles = placements
    .map(
      (p) =>
        `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}" rx="4" fill="#f4efe4" stroke="#1a1208" stroke-width="1.5"/>`
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  html,body{margin:0;background:#050807;width:${vp.width}px;height:${vp.height}px;overflow:hidden;font-family:Segoe UI,sans-serif}
  .wrap{display:flex;align-items:center;justify-content:center;width:100%;height:100%}
  .felt{background:linear-gradient(160deg,#1a5c38,#0d3d24);border:10px solid #3d220e;border-radius:14px;box-shadow:inset 0 0 40px rgba(0,0,0,.35)}
  .meta{position:absolute;left:16px;top:12px;color:#ebc84a;font-size:13px;line-height:1.45}
  </style></head><body>
  <div class="meta">${vp.name} · n=${n} · scale=${tileScale.toFixed(3)} · short=${short.toFixed(1)}px · felt ${vp.feltW}×${vp.feltH}</div>
  <div class="wrap"><svg class="felt" width="${vp.feltW}" height="${vp.feltH}" viewBox="0 0 ${vp.feltW} ${vp.feltH}">${tiles}</svg></div>
  </body></html>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = [];
  const chrome = findChrome();
  const userData = path.join(process.env.TEMP || "/tmp", "leodomino-qa-board-chain");
  const cdpPort = 9336;
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userData}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore", shell: false }
  );

  try {
    await waitForJson(`http://127.0.0.1:${cdpPort}/json/version`);
    const list = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
    const pageInfo = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageInfo) throw new Error("No page target");
    const cdp = new Cdp(await connectWs(pageInfo.webSocketDebuggerUrl));
    await cdp.send("Page.enable");

    for (const vp of VIEWPORTS) {
      for (const n of LENGTHS) {
        const { tiles, centerIndex } = mkBi(n);
        const layout = layoutBoard(
          tiles,
          centerIndex,
          { width: vp.feltW, height: vp.feltH },
          locked,
          { hudRight: 0, hudLeft: 0, maxScale: 1 }
        );
        const html = buildHtml(vp, n, layout);
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 2,
          mobile: vp.width < 1100,
        });
        await cdp.send("Page.navigate", { url });
        await sleep(400);
        const shot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
        });
        const file = `board-chain-${n}-${vp.name}.png`;
        await writeFile(path.join(OUT, file), Buffer.from(shot.data, "base64"));
        const short = layout.placements[0]
          ? Math.min(layout.placements[0].w, layout.placements[0].h)
          : 0;
        report.push({
          file,
          viewport: vp,
          n,
          scale: layout.tileScale,
          short,
          count: layout.placements.length,
        });
        console.log(
          `${file}: scale=${layout.tileScale.toFixed(3)} short=${short.toFixed(1)} count=${layout.placements.length}`
        );
      }
    }
    await writeFile(path.join(OUT, "board-chain-report.json"), JSON.stringify(report, null, 2));
    console.log("OK", path.join(OUT, "board-chain-report.json"));
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
