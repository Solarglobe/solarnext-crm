#!/usr/bin/env node
/**
 * postinstall-playwright.cjs — Téléchargement du binaire Chromium pour Playwright.
 *
 * FLUX RAILWAY (production) :
 *   Au BUILD Nixpacks  → nixpacks.toml (racine) installe les libs système (apt) ET
 *                        exécute `npx playwright install chromium` via [phases.install].
 *                        Chromium est donc présent dans l'image Docker dès le build.
 *   Au COLD-START      → `cd backend && npm install` relance ce postinstall.
 *                        hasChromiumInCache() détecte le binaire → skip immédiat.
 *                        Démarrage rapide, aucun téléchargement runtime.
 *
 * FLUX LOCAL (dev) :
 *   RAILWAY_ENVIRONMENT absent → shouldRun = false → skip.
 *   Pour forcer : PLAYWRIGHT_FORCE_INSTALL=1 npm install
 *
 * VARIABLES D'ENVIRONNEMENT :
 *   PLAYWRIGHT_FORCE_INSTALL=1       → force le dl même hors Railway/CI
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 → désactive toujours le dl (override total)
 *   PLAYWRIGHT_FORCE_INSTALL_DEPS=1  → force playwright install-deps (apt) même sur Railway
 *                                       (utile si nixpacks.toml n'est pas à la racine)
 *   PLAYWRIGHT_BROWSERS_PATH         → chemin custom du cache Chromium
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ── Conditions d'exécution ───────────────────────────────────────────────────

const shouldRun =
  process.env.PLAYWRIGHT_FORCE_INSTALL === "1" ||
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  process.env.RAILWAY === "true";

const skipDownload =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "true" ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1";

// Sur Railway, nixpacks.toml (racine) installe les libs système au BUILD →
// `playwright install-deps` en runtime est redondant et ralentit le cold-start.
// Forçable via PLAYWRIGHT_FORCE_INSTALL_DEPS=1 si nixpacks.toml n'est pas à la racine.
const skipInstallDeps =
  process.env.PLAYWRIGHT_FORCE_INSTALL_DEPS !== "1" &&
  (Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.RAILWAY === "true");

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(marker, details) {
  process.stdout.write(details ? `${marker} ${details}\n` : `${marker}\n`);
}

function resolvePlaywrightCacheDir() {
  const customPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  // "0" = valeur spéciale Playwright signifiant "pas de cache custom"
  if (customPath && customPath !== "0") {
    return path.resolve(customPath);
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

/**
 * Vérifie si le binaire Chromium (ou chromium_headless_shell) est déjà présent
 * dans le répertoire de cache Playwright.
 * En prod Railway, nixpacks [phases.install] l'installe au build → true au cold-start.
 */
function hasChromiumInCache() {
  const cacheDir = resolvePlaywrightCacheDir();
  if (!fs.existsSync(cacheDir)) return false;
  let entries;
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) =>
      entry.isDirectory() &&
      (entry.name.startsWith("chromium-") ||
        entry.name.startsWith("chromium_headless_shell-"))
  );
}

// ── Logique principale ───────────────────────────────────────────────────────

if (skipDownload) {
  log("PLAYWRIGHT_INSTALL_SKIP", "skip_env=PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD");
  process.exit(0);
}

if (!shouldRun) {
  log("PLAYWRIGHT_INSTALL_SKIP", "reason=not_railway_or_ci");
  process.exit(0);
}

const cacheDir = resolvePlaywrightCacheDir();

if (hasChromiumInCache()) {
  // Cas nominal en prod : nixpacks a déjà installé Chromium au build.
  log(
    "PLAYWRIGHT_INSTALL_SKIP",
    `reason=chromium_cache_present cache=${cacheDir}`
  );
  process.exit(0);
}

// Cache absent → téléchargement (premier déploiement sans image Nixpacks, ou cache purgé).
log("PLAYWRIGHT_INSTALL_START", `cache_dir=${cacheDir}`);

try {
  execSync("npx playwright install chromium", { stdio: "inherit" });

  if (skipInstallDeps) {
    // Libs système gérées par nixpacks.toml à la racine → pas besoin d'apt-get ici.
    log(
      "PLAYWRIGHT_INSTALL_DEPS_SKIP",
      "reason=nixpacks_handles_system_deps"
    );
  } else {
    // Hors Railway (CI sans nixpacks, ou PLAYWRIGHT_FORCE_INSTALL_DEPS=1).
    try {
      execSync("npx playwright install-deps chromium", { stdio: "inherit" });
    } catch (depErr) {
      // Non-fatal : la suite peut fonctionner si les libs sont déjà présentes.
      console.warn(
        "PLAYWRIGHT_INSTALL_DEPS_WARN",
        String(depErr.message || depErr).slice(0, 300)
      );
    }
  }

  log("PLAYWRIGHT_INSTALL_DONE");
} catch (err) {
  console.error("PLAYWRIGHT_INSTALL_FAILED", err);
  process.exit(1);
}
