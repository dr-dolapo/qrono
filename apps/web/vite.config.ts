import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development, send API and live-event WebSocket calls to `wrangler dev` (apps/api).
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
    },
  },
});
