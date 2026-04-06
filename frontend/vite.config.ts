/// <reference types="vitest" />
import path from "path";
import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pdfRenderPath = path.resolve(__dirname, "pdf-render.html");
const financialQuotePdfRenderPath = path.resolve(__dirname, "financial-quote-pdf-render.html");
const calpinageRenderPath = path.resolve(__dirname, "calpinage-render.html");

export default defineConfig({
  plugins: [
    {
      name: "crm-html-spa-fallback",
      configureServer(server) {
        const fallback = (req: import("connect").IncomingMessage, res: import("http").ServerResponse, next: (err?: unknown) => void) => {
          if (!req.url) return next();
          const pathname = req.url.split("?")[0];
          if (req.url.startsWith("/crm.html/")) {
            req.url = "/crm.html";
            return next();
          }
          if (pathname === "/financial-quote-pdf-render" || req.url.startsWith("/financial-quote-pdf-render?")) {
            const url =
              "/financial-quote-pdf-render.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
            try {
              const html = fs.readFileSync(financialQuotePdfRenderPath, "utf-8");
              server.transformIndexHtml(url, html).then((transformed) => {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.statusCode = 200;
                res.end(transformed);
              }).catch((err) => next(err));
            } catch (err) {
              next(err);
            }
            return;
          }
          if (pathname === "/pdf-render" || req.url.startsWith("/pdf-render?")) {
            const url = "/pdf-render.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
            try {
              const html = fs.readFileSync(pdfRenderPath, "utf-8");
              server.transformIndexHtml(url, html).then((transformed) => {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.statusCode = 200;
                res.end(transformed);
              }).catch((err) => next(err));
            } catch (err) {
              next(err);
            }
            return;
          }
          if (pathname === "/calpinage-render" || req.url.startsWith("/calpinage-render?")) {
            const url = "/calpinage-render.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
            try {
              const html = fs.readFileSync(calpinageRenderPath, "utf-8");
              server.transformIndexHtml(url, html).then((transformed) => {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.statusCode = 200;
                res.end(transformed);
              }).catch((err) => next(err));
            } catch (err) {
              next(err);
            }
            return;
          }
          if (req.url.startsWith("/financial-quote-pdf-render/")) {
            req.url = "/financial-quote-pdf-render.html";
            return next();
          }
          if (req.url.startsWith("/pdf-render/")) {
            req.url = "/pdf-render.html";
            return next();
          }
          if (req.url.startsWith("/calpinage-render/")) {
            req.url = "/calpinage-render.html";
            return next();
          }
          next();
        };
        return () => {
          (server.middlewares as import("connect").Server).stack.unshift({ route: "", handle: fallback });
        };
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  root: ".",
  build: {
    outDir: "dist-crm",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        crm: "./crm.html",
        "pdf-render": "./pdf-render.html",
        "financial-quote-pdf-render": "./financial-quote-pdf-render.html",
        "calpinage-render": "./calpinage-render.html",
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
      "/auth": process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
      "/pdf-assets": process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
    },
  },
});
