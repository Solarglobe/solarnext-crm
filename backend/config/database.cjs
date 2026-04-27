const path = require("path");
const fs = require("fs");

// Même ordre que bootstrap.js / load-env.js : racine .env.dev puis backend/.env
// Ne pas charger les fichiers si DATABASE_URL est déjà défini (ex. Railway) : évite
// PGHOST/DB_HOST locaux qui réécriraient l’hôte via resolveHostname().
if (!process.env.DATABASE_URL) {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
}

/**
 * Backend dans un conteneur Linux : /.dockerenv est présent.
 * Sur la machine hôte (npm run dev en local), absent → on ne résout pas "db" vers le réseau Docker.
 */
function isDockerRuntime() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/**
 * Priorité : DB_HOST explicite > PGHOST > logique docker/local > hostname dans l’URL.
 */
function resolveHostname(parsedUrl) {
  if (process.env.DB_HOST) return process.env.DB_HOST;
  if (process.env.PGHOST) return process.env.PGHOST;
  if (process.env.NODE_ENV === "docker") return "db";
  if (parsedUrl.hostname === "db" && !isDockerRuntime()) return "localhost";
  return parsedUrl.hostname;
}

function getConnectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) return url;
  try {
    const u = new URL(url);
    u.hostname = resolveHostname(u);
    return u.toString();
  } catch {
    return url;
  }
}

module.exports = {
  getConnectionString,
  databaseUrl: getConnectionString(),
  dir: "migrations",
  migrationsTable: "pgmigrations",
};
