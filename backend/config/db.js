import pg from "pg";
import { getConnectionString } from "./database-url.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant au démarrage");
}

export const pool = new Pool({
  connectionString: getConnectionString(),
});
