/// <reference types="vitest" />
import path from "path";
import fs from "fs";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const pdfRenderPath = path.resolve(__dirname, "pdf-render.html");
const financialQuotePdfRenderPath = path.resolve(__dirname, "financial-quote-pdf-render.html");
const calpinageRenderPath = path.resolve(__dirname, "calpinage-render.html");
const dp2DevHtmlPath = path.resolve(__dirname, "dp2.html");

/** Parité prod (Vercel) : rewrites `/{nom}` → `/{nom}.html` — le backend Playwright ouvre des URLs en `.html`. */

/** Sources ES sous `frontend/calpinage/` — ne pas envoyer au backend (bundles protégés sous `calpinage-legacy-assets`). */
const CALPINAGE_SRC_ROOT = path.resolve(__dirname, "calpinage");

/**
 * Si un fichier existe localement dans `frontend/calpinage/**`, Vite doit le servir.
 * Sinon la requête part vers le backend (JWT / renderToken sur les bundles legacy).
 */
function calpinageProxyBypass(
  req: import("http").IncomingMessage
): string | false {
  const raw = req.url?.split("?")[0] ?? "";
  if (!raw.startsWith("/calpinage/")) return false;
  const sub = raw.slice("/calpinage/".length);
  if (!sub || sub.includes("..")) return false;
  const candidate = path.resolve(CALPINAGE_SRC_ROOT, sub);
  if (!candidate.startsWith(CALPINAGE_SRC_ROOT)) return false;
  try {
    if (fs.statSync(candidate).isFile()) return raw;
  } catch {
    /* absent */
  }
  return false;
}

/** Lot 7 — dp-tool + dépendances résolues par le loader (`../../shared`, `../config`). */
const DP_TOOL_DIR = path.resolve(__dirname, "dp-tool");
const DP_SHARED_ROOT = path.resolve(__dirname, "../shared");
const DP_CONFIG_ROOT = path.resolve(__dirname, "config");

const DP_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

function dpMimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return DP_MIME[ext] || "application/octet-stream";
}

