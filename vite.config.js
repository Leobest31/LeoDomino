import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { buildReleaseId } from "./src/monitoring/release.js";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryUpload = Boolean(sentryAuthToken && sentryOrg && sentryProject);
const releaseName = buildReleaseId(process.env.VITE_BUILD_NUMBER);

/** Map clean legal URLs to static HTML for Vite dev/preview (host rewrites cover production). */
function legalPrettyPathsPlugin() {
  const map = Object.freeze({
    "/privacy": "/privacy/index.html",
    "/terms": "/terms/index.html",
    "/support": "/support/index.html",
  });

  const rewrite = (req, _res, next) => {
    const raw = req.url ?? "";
    const pathOnly = raw.split("?")[0];
    const target = map[pathOnly];
    if (target) {
      const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
      req.url = `${target}${query}`;
    }
    next();
  };

  return {
    name: "leodomino-legal-pretty-paths",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  // Relative base so Capacitor native WebViews can load bundled dist assets offline.
  // Also valid for the web/PWA deploy (absolute hosting still works with relative asset URLs).
  base: "./",
  server: {
    // Temporary Quick Tunnel testing: Cloudflare Host header is *.trycloudflare.com.
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
  },
  plugins: [
    legalPrettyPathsPlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "brand/logo-official.png",
        "brand/icon-192.png",
        "brand/icon-512.png",
        "brand/apple-touch-icon.png",
        "brand/*.svg",
        "legal/legal.css",
        "privacy/index.html",
        "terms/index.html",
        "support/index.html",
      ],
      manifest: {
        name: "LeoDomino",
        short_name: "LeoDomino",
        description: "Professional offline double-six domino. Play anywhere — no account required.",
        theme_color: "#0a1210",
        background_color: "#08110e",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        lang: "ht",
        categories: ["games", "entertainment"],
        icons: [
          {
            src: "/brand/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/brand/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}"],
        navigateFallback: "/index.html",
        // Keep public legal pages out of the SPA shell fallback.
        navigateFallbackDenylist: [/^\/privacy(?:\/|$)/, /^\/terms(?:\/|$)/, /^\/support(?:\/|$)/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
    ...(sentryUpload
      ? [
          sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuthToken,
            telemetry: false,
            release: { name: releaseName },
            sourcemaps: {
              filesToDeleteAfterUpload: ["./dist/**/*.map"],
            },
          }),
        ]
      : []),
  ],
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: sentryUpload ? "hidden" : false,
    minify: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 600,
  },
});
