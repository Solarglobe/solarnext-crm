/**
 * CP-073 — Connexion PostgreSQL depuis DATABASE_URL / variables PG* (sans secrets en logs).
 * Parsing robuste : sslmode, mots de passe encodés (%), caractères spéciaux.
 */

import "../../config/load-env.js";
import { applyResolvedDatabaseUrl } from "../../config/database-url.js";

applyResolvedDatabaseUrl();

/**
 * Parse DATABASE_URL (postgresql:// et postgres://).
 * @param {string} raw
 */
function parseDatabaseUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    throw new Error(`DATABASE_URL invalide : ${e?.message || "parse error"}`);
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    throw new Error(`DATABASE_URL : protocole attendu postgresql:// (reçu ${u.protocol})`);
  }

  const pathPart = (u.pathname || "").replace(/^\//, "");
  const database = pathPart.split("/")[0] ? decodeURIComponent(pathPart.split("/")[0]) : "";
  if (!database) {
    throw new Error("Nom de base manquant dans DATABASE_URL (path /dbname)");
  }

  const user = u.username ? decodeURIComponent(u.username) : "";
  const password = u.password ? decodeURIComponent(u.password) : "";

  const sslmode = u.searchParams.get("sslmode") || u.searchParams.get("ssl") || null;

  return {
    host: u.hostname || "localhost",
    port: u.port || "5432",
    user,
    password,
    database,
    sslmode,
  };
}

/**
 * @returns {{
 *   host: string,
 *   port: string,
 *   user: string,
 *   password: string,
 *   database: string,
 *   sslmode: string | null
 * }}
 */
export function getPgConnectionFromEnv() {
  const fromUrl = () => {
    const raw = process.env.DATABASE_URL;
    if (!raw) return null;
    return parseDatabaseUrl(raw);
  };

  const fromParts = () => {
    const host = process.env.PGHOST || process.env.DB_HOST;
    const port = process.env.PGPORT || "5432";
    const user = process.env.PGUSER;
    const password = process.env.PGPASSWORD ?? "";
    const database = process.env.PGDATABASE;
    if (!host || !user || !database) return null;
    return {
      host,
      port,
      user,
      password,
      database,
      sslmode: process.env.PGSSLMODE || null,
    };
  };

  const a = fromUrl();
  if (a) return a;
  const b = fromParts();
  if (b) return b;
  throw new Error(
    "Connexion DB introuvable : définissez DATABASE_URL ou PGHOST, PGUSER, PGDATABASE (et PGPASSWORD si besoin)."
  );
}

/**
 * @param {ReturnType<typeof getPgConnectionFromEnv>} c
 */
export function buildPgEnv(c) {
  const env = {
    ...process.env,
    PGHOST: c.host,
    PGPORT: String(c.port),
    PGUSER: c.user,
    PGPASSWORD: c.password,
    PGDATABASE: c.database,
  };
  if (c.sslmode) {
    env.PGSSLMODE = c.sslmode;
  }
  return env;
}

/**
 * @param {ReturnType<typeof getPgConnectionFromEnv>} c
 */
export function formatConnLogLine(c) {
  const ssl = c.sslmode ? ` sslmode=${c.sslmode}` : "";
  return `host=${c.host} port=${c.port} db=${c.database} user=${c.user}${ssl}`;
}

/**
 * Catégorie pour logs / stratégie d’exécution.
 * @param {ReturnType<typeof getPgConnectionFromEnv>} c
 */
export function classifyDbTarget(c) {
  const h = (c.host || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") {
    return "local";
  }
  if (h === "db" || h.endsWith(".internal")) {
    return "docker_hostname";
  }
  return "remote";
}
