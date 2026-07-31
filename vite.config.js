import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: true,
    chunkSizeWarningLimit: 600,
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
});
