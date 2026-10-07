import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import { APP_NAME, APP_SHORT_NAME, APP_SLUG } from "./src/config/app.ts";

export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:5183" } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "GUIDE.md"],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: "Offline-first rest-pause training tracker",
        theme_color: "#101311",
        background_color: "#101311",
        display: "standalone",
        start_url: "/",
        scope: "/",
        id: APP_SLUG,
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,svg,png,md}"],
        runtimeCaching: [{
          // index.html: network-first so updates land; fall back to cache offline.
          // (Precaching index.html + cache-first navigation caused stale-hash 404s
          // on phones after rebuilds — the reported "doesn't load".)
          urlPattern: ({ request }) => request.mode === "navigate",
          handler: "NetworkFirst",
          options: { cacheName: "pages", networkTimeoutSeconds: 3 },
        }],
      },
    }),
  ],
  define: { __APP_NAME__: JSON.stringify(APP_NAME) },
});
