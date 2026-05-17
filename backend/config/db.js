import pg from "pg";
import { getConnectionString } from "./database-url.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant au démarrage");
}

export const pool = new Pool({
  connectionString: getConnectionString(),
  /** Taille max du pool — ajustable via DB_POOL_MAX (Railway/Supabase : vérifier la limite autorisée). */
  max: parseInt(process.env.DB_POOL_MAX ?? "10", 10),
  /** Libère une connexion inactive après 30 s. */
  idleTimeoutMillis: 30_000,
  /** Échoue proprement si aucune connexion disponible en 5 s (plutôt que bloquer indéfiniment). */
  connectionTimeoutMillis: 5_000,
  /** Coupe toute requête dépassant 15 s côté serveur PostgreSQL. */
  statement_timeout: 15_000,
  /** Coupe la promesse node-postgres si le serveur ne répond pas en 15 s. */
  query_timeout: 15_000,
  application_name: "solarnext-api",
});

/** Capture les erreurs sur les connexions idle (connexion PostgreSQL fermée côté serveur, ex. redémarrage Railway). */
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected error on idle client:", err.message);
});
