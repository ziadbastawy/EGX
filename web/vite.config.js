import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleFundsPhotoHttp } from "../src/lib/runFundsPhoto.js";
import { handleFundsAdviceHttp } from "../src/lib/runFundsAdvice.js";
import { handleAiPingHttp } from "../src/lib/runAiPing.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function fundsAiPlugin() {
  return {
    name: "egx-funds-ai",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = String(req.url || "").split("?")[0];
        if (req.method !== "POST") return next();
        // Do NOT hijack /api/ask — local scan needs Node picks for result cards.
        const run =
          url === "/api/funds-photo"
            ? handleFundsPhotoHttp
            : url === "/api/funds-advice"
              ? handleFundsAdviceHttp
              : url === "/api/ai-ping"
                ? handleAiPingHttp
                : null;
        if (!run) return next();
        run(req, res).catch((err) => {
          const status = err.status || 500;
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: err.message || String(err) }));
        });
      });
    },
  };
}

export default defineConfig({
  root,
  // GitHub Pages project sites need a subpath, e.g. /EGX/
  base: process.env.VITE_BASE || "/",
  plugins: [vue(), fundsAiPlugin()],
  publicDir: path.join(root, "public"),
  server: {
    port: 5173,
    open: true,
    fs: { allow: [path.join(root, "..")] },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        timeout: 180_000,
        proxyTimeout: 180_000,
        bypass(req) {
          const u = String(req.url || "");
          if (req.method !== "POST") return;
          if (
            u.startsWith("/api/funds-photo") ||
            u.startsWith("/api/funds-advice") ||
            u.startsWith("/api/ai-ping")
          ) {
            return req.url;
          }
        },
      },
    },
  },
});
