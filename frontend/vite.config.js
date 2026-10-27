import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const API_TARGET = process.env.VITE_API_TARGET || "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Our own service worker (src/sw.js): Workbox precaching + Web Push handlers.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: false, // registered from src/main.jsx (no inline script → strict CSP)
      registerType: "autoUpdate",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
      devOptions: { enabled: true, type: "module" }, // push notifications work in `npm run dev` too
      manifest: {
        name: "ChainWill — Digital Will & Inheritance",
        short_name: "ChainWill",
        description: "A dead-man's-switch will on the blockchain: check in, or your executor passes your assets on.",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "/app",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: { "/api": { target: API_TARGET, changeOrigin: false } },
  },
  preview: {
    port: Number(process.env.VITE_PORT || 5173),
    proxy: { "/api": { target: API_TARGET, changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.js"],
    css: false,
  },
});