function dpPathInsideDir(candidate: string, dir: string): boolean {
  const rel = path.relative(dir, candidate);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Copie récursive sans `node_modules` / `.git` (évite un dist énorme si dépendances locales). */
function copyDpToolTree(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDpToolTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

type DpToolStaticPluginOpts = {
  /** Corps JS : définit les variables runtime publiques pour scripts non bundlés (dp-tool, PDF, etc.). */
  makeVitePublicRuntimeJs: () => string;
};

/**
 * Dev : sert `/dp-tool/**`, `/shared/panel-dimensions.js` uniquement, `/config/**` (frontend/config).
 * Build : copie les mêmes arbres dans `dist-crm/` pour alignement avec `getDefaultDpAssetBase()` du loader.
 */
function dpToolStaticPlugin(opts: DpToolStaticPluginOpts): Plugin {
  const { makeVitePublicRuntimeJs } = opts;
  return {
    name: "dp-tool-static-and-deps",
    configureServer(server) {
      const handler = (
        req: import("connect").IncomingMessage,
        res: import("http").ServerResponse,
        next: (err?: unknown) => void
      ) => {
        if (!req.url) return next();
        const pathname = req.url.split("?")[0] ?? "";

        let filePath: string | null = null;

        if (pathname === "/dp-tool" || pathname === "/dp-tool/") {
          filePath = path.join(DP_TOOL_DIR, "index.html");
        } else if (pathname.startsWith("/dp-tool/")) {
          const resolved = path.resolve(DP_TOOL_DIR, pathname.slice("/dp-tool/".length));
          if (!dpPathInsideDir(resolved, DP_TOOL_DIR)) {
            return next();
          }
          filePath = resolved;
        } else if (pathname === "/shared/panel-dimensions.js") {
          const resolved = path.join(DP_SHARED_ROOT, "panel-dimensions.js");
          if (!dpPathInsideDir(resolved, DP_SHARED_ROOT)) {
            return next();
          }
          filePath = resolved;
        } else if (pathname.startsWith("/config/")) {
          if (pathname === "/config/vite-public-runtime.js") {
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
            res.end(makeVitePublicRuntimeJs());
            return;
          }
          const resolved = path.resolve(DP_CONFIG_ROOT, pathname.slice("/config/".length));
          if (!dpPathInsideDir(resolved, DP_CONFIG_ROOT)) {
            return next();
          }
          filePath = resolved;
        } else {
          return next();
        }

        if (!filePath || !fs.existsSync(filePath)) {
          return next();
        }
        const st = fs.statSync(filePath);
        if (!st.isFile()) {
          return next();
        }

        res.setHeader("Content-Type", dpMimeFor(filePath));
        const stream = fs.createReadStream(filePath);
        stream.on("error", () => next());
        stream.pipe(res);
      };

      return () => {
        (server.middlewares as import("connect").Server).stack.unshift({ route: "", handle: handler });
      };
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist-crm");
      if (!fs.existsSync(outDir)) {
        return;
      }
      copyDpToolTree(DP_TOOL_DIR, path.join(outDir, "dp-tool"));

      const destShared = path.join(outDir, "shared");
      fs.mkdirSync(destShared, { recursive: true });
      const panelSrc = path.join(DP_SHARED_ROOT, "panel-dimensions.js");
      if (fs.existsSync(panelSrc)) {
        fs.copyFileSync(panelSrc, path.join(destShared, "panel-dimensions.js"));
      }

      const destConfig = path.join(outDir, "config");
      fs.mkdirSync(destConfig, { recursive: true });
      const ffSrc = path.join(DP_CONFIG_ROOT, "featureFlags.js");
      if (fs.existsSync(ffSrc)) {
        fs.copyFileSync(ffSrc, path.join(destConfig, "featureFlags.js"));
      }
      fs.writeFileSync(
        path.join(destConfig, "vite-public-runtime.js"),
        makeVitePublicRuntimeJs(),
        "utf-8"
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "..");
  const makeVitePublicRuntimeJs = () => {
    const env = loadEnv(mode, repoRoot, "VITE_");
    const key =
      env.VITE_GOOGLE_MAPS_API_KEY ??
      (process.env.VITE_GOOGLE_MAPS_API_KEY || "");
    const mapTilerStyleUrl = String(
      env.VITE_MAPTILER_STYLE_URL ?? process.env.VITE_MAPTILER_STYLE_URL ?? ""
    ).trim();
    const mapTilerKey = String(
      env.VITE_MAPTILER_KEY ?? process.env.VITE_MAPTILER_KEY ?? ""
    ).trim();
    const apiUrl = String(
      env.VITE_API_URL ?? process.env.VITE_API_URL ?? ""
    ).trim();
    return `(()=>{var k=${JSON.stringify(key)};var a=${JSON.stringify(apiUrl)};var ms=${JSON.stringify(mapTilerStyleUrl)};var mk=${JSON.stringify(mapTilerKey)};if(typeof window!=="undefined"){window.__VITE_GOOGLE_MAPS_API_KEY__=k;window.__VITE_API_URL__=a;window.__VITE_MAPTILER_STYLE_URL__=ms;window.__VITE_MAPTILER_KEY__=mk;if(!window.__DP2_MAPTILER_STYLE_URL__)window.__DP2_MAPTILER_STYLE_URL__=ms;if(!window.__DP2_MAPTILER_KEY__)window.__DP2_MAPTILER_KEY__=mk;}})();`;
  };

  return {
  /** Même racine que `loadEnv(..., repoRoot, "VITE_")` : `.env` à la racine du dépôt (monorepo) + parité Vercel. */
  envDir: repoRoot,
  plugins: [
    dpToolStaticPlugin({ makeVitePublicRuntimeJs }),
    {
      name: "index-html-spa-fallback",
      configureServer(server) {
        const isSpaIndexPath = (p: string): boolean => {
          if (p === "/" || p === "/index.html") return false;
          if (p.startsWith("/@") || p.startsWith("/node_modules/") || p.startsWith("/src/")) return false;
          if (p.startsWith("/assets/")) return false;
          if (p === "/dp-tool" || p.startsWith("/dp-tool/")) return false;
          if (p.startsWith("/config/") || p.startsWith("/calpinage/") || p.startsWith("/shared/")) return false;
          if (/\.(ico|png|jpe?g|gif|svg|webp|css|mjs?|map|json|woff2?|ttf|eot|pdf|html?)$/i.test(p)) return false;
          if (p.startsWith("/api") || p.startsWith("/auth") || p.startsWith("/pdf-assets")) return false;
          if (
            p.startsWith("/financial-quote-pdf-render") ||
            p.startsWith("/pdf-render") ||
            p.startsWith("/calpinage-render") ||
            p.startsWith("/dp2")
          )
            return false;
          if (p.startsWith("/_")) return false;
          return true;
        };
        const fallback = (req: import("connect").IncomingMessage, res: import("http").ServerResponse, next: (err?: unknown) => void) => {
          if (!req.url) return next();
          const pathname = req.url.split("?")[0] ?? "";
          if (req.method === "GET" && (pathname === "/crm.html" || pathname.startsWith("/crm.html/"))) {
            const u = new URL(req.url, "http://dev.local");
            const pth = u.pathname;
            const tail = pth === "/crm.html" || pth === "/crm.html/" ? "/" : pth.startsWith("/crm.html/") ? pth.slice("/crm.html".length) || "/" : "/";
            res.statusCode = 302;
            res.setHeader("Location", tail + (u.search || "") + (u.hash || ""));
            res.end();
            return;
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
          if (pathname === "/dp2" || req.url.startsWith("/dp2?")) {
            res.statusCode = 302;
            res.setHeader("Location", "/dp2.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""));
            res.end();
            return;
          }
          if (pathname === "/dp2.html" || req.url.startsWith("/dp2.html?")) {
            const url = "/dp2.html" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
            try {
              const html = fs.readFileSync(dp2DevHtmlPath, "utf-8");
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
          if (req.url.startsWith("/dp2.html/")) {
            req.url = "/dp2.html";
            return next();
          }
          if (req.method === "GET" && isSpaIndexPath(pathname)) {
            const q = req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "";
            req.url = "/index.html" + q;
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
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared"),
      /** Fichiers sous `../shared` (ex. safeZoneEngine.js) : résolution explicite pour le build Vercel. */
      "clipper-lib": path.resolve(__dirname, "node_modules/clipper-lib"),
    },
  },
  optimizeDeps: {
    include: ["clipper-lib"],
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
        index: "./index.html",
        "pdf-render": "./pdf-render.html",
        "financial-quote-pdf-render": "./financial-quote-pdf-render.html",
        "calpinage-render": "./calpinage-render.html",
        dp2: "./dp2.html",
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "^/api/pdf": {
        target: process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/pdf/, "/pdf"),
      },
      "/api": {
        target: process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
        changeOrigin: true,
      },
      "/auth": {
        target: process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
        changeOrigin: true,
      },
      "/pdf-assets": {
        target: process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
        changeOrigin: true,
      },
      "/calpinage": {
        target: process.env.VITE_PROXY_BACKEND || "http://localhost:3000",
        changeOrigin: true,
        bypass: calpinageProxyBypass,
      },
    },
  },
};
});
