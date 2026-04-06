/**
 * Attend que PostgreSQL soit prêt (connexion réussie).
 * Utilisé par le bootstrap Docker.
 */
import pg from "pg";
import { getConnectionString } from "../config/database-url.js";

const maxAttempts = 30;
const delayMs = 2000;

async function wait() {
  const conn = (process.env.DATABASE_URL && getConnectionString()) || `postgresql://postgres:postgres@${process.env.PGHOST || "db"}:5432/solarnext`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const client = new pg.Client({ connectionString: conn });
      await client.connect();
      await client.end();
      console.log("[wait-for-db] PostgreSQL prêt.");
      process.exit(0);
    } catch (err) {
      console.log(`[wait-for-db] Tentative ${i + 1}/${maxAttempts}...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error("[wait-for-db] Timeout: PostgreSQL non accessible.");
  process.exit(1);
}

wait();
