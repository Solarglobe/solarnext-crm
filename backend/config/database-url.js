/**
 * URL PostgreSQL résolue (host local vs service Docker "db").
 * Logique centralisée dans config/database.cjs (CommonJS pour node-pg-migrate).
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const dbConfig = require("./database.cjs");

export function getConnectionString() {
  return dbConfig.getConnectionString();
}

/** Après chargement dotenv : normalise process.env.DATABASE_URL pour tout le processus. */
export function applyResolvedDatabaseUrl() {
  const url = dbConfig.getConnectionString();
  if (url) process.env.DATABASE_URL = url;
}
