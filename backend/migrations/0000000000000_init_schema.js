import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Schéma initial complet (squash historique) — cible une base PostgreSQL vierge.
 * Corps SQL : `migrations/generated/0000000000000_init_schema.sql` (sous-dossier non scanné par node-pg-migrate).
 *
 * Important : ne pas utiliser `pgm.sql()` pour ce script — node-pg-migrate découpe sur `;`
 * et casse les fonctions PL/pgSQL / réexécute des blocs.
 */
export const shorthands = undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  const sqlPath = path.join(__dirname, "generated", "0000000000000_init_schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pgm.db.query(sql);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO postgres;
    GRANT ALL ON SCHEMA public TO public;
  `);
};
