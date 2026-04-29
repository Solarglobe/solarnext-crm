#!/usr/bin/env node
/**
 * Railpack (Railway) n’exécute pas `npm run build` du backend : le Dockerfile n’est
 * souvent pas utilisé. Au démarrage, `cd backend && npm install` lance ce postinstall
 * avec RAILWAY_ENVIRONMENT défini → installation Chromium.
 * Local : variable absente → skip (lancer manuellement : npm run build).
 */
const { execSync } = require("node:child_process");

const shouldRun =
  process.env.PLAYWRIGHT_FORCE_INSTALL === "1" ||
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  process.env.RAILWAY === "true";

if (!shouldRun) {
  process.stdout.write(
    "[playwright] postinstall skip (hors Railway/CI) — exécuter: npm run build\n"
  );
  process.exit(0);
}

try {
  execSync("npx playwright install chromium", {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
    },
  });
} catch (e) {
  process.stderr.write(`[playwright] postinstall échoué: ${e && e.message}\n`);
  process.exit(1);
}
