const path = require("path");

// Même ordre que bootstrap.js / load-env.js : racine .env.dev puis backend/.env
// Ne pas charger les fichiers si DATABASE_URL est déjà défini par l'hébergeur : évite
// PGHOST/DB_HOST locaux qui réécriraient l’hôte via resolveHostname().
if (!process.env.DATABASE_URL) {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
}

/**
 * Priorité : DB_HOST explicite > PGHOST > hostname dans l'URL injectée.
 */
function resolveHostname(parsedUrl) {
  if (process.env.DB_HOST) return process.env.DB_HOST;
  if (process.env.PGHOST) return process.env.PGHOST;
  return parsedUrl.hostname;
}

function assertNoObsoleteRailwayUrl(parsedUrl) {
  if (parsedUrl.hostname.toLowerCase().includes("railway")) {
    throw new Error("DATABASE_URL Railway obsolète refusée: backend production attendu chez Infomaniak");
  }
}

function getConnectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) return url;
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  assertNoObsoleteRailwayUrl(u);
  u.hostname = resolveHostname(u);
  return u.toString();
}

module.exports = {
  getConnectionString,
  databaseUrl: getConnectionString(),
  dir: "migrations",
  migrationsTable: "pgmigrations",
};
