#!/usr/bin/env node
/**
 * postinstall-playwright.cjs — Téléchargement du binaire Chromium pour Playwright.
 *
 * FLUX PRODUCTION INFOMANIAK :
 *   Le serveur backend doit fournir Chromium ou définir PLAYWRIGHT_FORCE_INSTALL=1
 *   lors d'une installation contrôlée. Aucun hébergeur obsolète n'active ce script.
 *
 * FLUX LOCAL (dev) :
 *   CI/PLAYWRIGHT_FORCE_INSTALL absents → shouldRun = false → skip.
 *   Pour forcer : PLAYWRIGHT_FORCE_INSTALL=1 npm install
 *
 * VARIABLES D'ENVIRONNEMENT :
 *   PLAYWRIGHT_FORCE_INSTALL=1       → force le dl même hors CI
 *   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 → désactive toujours le dl (override total)
 *   PLAYWRIGHT_FORCE_INSTALL_DEPS=1  → force playwright install-deps (apt)
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
  process.env.CI === "1";

const skipDownload =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "true" ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1";

const skipInstallDeps = process.env.PLAYWRIGHT_FORCE_INSTALL_DEPS !== "1";

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
 * En production, le cache serveur peut déjà contenir Chromium → true au redémarrage.
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
  log("PLAYWRIGHT_INSTALL_SKIP", "reason=not_ci_or_forced");
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
    // En CI ou avec PLAYWRIGHT_FORCE_INSTALL_DEPS=1, tenter l'installation des dépendances système.
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
