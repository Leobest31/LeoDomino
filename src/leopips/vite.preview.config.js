/**
 * Isolated LeoPips preview build. Not used by the live app.
 *
 *   npx vite build --config src/leopips/vite.preview.config.js
 *
 * Output goes to a temp folder, then to a SEPARATE Vercel project.
 * Do not point this at the live testers project or production.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = resolve(process.env.TEMP || "/tmp", "leopips-preview-dist");

function slimPreviewAssets() {
  return {
    name: "leopips-slim-preview-assets",
    enforce: "pre",
    load(id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/src/assets/index.js")) return null;
      return `export { default as logoOfficial } from "./brand/logo-official.png";
export { default as homeDominos } from "./home/dominos.png";
export { default as homeAvatarLion } from "./home/avatar-lion.png";
export { default as homeLeagueLion } from "./home/league-lion-head.png";
export { default as homeLeoBestLion } from "./home/leobest-lion-head.png";
export { default as homeStoreChest } from "./home/store-chest.png";
export { default as homeNavPlayGlow } from "./home/nav-play-glow.svg";
export { default as homeStoreCoinWrap } from "./home/store-coin-wrap.svg";
export { default as homeOnlineDot } from "./home/online-dot.svg";
export { default as homeIconMenu } from "./home/icon-menu.svg";
export { default as homeIconBell } from "./home/icon-bell.svg";
export { default as homeIconShield } from "./home/icon-shield.svg";
export { default as homeEarthGlobe } from "./home/earth-globe.png";
export { default as homeFriendUsers } from "./home/friend-users-3d.png";
export { default as homeLock3d } from "./home/lock-3d.png";
export { default as homeIconTrophy } from "./home/icon-trophy.svg";
export { default as homeIconHouse } from "./home/icon-house.svg";
export { default as homeIconAward } from "./home/icon-award.svg";
export { default as homeIconCart } from "./home/icon-cart.svg";
export { default as homeIconMenuNav } from "./home/icon-menu-nav.svg";
export { default as homeDotOn } from "./home/dot-on.svg";
export { default as homeDotOff } from "./home/dot-off.svg";
`;
    },
  };
}

function flattenPreviewHtml() {
  return {
    name: "leopips-flatten-preview-html",
    closeBundle() {
      const nested = resolve(outDir, "src/leopips/preview.html");
      const index = resolve(outDir, "index.html");
      if (!existsSync(nested)) {
        throw new Error(`LeoPips preview HTML missing at ${nested}`);
      }
      mkdirSync(outDir, { recursive: true });
      renameSync(nested, index);
      rmSync(resolve(outDir, "src"), { recursive: true, force: true });
      writeFileSync(
        resolve(outDir, "vercel.json"),
        `${JSON.stringify(
          {
            headers: [
              {
                source: "/(.*)",
                headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
              },
            ],
          },
          null,
          2
        )}\n`
      );
    },
  };
}

export default defineConfig({
  root: repoRoot,
  publicDir: false,
  base: "/",
  plugins: [react(), slimPreviewAssets(), flattenPreviewHtml()],
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: resolve(repoRoot, "src/leopips/preview.html"),
    },
  },
});
