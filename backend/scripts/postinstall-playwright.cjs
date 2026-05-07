#!/usr/bin/env node
/**
 * Railpack (Railway) n’exécute pas `npm run build` du backend : le Dockerfile n’est
 * souvent pas utilisé. Au démarrage, `cd backend && npm install` lance ce postinstall
 * avec RAILWAY_ENVIRONMENT défini → installation Chromium.
 * Local : variable absente → skip (lancer manuellement : npm run build).
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const shouldRun =
  process.env.PLAYWRIGHT_FORCE_INSTALL === "1" ||
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  process.env.RAILWAY === "true";

const skipDownload =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "true" ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1";

function log(marker, details) {
  if (details) {
    process.stdout.write(`${marker} ${details}\n`);
    return;
  }
  process.stdout.write(`${marker}\n`);
}

function resolvePlaywrightCacheDir() {
  const customPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (customPath && customPath !== "0") {
    return path.resolve(customPath);
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

function hasChromiumInCache() {
  const cacheDir = resolvePlaywrightCacheDir();
  if (!fs.existsSync(cacheDir)) return false;
  const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  return entries.some(
    (entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith("chromium-") || entry.name.startsWith("chromium_headless_shell-"))
  );
}

if (skipDownload) {
  log("PLAYWRIGHT_INSTALL_SKIP", "skip_env=PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD");
  process.exit(0);
}

if (!shouldRun) {
  log("PLAYWRIGHT_INSTALL_SKIP", "reason=not_railway_or_ci");
  process.exit(0);
}

if (hasChromiumInCache()) {
  log("PLAYWRIGHT_INSTALL_SKIP", `reason=chromium_cache_present cache=${resolvePlaywrightCacheDir()}`);
  process.exit(0);
}

try {
  console.log("PLAYWRIGHT_INSTALL_START");
  // Install Chromium binary
  execSync("npx playwright install chromium", { stdio: "inherit" });

  // Install system-level OS dependencies for Chromium (libnss3, libglib2 etc.)
  // This is a safety net alongside nixpacks.toml apt packages.
  // On Railway the command may need sudo — it silently continues on error.
  try {
    execSync("npx playwright install-deps chromium", { stdio: "inherit" });
  } catch (depErr) {
    console.warn("PLAYWRIGHT_INSTALL_DEPS_WARN", String(depErr.message || depErr).slice(0, 200));
  }

  console.log("PLAYWRIGHT_INSTALL_DONE");
} catch (err) {
  console.error("PLAYWRIGHT_INSTALL_FAILED", err);
  process.exit(1);
}
