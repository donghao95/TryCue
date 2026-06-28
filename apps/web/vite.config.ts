import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": apiProxyTarget,
      "/uploads": apiProxyTarget
    }
  }
});
